import { and, count, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { generationJobs, getDb, profiles, usageLedger } from "@edison/db";
import { z } from "zod";
import { apiHandler, json } from "../../../../src/http/api-handler";
import { requireActiveAdmin } from "../../../../src/services/admin";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  hours: z.coerce.number().int().min(1).max(24 * 30).default(24),
});

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    await requireActiveAdmin(claims);

    const url = new URL(request.url);
    const { limit, hours } = querySchema.parse({
      limit: url.searchParams.get("limit") ?? undefined,
      hours: url.searchParams.get("hours") ?? undefined,
    });
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const database = getDb();

    const [jobs, statusRows, undispatchedRows, usageRows] = await Promise.all([
      database
        .select({
          id: generationJobs.id,
          userId: generationJobs.userId,
          userEmail: profiles.email,
          kind: generationJobs.kind,
          status: generationJobs.status,
          attemptCount: generationJobs.attemptCount,
          workflowRunId: generationJobs.workflowRunId,
          outputArticleId: generationJobs.outputArticleId,
          failureCode: generationJobs.failureCode,
          error: generationJobs.error,
          nextAttemptAt: generationJobs.nextAttemptAt,
          createdAt: generationJobs.createdAt,
          updatedAt: generationJobs.updatedAt,
          startedAt: generationJobs.startedAt,
          finishedAt: generationJobs.finishedAt,
        })
        .from(generationJobs)
        .innerJoin(profiles, eq(profiles.id, generationJobs.userId))
        .orderBy(desc(generationJobs.createdAt))
        .limit(limit),
      database
        .select({ status: generationJobs.status, value: count() })
        .from(generationJobs)
        .where(gte(generationJobs.createdAt, since))
        .groupBy(generationJobs.status),
      database
        .select({ value: count() })
        .from(generationJobs)
        .where(
          and(
            eq(generationJobs.status, "queued"),
            isNull(generationJobs.workflowRunId),
          ),
        ),
      database
        .select({
          operations: sql<number>`count(*)::int`.mapWith(Number),
          inputTokens:
            sql<number>`coalesce(sum(${usageLedger.inputTokens}), 0)`.mapWith(
              Number,
            ),
          cachedInputTokens:
            sql<number>`coalesce(sum(${usageLedger.cachedInputTokens}), 0)`.mapWith(
              Number,
            ),
          outputTokens:
            sql<number>`coalesce(sum(${usageLedger.outputTokens}), 0)`.mapWith(
              Number,
            ),
          webSearchCalls:
            sql<number>`coalesce(sum(${usageLedger.webSearchCalls}), 0)`.mapWith(
              Number,
            ),
          costMicrousd:
            sql<number>`coalesce(sum(${usageLedger.costMicrousd}), 0)`.mapWith(
              Number,
            ),
          unpricedResponses:
            sql<number>`count(*) filter (where ${usageLedger.pricingStatus} = 'unpriced')::int`.mapWith(
              Number,
            ),
        })
        .from(usageLedger)
        .where(gte(usageLedger.createdAt, since)),
    ]);

    const jobsByStatus = {
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      cancelled: 0,
    };
    for (const row of statusRows) jobsByStatus[row.status] = row.value;

    const usage = usageRows[0] ?? {
      operations: 0,
      inputTokens: 0,
      cachedInputTokens: 0,
      outputTokens: 0,
      webSearchCalls: 0,
      costMicrousd: 0,
      unpricedResponses: 0,
    };

    return json({
      window: { hours, since: since.toISOString() },
      jobs: jobs.map((job) => ({
        ...job,
        nextAttemptAt: job.nextAttemptAt.toISOString(),
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      })),
      summary: {
        jobsByStatus,
        queuedWithoutWorkflowRunId: undispatchedRows[0]?.value ?? 0,
        usage: {
          ...usage,
          knownCostUsd: usage.costMicrousd / 1_000_000,
          estimatedCostUsd:
            usage.unpricedResponses > 0
              ? null
              : usage.costMicrousd / 1_000_000,
        },
      },
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
