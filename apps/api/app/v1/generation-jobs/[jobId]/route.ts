import { and, eq } from "drizzle-orm";
import { generationJobSchema, uuidSchema } from "@edison/contracts";
import { generationJobs, getDb } from "@edison/db";
import { apiHandler, json } from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";
import { withActiveMember } from "../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ jobId: string }> };

export async function GET(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { jobId: rawJobId } = await context.params;
    const jobId = uuidSchema.parse(rawJobId);
    await withActiveMember(claims, async () => undefined);

    const [job] = await getDb()
      .select()
      .from(generationJobs)
      .where(
        and(
          eq(generationJobs.id, jobId),
          eq(generationJobs.userId, claims.sub),
        ),
      )
      .limit(1);

    if (!job) {
      throw new HttpError(404, "job_not_found", "That generation job was not found.");
    }

    return json(
      generationJobSchema.parse({
        id: job.id,
        kind: job.kind,
        status: job.status,
        attemptCount: job.attemptCount,
        outputArticleId: job.outputArticleId,
        failureCode: job.failureCode,
        createdAt: job.createdAt.toISOString(),
        startedAt: job.startedAt?.toISOString() ?? null,
        finishedAt: job.finishedAt?.toISOString() ?? null,
      }),
    );
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
