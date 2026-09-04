import { and, asc, desc, eq, inArray } from "drizzle-orm";
import {
  articleBlockSchema,
  articleConversationResponseSchema,
  articleSourceSchema,
  citationSchema,
  conversationMessageSchema,
  conversationRequestSchema,
  conversationResponseSchema,
  uuidSchema,
  type ArticleSource,
} from "@edison/contracts";
import { answerArticleQuestion } from "@edison/ai";
import {
  articleConversations,
  articleSources,
  articles,
  conversationMessages,
  getDb,
  usageLedger,
  type UserTransaction,
} from "@edison/db";
import { estimatedArticleCostMicrousd } from "@edison/domain";
import { apiHandler, json } from "../../../../../src/http/api-handler";
import { HttpError } from "../../../../../src/http/errors";
import { withActiveMember } from "../../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ articleId: string }> };
type MessageRow = typeof conversationMessages.$inferSelect;

function presentMessage(message: MessageRow) {
  return conversationMessageSchema.parse({
    id: message.id,
    role: message.role,
    content: message.content,
    citations: citationSchema.array().parse(message.citations),
    createdAt: message.createdAt.toISOString(),
  });
}

function presentAnswer(
  conversationId: string,
  userMessage: MessageRow,
  assistantMessage: MessageRow,
) {
  return conversationResponseSchema.parse({
    conversationId,
    userMessageId: userMessage.id,
    assistantMessageId: assistantMessage.id,
    answer: assistantMessage.content,
    citations: citationSchema.array().parse(assistantMessage.citations),
  });
}

async function requireOwnedArticle(
  transaction: UserTransaction,
  userId: string,
  articleId: string,
) {
  const [article] = await transaction
    .select()
    .from(articles)
    .where(
      and(
        eq(articles.id, articleId),
        eq(articles.ownerId, userId),
        eq(articles.status, "published"),
      ),
    )
    .limit(1);

  if (!article) {
    throw new HttpError(404, "article_not_found", "That article was not found.");
  }

  return article;
}

async function findOrCreateConversation(
  transaction: UserTransaction,
  userId: string,
  articleId: string,
) {
  const [existing] = await transaction
    .select()
    .from(articleConversations)
    .where(
      and(
        eq(articleConversations.userId, userId),
        eq(articleConversations.articleId, articleId),
      ),
    )
    .limit(1);
  if (existing) return existing;

  const [created] = await transaction
    .insert(articleConversations)
    .values({ userId, articleId })
    .onConflictDoNothing()
    .returning();
  if (created) return created;

  const [raced] = await transaction
    .select()
    .from(articleConversations)
    .where(
      and(
        eq(articleConversations.userId, userId),
        eq(articleConversations.articleId, articleId),
      ),
    )
    .limit(1);
  if (!raced) {
    throw new HttpError(
      500,
      "conversation_creation_failed",
      "Edison could not create the article conversation.",
    );
  }
  return raced;
}

export async function GET(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);

    return withActiveMember(claims, async ({ transaction }) => {
      await requireOwnedArticle(transaction, claims.sub, articleId);

      const [conversation] = await transaction
        .select()
        .from(articleConversations)
        .where(
          and(
            eq(articleConversations.userId, claims.sub),
            eq(articleConversations.articleId, articleId),
          ),
        )
        .limit(1);

      if (!conversation) {
        return json(
          articleConversationResponseSchema.parse({ conversation: null }),
        );
      }

      const messages = await transaction
        .select()
        .from(conversationMessages)
        .where(eq(conversationMessages.conversationId, conversation.id))
        .orderBy(desc(conversationMessages.createdAt))
        .limit(100);

      return json(
        articleConversationResponseSchema.parse({
          conversation: {
            id: conversation.id,
            articleId: conversation.articleId,
            title: conversation.title,
            createdAt: conversation.createdAt.toISOString(),
            updatedAt: conversation.updatedAt.toISOString(),
            messages: messages.reverse().map(presentMessage),
          },
        }),
      );
    });
  });
}

