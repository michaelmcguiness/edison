import { and, asc, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import { FatalError, RetryableError, getWorkflowMetadata } from "workflow";
import { z } from "zod";
import {
  ProviderResponseValidationError,
  generateArticle,
  getArticleModel,
} from "@edison/ai";
import {
  articleCategories,
  articleCategorySchema,
  knowledgeStateSchema,
  learningLoopCuriositySchema,
  learningLoopDirectionSchema,
  learningLoopTitleSchema,
  maxEditorialInstructionsPerSection,
  maxRetainedExplicitInterests,
  sharedArticleSnapshotSchema,
  uuidSchema,
  type ArticleCategory,
} from "@edison/contracts";
import {
  articleSources,
  articles,
  editorialDirectionStates,
  editorialInstructions,
  feedItems,
  feedPreferences,
  generationJobs,
  getDb,
  learningLoopPublicArticles,
  learningThreads,
  profiles,
  publicStarterEditionArticles,
  publicStarterEditions,
  usageLedger,
  userInterests,
} from "@edison/db";
import {
  dateKeyInTimeZone,
  estimatedArticleCostMicrousd,
  slugifyArticleTitle,
  UnpricedOpenAiModelError,
} from "@edison/domain";
import { ensureNewsEditionForDate } from "../src/services/news-editions";

export const ARTICLE_GENERATION_PROVIDER_TIMEOUT_MS = 2 * 60 * 1_000;
// Bump whenever the provider prompt, tools, or request envelope changes. An
// in-flight snapshot from another version then fails closed instead of reusing
// one provider key for two different HTTP request bodies.
// Version 3 adds an explicitly scoped learning-loop assignment and continuity
// context. Existing snapshots must not reuse a version-2 key for that changed
// provider request body.
export const ARTICLE_GENERATION_REQUEST_VERSION = 3;

type NewsDirectionCandidate = {
  id: string;
  scope: "persistent" | "edition";
  editionId: string | null;
  text: string;
  revision: number;
};

export type NewsDirectionSnapshot = {
  revision: number;
  editionId: string;
  editionDate: string;
  instructions: Array<{
    scope: "persistent" | "edition";
    text: string;
  }>;
};

export type LearningLoopGenerationSnapshot = {
  id: string;
  revision: number;
  direction: string;
  title: string;
  originalCuriosity: string;
};

const learningLoopRequestSnapshotSchema = z
  .object({
    id: uuidSchema,
    revision: z.number().int().nonnegative(),
    direction: learningLoopDirectionSchema,
  })
  .strict();

const persistedGenerationContextSchema = z
  .object({
    userId: uuidSchema,
    requestedTopic: z.string().min(1).max(1000).optional(),
    requestedCategory: articleCategorySchema.optional(),
    currentDate: z.string().date(),
    articleModel: z.string().min(1).max(120),
    editorialDirections: z
      .array(
        z
          .object({
            scope: z.enum(["persistent", "edition", "loop"]),
            text: z.string().min(1).max(1000),
          })
          .strict(),
      )
      .max(maxEditorialInstructionsPerSection + 1),
    allowedCategories: z.array(articleCategorySchema).min(1),
    goals: z.array(z.string()),
    interests: z.array(z.string()),
    mutedInterests: z.array(z.string()),
    knowledgeState: knowledgeStateSchema,
    recentTitles: z.array(z.string()),
    learningLoop: z
      .object({
        title: learningLoopTitleSchema,
        originalCuriosity: learningLoopCuriositySchema,
        previousArticles: z
          .array(
            z
              .object({
                topic: z.string().min(1).max(200),
                title: z.string().min(1).max(180),
                summary: z.array(z.string().min(1).max(280)).length(3),
              })
              .strict(),
          )
          .max(3),
      })
      .strict()
      .optional(),
    preferredLength: z.enum(["brief", "standard", "deep"]),
    depth: z.number().int().min(0).max(100),
    novelty: z.number().int().min(0).max(100),
    edition: z
      .object({
        date: z.string().date(),
        slot: z.number().int().positive(),
        target: z.number().int().positive(),
      })
      .strict()
      .optional(),
  })
  .strict();

type PersistedGenerationContext = z.infer<
  typeof persistedGenerationContextSchema
>;

const generationRequestSnapshotSchema = z
  .object({
    version: z.literal(ARTICLE_GENERATION_REQUEST_VERSION),
    directionRevision: z.number().int().nonnegative(),
    directionEditionId: uuidSchema,
    directionEditionDate: z.string().date(),
    learningLoop: learningLoopRequestSnapshotSchema.nullable(),
    providerIdempotencyKey: z
      .string()
      .min(1)
      .max(200)
      .regex(/^[A-Za-z0-9._:-]+$/),
    context: persistedGenerationContextSchema,
  })
  .strict()
  .superRefine((snapshot, context) => {
    if ((snapshot.learningLoop === null) === (snapshot.context.learningLoop !== undefined)) {
      context.addIssue({
        code: "custom",
        path: ["context", "learningLoop"],
        message: "Learning-loop request identity and context must agree.",
      });
    }
    const loopDirections = snapshot.context.editorialDirections.filter(
      (instruction) => instruction.scope === "loop",
    );
    const expectedLoopDirections = snapshot.learningLoop?.direction ? 1 : 0;
    if (
      loopDirections.length !== expectedLoopDirections ||
      (expectedLoopDirections === 1 &&
        loopDirections[0]?.text !== snapshot.learningLoop?.direction)
    ) {
      context.addIssue({
        code: "custom",
        path: ["context", "editorialDirections"],
        message: "Learning-loop direction context must match its snapshot.",
      });
    }
  });

type GenerationRequestSnapshot = z.infer<
  typeof generationRequestSnapshotSchema
>;

export function selectActiveNewsEditorialDirections(
  candidates: readonly NewsDirectionCandidate[],
  currentEditionId: string,
) {
  return [...candidates]
    .filter(
      (instruction) =>
        instruction.scope === "persistent" ||
        instruction.editionId === currentEditionId,
    )
    .sort(
      (left, right) =>
        left.revision - right.revision || left.id.localeCompare(right.id),
    )
    .map(({ scope, text }) => ({ scope, text }));
}

export function newsDirectionSnapshotIsCurrent(
  snapshot: Pick<
    NewsDirectionSnapshot,
    "editionDate" | "editionId" | "revision"
  >,
  current:
    | {
        currentEditionDate: string | null;
        currentEditionId: string;
        revision: number;
      }
    | undefined,
) {
  return (
    current?.currentEditionId === snapshot.editionId &&
    current.currentEditionDate === snapshot.editionDate &&
    current.revision === snapshot.revision
  );
}

export function learningLoopSnapshotIsCurrent(
  snapshot: Pick<
    LearningLoopGenerationSnapshot,
    "id" | "revision" | "direction"
  > | null,
  current:
    | {
        id: string;
        revision: number;
        direction: string;
        status: string;
      }
    | undefined,
) {
  if (snapshot === null) return current === undefined;
  return (
    current?.id === snapshot.id &&
    current.status === "active" &&
    current.revision === snapshot.revision &&
    current.direction === snapshot.direction
  );
}

export function articleGenerationProviderIdempotencyKey(
  jobId: string,
  direction: Pick<NewsDirectionSnapshot, "editionId" | "revision">,
  learningLoop: Pick<
    LearningLoopGenerationSnapshot,
    "id" | "revision"
  > | null = null,
) {
  return [
    "edison-generation",
    `v${ARTICLE_GENERATION_REQUEST_VERSION}`,
    jobId,
    direction.editionId,
    `r${direction.revision}`,
    learningLoop
      ? `loop-${learningLoop.id}-r${learningLoop.revision}`
      : "unscoped",
  ].join("-");
}

export function generationRequestSnapshotMatchesDirection(
  snapshot: Pick<
    GenerationRequestSnapshot,
    "directionEditionDate" | "directionEditionId" | "directionRevision"
  >,
  direction: Pick<
    NewsDirectionSnapshot,
    "editionDate" | "editionId" | "revision"
  >,
) {
  return (
    snapshot.directionRevision === direction.revision &&
    snapshot.directionEditionId === direction.editionId &&
    snapshot.directionEditionDate === direction.editionDate
  );
}

export function generationRequestSnapshotMatchesContext(
  snapshot: Pick<
    GenerationRequestSnapshot,
    | "directionEditionDate"
    | "directionEditionId"
    | "directionRevision"
    | "learningLoop"
  >,
  direction: Pick<
    NewsDirectionSnapshot,
    "editionDate" | "editionId" | "revision"
  >,
  learningLoop: Pick<
    LearningLoopGenerationSnapshot,
    "id" | "revision" | "direction"
  > | null,
) {
  return (
    generationRequestSnapshotMatchesDirection(snapshot, direction) &&
    (learningLoop === null
      ? snapshot.learningLoop === null
      : snapshot.learningLoop?.id === learningLoop.id &&
        snapshot.learningLoop.revision === learningLoop.revision &&
        snapshot.learningLoop.direction === learningLoop.direction)
  );
}

export function newsFeedRank(
  edition: { slot: number } | undefined,
  researchedAt: Date,
) {
  // Scheduled lanes always occupy the leading integer positions regardless of
  // completion order. Commissioned and replenishment pieces append by finish
  // time and therefore cannot displace the planned lead.
  return edition ? String(edition.slot) : String(researchedAt.getTime());
}

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

async function captureNewsDirection(
  userId: string,
  requestedEditionDate: string,
) {
  return getDb().transaction(async (transaction) => {
    const lifecycle = await ensureNewsEditionForDate(
      transaction,
      userId,
      requestedEditionDate,
    );
    const state = lifecycle.state;
    const candidates = await transaction
      .select({
        id: editorialInstructions.id,
        scope: editorialInstructions.scope,
        editionId: editorialInstructions.editionId,
        text: editorialInstructions.text,
        revision: editorialInstructions.revision,
      })
      .from(editorialInstructions)
      .where(
        and(
          eq(editorialInstructions.userId, userId),
          eq(editorialInstructions.section, "news"),
          isNull(editorialInstructions.deletedAt),
        ),
      )
      .orderBy(
        asc(editorialInstructions.revision),
        asc(editorialInstructions.id),
      )
      .limit(maxEditorialInstructionsPerSection + 1);

    if (candidates.length > maxEditorialInstructionsPerSection) {
      throw new FatalError(
        "The reader's News direction exceeds its safe instruction limit",
      );
    }

    if (!state.currentEditionDate) {
      throw new FatalError("The reader's News edition date is missing");
    }

    return {
      transition: lifecycle.transition,
      snapshot: {
        revision: state.revision,
        editionId: state.currentEditionId,
        editionDate: state.currentEditionDate,
        instructions: selectActiveNewsEditorialDirections(
          candidates,
          state.currentEditionId,
        ),
      } satisfies NewsDirectionSnapshot,
    };
  });
}

async function captureActiveLearningLoop(userId: string, loopId: string) {
  const [loop] = await getDb()
    .select({
      id: learningThreads.id,
      revision: learningThreads.revision,
      direction: learningThreads.direction,
      title: learningThreads.title,
      originalCuriosity: learningThreads.originalCuriosity,
    })
    .from(learningThreads)
    .where(
      and(
        eq(learningThreads.id, loopId),
        eq(learningThreads.userId, userId),
        eq(learningThreads.status, "active"),
      ),
    )
    .limit(1);
  return loop satisfies LearningLoopGenerationSnapshot | undefined;
}

async function cancelUnavailableLearningLoopJob(
  jobId: string,
  workflowRunId: string,
) {
  const [cancelled] = await getDb()
    .update(generationJobs)
    .set({
      status: "cancelled",
      failureCode: "learning_loop_unavailable",
      error: "This learning loop is no longer active.",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(generationJobs.id, jobId),
        eq(generationJobs.status, "running"),
        eq(generationJobs.workflowRunId, workflowRunId),
      ),
    )
    .returning({ id: generationJobs.id });

  if (cancelled) return { articleId: null, cancelled: true as const };

  const [current] = await getDb()
    .select({
      status: generationJobs.status,
      outputArticleId: generationJobs.outputArticleId,
    })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (current?.outputArticleId) {
    return { articleId: current.outputArticleId, cancelled: false as const };
  }
  if (current?.status === "cancelled") {
    return { articleId: null, cancelled: true as const };
  }
  throw new FatalError("The unavailable learning-loop job could not be cancelled");
}

async function cancelSupersededEditionJob(
  jobId: string,
  workflowRunId: string,
) {
  const database = getDb();
  const [cancelled] = await database
    .update(generationJobs)
    .set({
      status: "cancelled",
      failureCode: "edition_superseded",
      error: "This News edition was superseded before generation began.",
      finishedAt: new Date(),
    })
    .where(
      and(
        eq(generationJobs.id, jobId),
        eq(generationJobs.status, "running"),
        eq(generationJobs.workflowRunId, workflowRunId),
      ),
    )
    .returning({ id: generationJobs.id });

  if (cancelled) return { articleId: null, cancelled: true as const };

  const [current] = await database
    .select({
      status: generationJobs.status,
      outputArticleId: generationJobs.outputArticleId,
    })
    .from(generationJobs)
    .where(eq(generationJobs.id, jobId))
    .limit(1);
  if (current?.outputArticleId) {
    return { articleId: current.outputArticleId, cancelled: false as const };
  }
  if (current?.status === "cancelled") {
    return { articleId: null, cancelled: true as const };
  }
  throw new FatalError("The superseded generation job could not be cancelled");
}

type PersistGenerationRequestResult =
  | { outcome: "ready"; snapshot: GenerationRequestSnapshot }
  | { outcome: "completed"; articleId: string }
  | { outcome: "direction_changed" }
  | { outcome: "learning_loop_changed" }
  | { outcome: "learning_loop_unavailable" };

async function persistGenerationRequestSnapshot(
  jobId: string,
  workflowRunId: string,
  direction: NewsDirectionSnapshot,
  learningLoop: LearningLoopGenerationSnapshot | null,
  freshContext: PersistedGenerationContext,
): Promise<PersistGenerationRequestResult> {
  return getDb().transaction(async (transaction) => {
    const [job] = await transaction
      .select({
        status: generationJobs.status,
        workflowRunId: generationJobs.workflowRunId,
        outputArticleId: generationJobs.outputArticleId,
        input: generationJobs.input,
      })
      .from(generationJobs)
      .where(eq(generationJobs.id, jobId))
      .for("update")
      .limit(1);
    if (!job) throw new FatalError("Generation job no longer exists");
    if (job.outputArticleId) {
      return { outcome: "completed", articleId: job.outputArticleId };
    }
    if (job.status !== "running" || job.workflowRunId !== workflowRunId) {
      throw new FatalError(
        "Generation job is no longer owned by this workflow run",
      );
    }

    // Keep the direction row share-locked until the request snapshot is
    // durable. Direction mutations and edition rotation need an update lock,
    // so they cannot slip between this check and the snapshot write.
    const [currentDirection] = await transaction
      .select({
        currentEditionDate: editorialDirectionStates.currentEditionDate,
        currentEditionId: editorialDirectionStates.currentEditionId,
        revision: editorialDirectionStates.revision,
      })
      .from(editorialDirectionStates)
      .where(
        and(
          eq(editorialDirectionStates.userId, freshContext.userId),
          eq(editorialDirectionStates.section, "news"),
        ),
      )
      .for("share")
      .limit(1);
    if (!newsDirectionSnapshotIsCurrent(direction, currentDirection)) {
      return { outcome: "direction_changed" };
    }

    const [currentLearningLoop] = learningLoop
      ? await transaction
          .select({
            id: learningThreads.id,
            revision: learningThreads.revision,
            direction: learningThreads.direction,
            status: learningThreads.status,
          })
          .from(learningThreads)
          .where(
            and(
              eq(learningThreads.id, learningLoop.id),
              eq(learningThreads.userId, freshContext.userId),
            ),
          )
          .for("share")
          .limit(1)
      : [];
    if (learningLoop && currentLearningLoop?.status !== "active") {
      return { outcome: "learning_loop_unavailable" };
    }
    if (
      !learningLoopSnapshotIsCurrent(learningLoop, currentLearningLoop)
    ) {
      return { outcome: "learning_loop_changed" };
    }

    if (
      !job.input ||
      typeof job.input !== "object" ||
      Array.isArray(job.input)
    ) {
      throw new FatalError("Generation job input is not an object");
    }
    const currentInput = job.input as Record<string, unknown>;
    const storedValue = currentInput.newsGenerationRequest;
    if (storedValue !== undefined) {
      const parsedStored = generationRequestSnapshotSchema.safeParse(storedValue);
      if (!parsedStored.success) {
        // Never overwrite a malformed durable snapshot: a provider request may
        // already have used its key, so replacement could silently double-spend.
        throw new FatalError(
          "Generation job contains an invalid provider request snapshot",
        );
      }
      const stored = parsedStored.data;
      if (
        generationRequestSnapshotMatchesContext(
          stored,
          direction,
          learningLoop,
        )
      ) {
        const expectedKey = articleGenerationProviderIdempotencyKey(
          jobId,
          direction,
          learningLoop,
        );
        if (stored.providerIdempotencyKey !== expectedKey) {
          throw new FatalError(
            "Generation job contains an invalid provider idempotency key",
          );
        }
        // Preferences, interests, and recent titles may have changed after an
        // ambiguous provider timeout. Reuse the exact stored request anyway.
        return { outcome: "ready", snapshot: stored };
      }
      const storedLoop = stored.learningLoop;
      const loopCannotAdvance =
        (storedLoop === null) !== (learningLoop === null) ||
        (storedLoop !== null &&
          learningLoop !== null &&
          (storedLoop.id !== learningLoop.id ||
            storedLoop.revision > learningLoop.revision ||
            (storedLoop.revision === learningLoop.revision &&
              storedLoop.direction !== learningLoop.direction)));
      const directionCannotAdvance =
        stored.directionRevision > direction.revision ||
        (stored.directionRevision === direction.revision &&
          (stored.directionEditionId !== direction.editionId ||
            stored.directionEditionDate !== direction.editionDate));
      if (loopCannotAdvance || directionCannotAdvance) {
        throw new FatalError(
          "Generation provider request snapshot cannot move backward or change identity at one revision",
        );
      }
      // A strictly newer editorial or selected-loop revision intentionally
      // starts one new logical provider request. Stale observed responses are
      // ledgered before the workflow advances to this point.
    }

    const snapshot = generationRequestSnapshotSchema.parse({
      version: ARTICLE_GENERATION_REQUEST_VERSION,
      directionRevision: direction.revision,
      directionEditionId: direction.editionId,
      directionEditionDate: direction.editionDate,
      learningLoop: learningLoop
        ? {
            id: learningLoop.id,
            revision: learningLoop.revision,
            direction: learningLoop.direction,
          }
        : null,
      providerIdempotencyKey: articleGenerationProviderIdempotencyKey(
        jobId,
        direction,
        learningLoop,
      ),
      context: freshContext,
    });
    const [savedSnapshot] = await transaction
      .update(generationJobs)
      .set({
        input: {
          ...currentInput,
          newsGenerationRequest: snapshot,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.status, "running"),
          eq(generationJobs.workflowRunId, workflowRunId),
        ),
      )
      .returning({ id: generationJobs.id });
    if (!savedSnapshot) {
      throw new FatalError(
        "Generation provider request snapshot could not be persisted",
      );
    }
    return { outcome: "ready", snapshot };
  });
}

async function recordRejectedArticleGeneration(
  jobId: string,
  workflowRunId: string,
  userId: string,
  error: ProviderResponseValidationError,
  webSearchCostMicrousd: number,
) {
  const usage = error.observedUsage;
  const webSearchCalls = usage.webSearchCalls ?? 0;
  let costMicrousd: number | null = null;
  let unpricedModel = false;
  try {
    costMicrousd =
      estimatedArticleCostMicrousd({
        ...usage,
        webSearchCalls,
      }) +
      webSearchCalls * webSearchCostMicrousd;
  } catch (pricingError) {
    if (!(pricingError instanceof UnpricedOpenAiModelError)) {
      throw pricingError;
    }
    // Preserve the response/tokens under an explicitly unpriced operation.
    // The nullable cost remains unknown until an operator reconciles the
    // provider invoice; it must never masquerade as a zero-cost response.
    unpricedModel = true;
  }

  await getDb().transaction(async (transaction) => {
    await transaction
      .insert(usageLedger)
      .values({
        userId,
        generationJobId: jobId,
        operation: unpricedModel
          ? "article_generation_rejected_unpriced_response"
          : "article_generation_rejected_provider_response",
        provider: "openai",
        providerResponseId: usage.providerResponseId,
        pricingStatus: unpricedModel ? "unpriced" : "priced",
        model: usage.model,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        webSearchCalls,
        costMicrousd,
      })
      .onConflictDoNothing();
    await transaction
      .update(generationJobs)
      .set({
        providerResponseId: usage.providerResponseId,
        model: usage.model,
        failureCode: unpricedModel
          ? "provider_model_unpriced"
          : "provider_response_invalid",
        error:
          "The model returned an observed response that was not safe to publish.",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.status, "running"),
          eq(generationJobs.workflowRunId, workflowRunId),
        ),
      );
  });
}

