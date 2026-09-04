import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { FatalError, getWorkflowMetadata } from "workflow";
import { generateArticle } from "@edison/ai";
import {
  articleCategories,
  articleCategorySchema,
  type ArticleCategory,
} from "@edison/contracts";
import {
  articleSources,
  articles,
  feedItems,
  feedPreferences,
  generationJobs,
  getDb,
  profiles,
  usageLedger,
  userInterests,
} from "@edison/db";
import {
  dateKeyInTimeZone,
  estimatedArticleCostMicrousd,
  slugifyArticleTitle,
} from "@edison/domain";

export async function generateArticleWorkflow(jobId: string) {
  "use workflow";

  const { workflowRunId } = getWorkflowMetadata();
  const claimed = await markJobRunning(jobId, workflowRunId);
  if (claimed.articleId) return { articleId: claimed.articleId };

  try {
    return await generateAndPublish(jobId, workflowRunId);
  } catch (error) {
    await markJobFailed(jobId, workflowRunId);
    throw error;
  }
}

async function markJobRunning(jobId: string, workflowRunId: string) {
  "use step";

  const database = getDb();
  const [claimed] = await database
    .update(generationJobs)
    .set({
      status: "running",
      workflowRunId,
      leaseExpiresAt: null,
      startedAt: new Date(),
      attemptCount: sql`${generationJobs.attemptCount} + 1`,
      error: null,
      failureCode: null,
    })
    .where(
      and(
        eq(generationJobs.id, jobId),
        eq(generationJobs.status, "queued"),
        or(
          isNull(generationJobs.workflowRunId),
          eq(generationJobs.workflowRunId, workflowRunId),
        ),
      ),
    )
    .returning({ id: generationJobs.id });

  if (claimed) return { articleId: null };

  const [job] = await database
    .select({
      status: generationJobs.status,
      workflowRunId: generationJobs.workflowRunId,
      outputArticleId: generationJobs.outputArticleId,
    })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);

  if (!job) throw new FatalError("Generation job does not exist");
  if (job.status === "succeeded" && job.outputArticleId) {
    return { articleId: job.outputArticleId };
  }
  if (job.status === "running" && job.workflowRunId === workflowRunId) {
    // A retry of this same step may observe the claim made by its first
    // delivery before that delivery's result was recorded.
    return { articleId: null };
  }
  if (job.workflowRunId && job.workflowRunId !== workflowRunId) {
    throw new FatalError("Generation job belongs to another workflow run");
  }
  if (job.status === "cancelled") {
    throw new FatalError("Generation job was cancelled");
  }
  throw new FatalError(`Generation job cannot start from status ${job.status}`);
}

markJobRunning.maxRetries = 3;