export async function POST(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { articleId: rawArticleId } = await context.params;
    const articleId = uuidSchema.parse(rawArticleId);
    const input = conversationRequestSchema.parse(await request.json());
    const assistantIdempotencyKey = `assistant:${input.idempotencyKey}`;

    const prepared = await withActiveMember(
      claims,
      async ({ transaction }) => {
        const article = await requireOwnedArticle(
          transaction,
          claims.sub,
          articleId,
        );
        const conversation = await findOrCreateConversation(
          transaction,
          claims.sub,
          articleId,
        );

        const existingMessages = await transaction
          .select()
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, conversation.id),
              inArray(conversationMessages.idempotencyKey, [
                input.idempotencyKey,
                assistantIdempotencyKey,
              ]),
            ),
          );
        let userMessage = existingMessages.find(
          (message) => message.idempotencyKey === input.idempotencyKey,
        );
        const existingAssistantMessage = existingMessages.find(
          (message) => message.idempotencyKey === assistantIdempotencyKey,
        );

        if (userMessage && userMessage.content !== input.message) {
          throw new HttpError(
            409,
            "idempotency_key_reused",
            "That idempotency key was already used for a different question.",
          );
        }

        if (existingAssistantMessage) {
          if (!userMessage) {
            throw new HttpError(
              500,
              "conversation_state_invalid",
              "The stored conversation is incomplete.",
            );
          }
          return {
            replay: presentAnswer(
              conversation.id,
              userMessage,
              existingAssistantMessage,
            ),
          };
        }

        if (!process.env.OPENAI_API_KEY) {
          throw new HttpError(
            503,
            "ai_not_configured",
            "Article questions are unavailable until OpenAI is configured.",
          );
        }

        if (!userMessage) {
          const [created] = await transaction
            .insert(conversationMessages)
            .values({
              conversationId: conversation.id,
              role: "user",
              content: input.message,
              idempotencyKey: input.idempotencyKey,
            })
            .onConflictDoNothing()
            .returning();

          if (created) {
            userMessage = created;
          } else {
            [userMessage] = await transaction
              .select()
              .from(conversationMessages)
              .where(
                and(
                  eq(conversationMessages.conversationId, conversation.id),
                  eq(
                    conversationMessages.idempotencyKey,
                    input.idempotencyKey,
                  ),
                ),
              )
              .limit(1);
          }
        }

        if (!userMessage) {
          throw new HttpError(
            500,
            "message_creation_failed",
            "Edison could not store the article question.",
          );
        }

        await transaction
          .update(articleConversations)
          .set({ title: conversation.title ?? input.message.slice(0, 160) })
          .where(
            and(
              eq(articleConversations.id, conversation.id),
              eq(articleConversations.userId, claims.sub),
            ),
          );

        const [sources, recentMessages] = await Promise.all([
          transaction
            .select()
            .from(articleSources)
            .where(eq(articleSources.articleId, articleId))
            .orderBy(asc(articleSources.citationOrder)),
          transaction
            .select()
            .from(conversationMessages)
            .where(eq(conversationMessages.conversationId, conversation.id))
            .orderBy(desc(conversationMessages.createdAt))
            .limit(20),
        ]);

        const presentedSources: ArticleSource[] = sources.map((source) =>
          articleSourceSchema.parse({
            id: source.id,
            title: source.title,
            publisher: source.publisher,
            url: source.url,
            publishedAt: source.publishedAt?.toISOString() ?? null,
            accessedAt: source.accessedAt.toISOString(),
          }),
        );

        return {
          replay: null,
          conversationId: conversation.id,
          userMessage,
          article: {
            title: article.title,
            deck: article.deck,
            body: articleBlockSchema.array().parse(article.body),
          },
          sources: presentedSources,
          history: recentMessages
            .reverse()
            .filter(
              (message) => message.idempotencyKey !== input.idempotencyKey,
            )
            .map((message) => ({
              role:
                message.role === "assistant"
                  ? ("assistant" as const)
                  : ("user" as const),
              content: message.content,
            })),
        };
      },
    );

    if (prepared.replay) return json(prepared.replay);

    const result = await answerArticleQuestion({
      userId: claims.sub,
      article: prepared.article,
      sources: prepared.sources,
      history: prepared.history,
      question: input.message,
    });

    const assistantMessage = await getDb().transaction(async (transaction) => {
      // This is an administrative transaction because RLS correctly prevents a
      // client acting as `authenticated` from inserting an assistant message.
      // Re-check all ownership predicates before using that elevated path.
      const [ownedConversation] = await transaction
        .select({ id: articleConversations.id })
        .from(articleConversations)
        .innerJoin(articles, eq(articles.id, articleConversations.articleId))
        .where(
          and(
            eq(articleConversations.id, prepared.conversationId),
            eq(articleConversations.userId, claims.sub),
            eq(articleConversations.articleId, articleId),
            eq(articles.ownerId, claims.sub),
            eq(articles.status, "published"),
          ),
        )
        .limit(1);
      if (!ownedConversation) {
        throw new HttpError(
          404,
          "conversation_not_found",
          "That article conversation was not found.",
        );
      }

      const [existing] = await transaction
        .select()
        .from(conversationMessages)
        .where(
          and(
            eq(conversationMessages.conversationId, prepared.conversationId),
            eq(
              conversationMessages.idempotencyKey,
              assistantIdempotencyKey,
            ),
          ),
        )
        .limit(1);

      const [created] = existing
        ? [existing]
        : await transaction
            .insert(conversationMessages)
            .values({
              conversationId: prepared.conversationId,
              role: "assistant",
              content: result.answer,
              citations: result.citations,
              idempotencyKey: assistantIdempotencyKey,
              inputTokens: result.inputTokens,
              outputTokens: result.outputTokens,
            })
            .onConflictDoNothing()
            .returning();

      const stored = created
        ? created
        : (
            await transaction
              .select()
              .from(conversationMessages)
              .where(
                and(
                  eq(
                    conversationMessages.conversationId,
                    prepared.conversationId,
                  ),
                  eq(
                    conversationMessages.idempotencyKey,
                    assistantIdempotencyKey,
                  ),
                ),
              )
              .limit(1)
          )[0];
      if (!stored) {
        throw new HttpError(
          500,
          "answer_storage_failed",
          "Edison could not store the article answer.",
        );
      }

      await transaction
        .update(articleConversations)
        .set({ updatedAt: new Date() })
        .where(eq(articleConversations.id, prepared.conversationId));

      await transaction.insert(usageLedger).values({
        userId: claims.sub,
        operation: existing || !created ? "article_qa_duplicate" : "article_qa",
        provider: "openai",
        model: result.model,
        inputTokens: result.inputTokens,
        cachedInputTokens: result.cachedInputTokens,
        outputTokens: result.outputTokens,
        webSearchCalls: 0,
        costMicrousd: estimatedArticleCostMicrousd({
          model: result.model,
          inputTokens: result.inputTokens,
          cachedInputTokens: result.cachedInputTokens,
          outputTokens: result.outputTokens,
          webSearchCalls: 0,
        }),
      });

      return stored;
    });

    return json(
      presentAnswer(
        prepared.conversationId,
        prepared.userMessage,
        assistantMessage,
      ),
    );
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
