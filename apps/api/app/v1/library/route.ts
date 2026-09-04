import { and, desc, eq, sql } from "drizzle-orm";
import {
  articleCategorySchema,
  articleCardSchema,
  libraryResponseSchema,
  type ArticleCategory,
} from "@edison/contracts";
import {
  articleConversations,
  articles,
  learningThreads,
  readingEvents,
  savedArticles,
} from "@edison/db";
import { apiHandler, json } from "../../../src/http/api-handler";
import { withActiveMember } from "../../../src/services/members";

export const dynamic = "force-dynamic";

function presentCard(row: {
  id: string;
  slug: string;
  category: ArticleCategory;
  kicker: string;
  title: string;
  deck: string;
  readingMinutes: number;
  sourceCount: number;
  researchedAt: Date;
  whyWritten: string;
  summary: unknown;
  saved: boolean;
  completed: boolean;
}) {
  return articleCardSchema.parse({
    id: row.id,
    slug: row.slug,
    category: row.category,
    kicker: row.kicker,
    title: row.title,
    deck: row.deck,
    readingMinutes: row.readingMinutes,
    sourceCount: row.sourceCount,
    researchedAt: row.researchedAt.toISOString(),
    reason: row.whyWritten,
    summary: row.summary,
    saved: row.saved,
    completed: row.completed,
  });
}

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) =>
    withActiveMember(claims, async ({ transaction }) => {
      const cardSelection = {
        id: articles.id,
        slug: articles.slug,
        category: articles.category,
        kicker: articles.kicker,
        title: articles.title,
        deck: articles.deck,
        readingMinutes: articles.readingMinutes,
        sourceCount: articles.sourceCount,
        researchedAt: articles.researchedAt,
        whyWritten: articles.whyWritten,
        summary: articles.summary,
        saved: sql<boolean>`exists (
          select 1 from ${savedArticles} s
          where s.user_id = ${claims.sub} and s.article_id = ${articles.id}
        )`,
        completed: sql<boolean>`exists (
          select 1 from ${readingEvents} r
          where r.user_id = ${claims.sub}
            and r.article_id = ${articles.id}
            and r.event_type = 'completed'
        )`,
      };

      const saved = await transaction
        .select(cardSelection)
        .from(savedArticles)
        .innerJoin(articles, eq(articles.id, savedArticles.articleId))
        .where(eq(savedArticles.userId, claims.sub))
        .orderBy(desc(savedArticles.savedAt))
        .limit(50);

      const completed = await transaction
        .select(cardSelection)
        .from(articles)
        .where(
          and(
            eq(articles.ownerId, claims.sub),
            sql`exists (
              select 1 from ${readingEvents} r
              where r.user_id = ${claims.sub}
                and r.article_id = ${articles.id}
                and r.event_type = 'completed'
            )`,
          ),
        )
        .orderBy(desc(articles.updatedAt))
        .limit(50);

      const threads = await transaction
        .select()
        .from(learningThreads)
        .where(
          and(
            eq(learningThreads.userId, claims.sub),
            eq(learningThreads.status, "active"),
          ),
        )
        .orderBy(desc(learningThreads.updatedAt));

      const conversations = await transaction
        .select({
          id: articleConversations.id,
          articleId: articleConversations.articleId,
          articleTitle: articles.title,
          title: articleConversations.title,
          updatedAt: articleConversations.updatedAt,
        })
        .from(articleConversations)
        .innerJoin(articles, eq(articles.id, articleConversations.articleId))
        .where(eq(articleConversations.userId, claims.sub))
        .orderBy(desc(articleConversations.updatedAt))
        .limit(50);

      return json(
        libraryResponseSchema.parse({
        saved: saved.map((row) =>
          presentCard({
            ...row,
            category: articleCategorySchema.parse(row.category),
          }),
        ),
        completed: completed.map((row) =>
          presentCard({
            ...row,
            category: articleCategorySchema.parse(row.category),
          }),
        ),
          learningThreads: threads.map((thread) => ({
            id: thread.id,
            title: thread.title,
            summary: thread.summary,
            currentLevel: thread.currentLevel,
            updatedAt: thread.updatedAt.toISOString(),
          })),
          conversations: conversations.map((conversation) => ({
            ...conversation,
            updatedAt: conversation.updatedAt.toISOString(),
          })),
        }),
      );
    }),
  );
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
