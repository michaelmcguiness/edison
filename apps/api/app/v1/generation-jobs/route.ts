import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  createGenerationJobSchema,
  generationJobSchema,
  type CreateGenerationJob,
} from "@edison/contracts";
import { feedPreferences, generationJobs, getDb } from "@edison/db";
import { apiHandler, json } from "../../../src/http/api-handler";
import { HttpError } from "../../../src/http/errors";
import { dispatchGenerationJob } from "../../../src/services/generation-jobs";
import { withActiveMember } from "../../../src/services/members";

export const dynamic = "force-dynamic";

function presentJob(job: typeof generationJobs.$inferSelect) {
  return generationJobSchema.parse({
    id: job.id,
    kind: job.kind,
    status: job.status,
    attemptCount: job.attemptCount,
    outputArticleId: job.outputArticleId,
    failureCode: job.failureCode,
    createdAt: job.createdAt.toISOString(),
    startedAt: job.startedAt?.toISOString() ?? null,
    finishedAt: job.finishedAt?.toISOString() ?? null,
  });
}

function assertIdempotentRequestMatches(
  job: typeof generationJobs.$inferSelect,
  input: CreateGenerationJob,
) {
  const storedInput = job.input as { topic?: unknown; category?: unknown };
  if (
    job.kind !== input.kind ||
    (typeof storedInput.topic === "string" ? storedInput.topic : undefined) !==
      input.topic ||
    (typeof storedInput.category === "string"
      ? storedInput.category
      : undefined) !== input.category
  ) {
    throw new HttpError(
      409,
      "idempotency_key_reused",
      "That idempotency key was already used for a different generation request.",
    );
  }
}

function configuredGenerationLimit() {
  const limit = Number(process.env.OPENAI_MAX_DAILY_GENERATIONS ?? "8");
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new HttpError(
      503,
      "generation_limit_not_configured",
      "Article generation is unavailable because its daily limit is invalid.",
    );
  }
  return limit;
}

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    await withActiveMember(claims, async () => undefined);
    const jobs = await getDb()
      .select()
      .from(generationJobs)
      .where(eq(generationJobs.userId, claims.sub))
      .orderBy(desc(generationJobs.createdAt))
      .limit(50);
    return json({ jobs: jobs.map(presentJob) });
  });
}

export async function POST(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = createGenerationJobSchema.parse(await request.json());
    const preferences = await withActiveMember(
      claims,
      async ({ transaction }) => {
        const [row] = await transaction
          .select({ categoryVisibility: feedPreferences.categoryVisibility })
          .from(feedPreferences)
          .where(eq(feedPreferences.userId, claims.sub))
          .limit(1);
        if (!row) {
          throw new HttpError(
            500,
            "profile_incomplete",
            "The reader profile is missing its feed preferences.",
          );
        }
        return row;
      },
    );
    if (!process.env.OPENAI_API_KEY) {
      throw new HttpError(
        503,
        "ai_not_configured",
        "Article generation is unavailable until OpenAI is configured.",
      );
    }

    if (
      input.category &&
      preferences.categoryVisibility[input.category] === false
    ) {
      throw new HttpError(
        409,
        "category_hidden",
        "That section is hidden in this reader's preferences.",
      );
    }

    const database = getDb();
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const limit = configuredGenerationLimit();
    const result = await database.transaction(async (transaction) => {
      // The scheduler uses the same per-reader lock. Counting and reserving a
      // job is therefore atomic across manual and scheduled generation.
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`edison-generation:${claims.sub}`}, 0)
        )
      `);

      const [existing] = await transaction
        .select()
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.userId, claims.sub),
            eq(generationJobs.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1);
      if (existing) {
        assertIdempotentRequestMatches(existing, input);
        return { job: existing, created: false };
      }

      const [{ value: recentCount }] = await transaction
        .select({ value: count() })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.userId, claims.sub),
            gte(generationJobs.createdAt, since),
          ),
        );
      if (recentCount >= limit) {
        throw new HttpError(
          429,
          "generation_limit_reached",
          "This reader's generation limit has been reached for today.",
        );
      }

      const [created] = await transaction
        .insert(generationJobs)
        .values({
          userId: claims.sub,
          kind: input.kind,
          idempotencyKey: input.idempotencyKey,
          input: {
            ...(input.topic ? { topic: input.topic } : {}),
            ...(input.category ? { category: input.category } : {}),
          },
        })
        .onConflictDoNothing()
        .returning();
      if (!created) {
        throw new HttpError(
          500,
          "job_creation_failed",
          "The generation job could not be reserved.",
        );
      }
      return { job: created, created: true };
    });

    if (!result.created) return json(presentJob(result.job));

    try {
      await dispatchGenerationJob(result.job.id);
    } catch (error) {
      console.error("Workflow dispatch failed; reconciler will retry", {
        jobId: result.job.id,
        error,
      });
    }

    return json(presentJob(result.job), { status: 202 });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