async function recordUnpricedArticleGeneration(
  jobId: string,
  workflowRunId: string,
  userId: string,
  usage: {
    providerResponseId: string;
    model: string;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
    webSearchCalls: number;
  },
) {
  await getDb().transaction(async (transaction) => {
    await transaction
      .insert(usageLedger)
      .values({
        userId,
        generationJobId: jobId,
        operation: "article_generation_unpriced_provider_response",
        provider: "openai",
        providerResponseId: usage.providerResponseId,
        model: usage.model,
        inputTokens: usage.inputTokens,
        cachedInputTokens: usage.cachedInputTokens,
        outputTokens: usage.outputTokens,
        webSearchCalls: usage.webSearchCalls,
        pricingStatus: "unpriced",
        costMicrousd: null,
      })
      .onConflictDoNothing();
    await transaction
      .update(generationJobs)
      .set({
        providerResponseId: usage.providerResponseId,
        model: usage.model,
        failureCode: "provider_model_unpriced",
        error:
          "The provider returned a model identity without configured pricing.",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.status, "running"),
          eq(generationJobs.workflowRunId, workflowRunId),
        ),
      );
  });
}

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

  const input = record.job.input as {
    topic?: string;
    category?: string;
    source?: string;
    editionDate?: string;
    newsEditionId?: string;
    learningLoopId?: string;
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
  if (input.source === "daily-edition-scheduler" && !edition) {
    throw new FatalError("Generation job contains invalid edition metadata");
  }
  const parsedScheduledEditionId = uuidSchema.safeParse(input.newsEditionId);
  if (input.newsEditionId !== undefined && !parsedScheduledEditionId.success) {
    throw new FatalError("Generation job contains an invalid News edition ID");
  }
  const scheduledEditionId = parsedScheduledEditionId.success
    ? parsedScheduledEditionId.data
    : undefined;
  const parsedLearningLoopId = uuidSchema.safeParse(input.learningLoopId);
  if (input.learningLoopId !== undefined && !parsedLearningLoopId.success) {
    throw new FatalError("Generation job contains an invalid learning loop ID");
  }
  const learningLoop = parsedLearningLoopId.success
    ? await captureActiveLearningLoop(
        record.job.userId,
        parsedLearningLoopId.data,
      )
    : undefined;
  if (parsedLearningLoopId.success && !learningLoop) {
    return cancelUnavailableLearningLoopJob(jobId, workflowRunId);
  }

  const [
    interests,
    recentArticles,
    previousPrivateLoopArticles,
    previousPublicLoopArticles,
  ] = await Promise.all([
    database
      .select({ topic: userInterests.topic, status: userInterests.status })
      .from(userInterests)
      .where(
        and(
          eq(userInterests.userId, record.job.userId),
          eq(userInterests.kind, "explicit"),
          inArray(userInterests.status, ["active", "muted"]),
        ),
      )
      .orderBy(asc(userInterests.createdAt), asc(userInterests.id))
      .limit(maxRetainedExplicitInterests),
    database
      .select({ title: articles.title })
      .from(articles)
      .where(eq(articles.ownerId, record.job.userId))
      .orderBy(desc(articles.createdAt), desc(articles.id))
      .limit(20),
    learningLoop
      ? database
          .select({
            topic: articles.topic,
            title: articles.title,
            summary: articles.summary,
          })
          .from(articles)
          .where(
            and(
              eq(articles.ownerId, record.job.userId),
              eq(articles.learningThreadId, learningLoop.id),
              eq(articles.status, "published"),
            ),
          )
          .orderBy(desc(articles.publishedAt), desc(articles.id))
          .limit(3)
      : Promise.resolve([]),
    learningLoop
      ? database
          .select({
            snapshot: publicStarterEditionArticles.snapshot,
          })
          .from(learningLoopPublicArticles)
          .innerJoin(
            publicStarterEditionArticles,
            eq(
              publicStarterEditionArticles.id,
              learningLoopPublicArticles.publicArticleId,
            ),
          )
          .innerJoin(
            publicStarterEditions,
            eq(
              publicStarterEditions.id,
              publicStarterEditionArticles.editionId,
            ),
          )
          .where(
            and(
              eq(learningLoopPublicArticles.loopId, learningLoop.id),
              eq(learningLoopPublicArticles.userId, record.job.userId),
              inArray(publicStarterEditions.status, ["published", "archived"]),
              lte(publicStarterEditions.publishedAt, new Date()),
            ),
          )
          .orderBy(asc(learningLoopPublicArticles.position))
          .limit(3)
      : Promise.resolve([]),
  ]);
  const previousLoopArticles = [
    ...previousPrivateLoopArticles,
    ...previousPublicLoopArticles.map((row) => {
      const snapshot = sharedArticleSnapshotSchema.parse(row.snapshot);
      return {
        topic: snapshot.topic,
        title: snapshot.title,
        summary: snapshot.summary,
      };
    }),
  ].slice(0, 3);

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
  const requestedEditionDate =
    edition?.date ?? dateKeyInTimeZone(new Date(), record.profile.timezone);
  const capturedDirection = await captureNewsDirection(
    record.job.userId,
    requestedEditionDate,
  );
  const direction = capturedDirection.snapshot;
  if (
    edition &&
    (capturedDirection.transition === "superseded" ||
      direction.editionDate !== edition.date ||
      (scheduledEditionId !== undefined &&
        scheduledEditionId !== direction.editionId))
  ) {
    return cancelSupersededEditionJob(jobId, workflowRunId);
  }
  const generationContext = persistedGenerationContextSchema.parse({
    userId: record.job.userId,
    requestedTopic: input.topic ?? learningLoop?.originalCuriosity,
    requestedCategory,
    currentDate: direction.editionDate,
    articleModel: getArticleModel(),
    allowedCategories,
    editorialDirections: [
      ...direction.instructions,
      ...(learningLoop?.direction
        ? [{ scope: "loop" as const, text: learningLoop.direction }]
        : []),
    ],
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
    learningLoop: learningLoop
      ? {
          title: learningLoop.title,
          originalCuriosity: learningLoop.originalCuriosity,
          previousArticles: previousLoopArticles,
        }
      : undefined,
    preferredLength: record.preferences.articleLength,
    depth: record.preferences.depth,
    novelty: record.preferences.novelty,
    edition,
  });
  const persistedRequest = await persistGenerationRequestSnapshot(
    jobId,
    workflowRunId,
    direction,
    learningLoop ?? null,
    generationContext,
  );
  if (persistedRequest.outcome === "completed") {
    return { articleId: persistedRequest.articleId };
  }
  if (persistedRequest.outcome === "direction_changed") {
    throw new RetryableError(
      "Editorial direction changed before the provider request was captured.",
      { retryAfter: "1s" },
    );
  }
  if (persistedRequest.outcome === "learning_loop_unavailable") {
    return cancelUnavailableLearningLoopJob(jobId, workflowRunId);
  }
  if (persistedRequest.outcome === "learning_loop_changed") {
    throw new RetryableError(
      "Learning-loop direction changed before the provider request was captured.",
      { retryAfter: "1s" },
    );
  }

  let result: Awaited<ReturnType<typeof generateArticle>>;
  try {
    result = await generateArticle({
      ...persistedRequest.snapshot.context,
      providerIdempotencyKey:
        persistedRequest.snapshot.providerIdempotencyKey,
      providerTimeoutMs: ARTICLE_GENERATION_PROVIDER_TIMEOUT_MS,
    });
  } catch (error) {
    if (error instanceof ProviderResponseValidationError) {
      await recordRejectedArticleGeneration(
        jobId,
        workflowRunId,
        record.job.userId,
        error,
        webSearchCostMicrousd,
      );
      // Reusing the key would replay the same observed invalid response. Treat
      // it as terminal; only a newer editorial or loop revision creates a new
      // request.
      throw new FatalError("The model response was not safe to publish");
    }
    // A transport failure is ambiguous: the step may retry, but the durable
    // snapshot and key above guarantee the exact same logical request.
    throw error;
  }

  const articleId = crypto.randomUUID();
  const sourceIds = new Map(
    result.article.sources.map((source) => [source.key, crypto.randomUUID()]),
  );
  const slug = `${slugifyArticleTitle(result.article.title)}-${jobId.slice(0, 8)}`;
  const researchedAt = new Date();
  const editionDate = direction.editionDate;
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
  let costMicrousd: number;
  try {
    costMicrousd =
      estimatedArticleCostMicrousd(result) +
      (Number.isFinite(searchCost) ? searchCost : 0);
  } catch (error) {
    if (!(error instanceof UnpricedOpenAiModelError)) throw error;
    await recordUnpricedArticleGeneration(
      jobId,
      workflowRunId,
      record.job.userId,
      result,
    );
    throw new FatalError("OpenAI returned an unpriced model identity");
  }
  const usage = {
    userId: record.job.userId,
    generationJobId: jobId,
    provider: "openai",
    providerResponseId: result.providerResponseId,
    pricingStatus: "priced",
    model: result.model,
    inputTokens: result.inputTokens,
    cachedInputTokens: result.cachedInputTokens,
    outputTokens: result.outputTokens,
    webSearchCalls: result.webSearchCalls,
    costMicrousd,
  } as const;

  let publishedArticleId = articleId;
  let discardedContext:
    | "editorial_direction_changed"
    | "learning_loop_changed"
    | "learning_loop_unavailable"
    | null = null;
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

    const [currentDirection] = await transaction
      .select({
        currentEditionDate: editorialDirectionStates.currentEditionDate,
        currentEditionId: editorialDirectionStates.currentEditionId,
        revision: editorialDirectionStates.revision,
      })
      .from(editorialDirectionStates)
      .where(
        and(
          eq(editorialDirectionStates.userId, record.job.userId),
          eq(editorialDirectionStates.section, "news"),
        ),
      )
      .for("share")
      .limit(1);
    const [currentLearningLoop] = learningLoop
      ? await transaction
          .select({
            id: learningThreads.id,
            revision: learningThreads.revision,
            direction: learningThreads.direction,
            status: learningThreads.status,
          })
          .from(learningThreads)
          .where(
            and(
              eq(learningThreads.id, learningLoop.id),
              eq(learningThreads.userId, record.job.userId),
            ),
          )
          .for("share")
          .limit(1)
      : [];
    const directionIsCurrent = newsDirectionSnapshotIsCurrent(
      direction,
      currentDirection,
    );
    const loopIsCurrent = learningLoopSnapshotIsCurrent(
      learningLoop ?? null,
      currentLearningLoop,
    );
    if (!directionIsCurrent || !loopIsCurrent) {
      discardedContext = !directionIsCurrent
        ? "editorial_direction_changed"
        : currentLearningLoop?.status !== "active"
          ? "learning_loop_unavailable"
          : "learning_loop_changed";
      await transaction
        .insert(usageLedger)
        .values({
          ...usage,
          operation:
            discardedContext === "editorial_direction_changed"
              ? "article_generation_discarded_stale_direction"
              : discardedContext === "learning_loop_unavailable"
                ? "article_generation_discarded_inactive_loop"
                : "article_generation_discarded_stale_loop_direction",
        })
        .onConflictDoNothing();
      await transaction
        .update(generationJobs)
        .set({
          ...(discardedContext === "learning_loop_unavailable"
            ? { status: "cancelled" as const, finishedAt: new Date() }
            : {}),
          providerResponseId: result.providerResponseId,
          model: result.model,
          failureCode: discardedContext,
          error:
            discardedContext === "editorial_direction_changed"
              ? "Editorial direction changed during generation; retrying with the current revision."
              : discardedContext === "learning_loop_unavailable"
                ? "The learning loop became inactive during generation."
                : "Learning-loop direction changed during generation; retrying with the current revision.",
        })
        .where(
          and(
            eq(generationJobs.id, jobId),
            eq(generationJobs.status, "running"),
            eq(generationJobs.workflowRunId, workflowRunId),
          ),
        );
      return;
    }

    await transaction.insert(articles).values({
      id: articleId,
      ownerId: record.job.userId,
      learningThreadId: learningLoop?.id ?? null,
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
      editionId: direction.editionId,
      editionDate,
      rank: newsFeedRank(edition, researchedAt),
      reason: result.article.whyWritten,
    });

    await transaction
      .insert(usageLedger)
      .values({
        ...usage,
        operation: "article_generation",
      })
      .onConflictDoNothing();

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

  if (discardedContext === "learning_loop_unavailable") {
    return { articleId: null, cancelled: true as const };
  }
  if (discardedContext) {
    throw new RetryableError(
      discardedContext === "editorial_direction_changed"
        ? "Editorial direction changed while the News article was being generated."
        : "Learning-loop direction changed while the News article was being generated.",
      { retryAfter: "1s" },
    );
  }

  return { articleId: publishedArticleId };
}

generateAndPublish.maxRetries = 3;

async function markJobFailed(jobId: string, workflowRunId: string) {
  "use step";

  await getDb()
    .update(generationJobs)
    .set({
      status: "failed",
      failureCode: sql`coalesce(${generationJobs.failureCode}, 'generation_failed')`,
      error: sql`coalesce(${generationJobs.error}, 'Article generation failed after retries.')`,
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