async function generateAndPublish(jobId: string, workflowRunId: string) {
  "use step";

  const database = getDb();
  const [record] = await database
    .select({
      job: generationJobs,
      profile: profiles,
      preferences: feedPreferences,
    })
    .from(generationJobs)
    .innerJoin(profiles, eq(profiles.id, generationJobs.userId))
    .innerJoin(feedPreferences, eq(feedPreferences.userId, generationJobs.userId))
    .where(eq(generationJobs.id, jobId))
    .limit(1);

  if (!record) throw new FatalError("Generation context does not exist");
  if (record.job.outputArticleId) {
    return { articleId: record.job.outputArticleId };
  }
  if (
    record.job.status !== "running" ||
    record.job.workflowRunId !== workflowRunId
  ) {
    throw new FatalError("Generation job is not owned by this workflow run");
  }
  if (!process.env.OPENAI_API_KEY) {
    throw new FatalError("OPENAI_API_KEY is not configured");
  }
  const webSearchCostMicrousd = Number(
    process.env.OPENAI_WEB_SEARCH_COST_MICROUSD ?? "10000",
  );
  if (
    !Number.isSafeInteger(webSearchCostMicrousd) ||
    webSearchCostMicrousd < 0
  ) {
    throw new FatalError(
      "OPENAI_WEB_SEARCH_COST_MICROUSD must be a nonnegative integer",
    );
  }

  const [interests, recentArticles] = await Promise.all([
    database
      .select({ topic: userInterests.topic, status: userInterests.status })
      .from(userInterests)
      .where(
        and(
          eq(userInterests.userId, record.job.userId),
          inArray(userInterests.status, ["active", "muted"]),
        ),
      )
      .limit(40),
    database
      .select({ title: articles.title })
      .from(articles)
      .where(eq(articles.ownerId, record.job.userId))
      .orderBy(desc(articles.createdAt))
      .limit(20),
  ]);

  const input = record.job.input as {
    topic?: string;
    category?: string;
    source?: string;
    editionDate?: string;
    slot?: number;
    target?: number;
  };
  const edition =
    input.source === "daily-edition-scheduler" &&
    typeof input.editionDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(input.editionDate) &&
    typeof input.slot === "number" &&
    Number.isInteger(input.slot) &&
    input.slot >= 1 &&
    typeof input.target === "number" &&
    Number.isInteger(input.target) &&
    input.target >= input.slot
      ? {
          date: input.editionDate,
          slot: input.slot,
          target: input.target,
        }
      : undefined;
  const parsedRequestedCategory = articleCategorySchema.safeParse(input.category);
  if (input.category !== undefined && !parsedRequestedCategory.success) {
    throw new FatalError("Generation job contains an invalid article category");
  }
  const requestedCategory = parsedRequestedCategory.success
    ? parsedRequestedCategory.data
    : undefined;
  const allowedCategories: ArticleCategory[] = articleCategories.filter(
    (category) => record.preferences.categoryVisibility[category] !== false,
  );
  if (!allowedCategories.length) {
    throw new FatalError("Reader has no visible article categories");
  }
  if (requestedCategory && !allowedCategories.includes(requestedCategory)) {
    throw new FatalError("Requested article category is hidden");
  }
  const result = await generateArticle({
    userId: record.job.userId,
    requestedTopic: input.topic,
    requestedCategory,
    allowedCategories,
    goals: record.preferences.editorialBrief
      ? [record.preferences.editorialBrief]
      : [],
    interests: interests
      .filter((interest) => interest.status === "active")
      .map((interest) => interest.topic),
    mutedInterests: interests
      .filter((interest) => interest.status === "muted")
      .map((interest) => interest.topic),
    knowledgeState: record.preferences.knowledgeState,
    recentTitles: recentArticles.map((article) => article.title),
    preferredLength: record.preferences.articleLength,
    depth: record.preferences.depth,
    novelty: record.preferences.novelty,
    edition,
  });

  const articleId = crypto.randomUUID();
  const sourceIds = new Map(
    result.article.sources.map((source) => [source.key, crypto.randomUUID()]),
  );
  const slug = `${slugifyArticleTitle(result.article.title)}-${jobId.slice(0, 8)}`;
  const researchedAt = new Date();
  const editionDate =
    edition?.date ?? dateKeyInTimeZone(researchedAt, record.profile.timezone);
  const body = result.article.body.map((block) => {
    if (block.type === "heading") return block;
    return {
      ...block,
      citations: block.citations.map((citation) => ({
        sourceId: sourceIds.get(citation.sourceKey),
        label: citation.label,
      })),
    };
  });
  const searchCost =
    result.webSearchCalls * webSearchCostMicrousd;
  const costMicrousd =
    estimatedArticleCostMicrousd(result) +
    (Number.isFinite(searchCost) ? searchCost : 0);

  let publishedArticleId = articleId;
  await database.transaction(async (transaction) => {
    const [current] = await transaction
      .select({
        status: generationJobs.status,
        workflowRunId: generationJobs.workflowRunId,
        outputArticleId: generationJobs.outputArticleId,
      })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .for("update")
      .limit(1);
    if (!current) throw new FatalError("Generation job no longer exists");
    if (current.outputArticleId) {
      publishedArticleId = current.outputArticleId;
      return;
    }
    if (
      current.status !== "running" ||
      current.workflowRunId !== workflowRunId
    ) {
      throw new FatalError("Generation job is no longer owned by this workflow run");
    }

    await transaction.insert(articles).values({
      id: articleId,
      ownerId: record.job.userId,
      slug,
      status: "published",
      category: result.article.category,
      kicker: result.article.kicker,
      topic: result.article.topic,
      title: result.article.title,
      deck: result.article.deck,
      body,
      summary: result.article.summary,
      whyWritten: result.article.whyWritten,
      readingMinutes: result.article.readingMinutes,
      sourceCount: result.article.sources.length,
      researchedAt,
      publishedAt: researchedAt,
      model: result.model,
    });

    await transaction.insert(articleSources).values(
      result.article.sources.map((source, index) => ({
        id: sourceIds.get(source.key)!,
        articleId,
        citationOrder: index + 1,
        title: source.title,
        publisher: source.publisher,
        url: source.url,
        publishedAt: source.publishedAt ? new Date(source.publishedAt) : null,
        accessedAt: researchedAt,
      })),
    );

    await transaction.insert(feedItems).values({
      userId: record.job.userId,
      articleId,
      category: result.article.category,
      editionDate,
      rank: String(Date.now()),
      reason: result.article.whyWritten,
    });

    await transaction.insert(usageLedger).values({
      userId: record.job.userId,
      generationJobId: jobId,
      operation: "article_generation",
      provider: "openai",
      model: result.model,
      inputTokens: result.inputTokens,
      cachedInputTokens: result.cachedInputTokens,
      outputTokens: result.outputTokens,
      webSearchCalls: result.webSearchCalls,
      costMicrousd,
    });

    await transaction
      .update(generationJobs)
      .set({
        status: "succeeded",
        outputArticleId: articleId,
        providerResponseId: result.providerResponseId,
        model: result.model,
        finishedAt: new Date(),
        error: null,
        failureCode: null,
      })
      .where(eq(generationJobs.id, jobId));
  });

  return { articleId: publishedArticleId };
}

generateAndPublish.maxRetries = 3;

async function markJobFailed(jobId: string, workflowRunId: string) {
  "use step";

  await getDb()
    .update(generationJobs)
    .set({
      status: "failed",
      failureCode: "generation_failed",
      error: "Article generation failed after retries.",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(generationJobs.id, jobId),
        eq(generationJobs.status, "running"),
        eq(generationJobs.workflowRunId, workflowRunId),
      ),
    );
}

markJobFailed.maxRetries = 5;
