import { demandProviderPolicySchema, type DemandProviderPolicy } from "@edison/ai";
import { HttpError } from "../http/errors";
import type { DemandRequestRow } from "./demand-reading";

type PolicyIdentity = Pick<DemandRequestRow, "kind" | "snapshot">;
type ProviderOptions = { providerPolicy?: DemandProviderPolicy };

/** Called only at fresh admission, after idempotency and canonical lookups.
 * Omission preserves the exact historical provider request and stage hash. */
export function admissionDemandProviderPolicy(kind: DemandRequestRow["kind"], snapshot: Record<string, unknown>): ProviderOptions {
  if (process.env.EDISON_DEMAND_FAST_ENABLED !== "true" || snapshot.version !== 2 || !["ideas", "article", "question"].includes(kind)) return {};
  return { providerPolicy: demandProviderPolicySchema.parse({
    version: "edison-demand-provider-policy-v1", requestedServiceTier: "priority", pricingVersion: "openai-terra-luna-2026-09-08-v1",
  }) };
}

/** A stored absence means legacy, not the current deployment setting. Own
 * invalid values must survive initialization so validation cannot erase them. */
export function demandProviderPolicyCompatibilityFailure(request: PolicyIdentity, state: Record<string, unknown>) {
  const snapshotHasPolicy = Object.hasOwn(request.snapshot, "providerPolicy");
  const stateHasPolicy = Object.hasOwn(state, "providerPolicy");
  if (!snapshotHasPolicy && !stateHasPolicy) return null;
  if (request.snapshot.version !== 2 || !["ideas", "article", "question"].includes(request.kind)) return "pipeline_version_unsupported";
  const snapshot = demandProviderPolicySchema.safeParse(request.snapshot.providerPolicy);
  const progress = demandProviderPolicySchema.safeParse(state.providerPolicy);
  if ((snapshotHasPolicy && !snapshot.success) || (stateHasPolicy && !progress.success)) return "pipeline_version_unsupported";
  if (snapshotHasPolicy !== stateHasPolicy || !snapshot.success || !progress.success ||
    snapshot.data.version !== progress.data.version || snapshot.data.requestedServiceTier !== progress.data.requestedServiceTier ||
    snapshot.data.pricingVersion !== progress.data.pricingVersion) return "pipeline_state_invalid";
  return null;
}

export function demandProviderOptions(request: PolicyIdentity, state: Record<string, unknown>): ProviderOptions {
  const failure = demandProviderPolicyCompatibilityFailure(request, state);
  if (failure) throw new HttpError(503, failure, "This explanation could not be safely prepared.");
  return Object.hasOwn(request.snapshot, "providerPolicy")
    ? { providerPolicy: demandProviderPolicySchema.parse(request.snapshot.providerPolicy) }
    : {};
}
