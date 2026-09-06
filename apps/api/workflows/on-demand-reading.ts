import { getWorkflowMetadata } from "workflow";
import { advanceDemandRequest, claimDemandRequest, failDemandRequest } from "../src/services/demand-runner";

export async function onDemandReadingWorkflow(requestId: string) {
  "use workflow";
  const { workflowRunId } = getWorkflowMetadata();
  let phase: string | null;
  try {
    phase = await claim(requestId, workflowRunId);
  } catch {
    // If the claim committed but its acknowledgement was lost, failure
    // settlement returns the saved checkpoint instead of overwriting it.
    phase = await fail(requestId, workflowRunId);
  }
  // At most research + four retrieval groups + check, or write/check/repair/check.
  // Bound the orchestration too; a malformed phase cannot create an endless job.
  for (let steps = 0; phase !== null && steps < 16; steps += 1) {
    const expectedCheckpoint = phase;
    try {
      phase = await advance(requestId, workflowRunId, expectedCheckpoint);
    } catch {
      // Exact checkpoint CAS distinguishes a real failure from an ambiguous
      // commit or duplicate delivery that already advanced durable progress.
      phase = await fail(requestId, workflowRunId, expectedCheckpoint);
    }
  }
  if (phase !== null) await fail(requestId, workflowRunId, phase);
  return { requestId };
}

async function claim(requestId: string, runId: string) {
  "use step";
  return claimDemandRequest(requestId, runId);
}
async function advance(requestId: string, runId: string, phase: string) {
  "use step";
  return advanceDemandRequest(requestId, runId, phase);
}
async function fail(requestId: string, runId: string, checkpoint?: string) {
  "use step";
  return failDemandRequest(requestId, runId, "worker_interrupted", checkpoint);
}
claim.maxRetries = 2;
advance.maxRetries = 3;
fail.maxRetries = 2;
