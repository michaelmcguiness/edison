import { z } from "zod";

export const DEMAND_PROVIDER_POLICY_VERSION = "edison-demand-provider-policy-v1";
export const DEMAND_PROVIDER_PRICING_VERSION = "openai-terra-luna-2026-09-08-v1";

export const demandProviderPolicySchema = z.object({
  version: z.literal(DEMAND_PROVIDER_POLICY_VERSION),
  requestedServiceTier: z.enum(["default", "priority"]),
  pricingVersion: z.literal(DEMAND_PROVIDER_PRICING_VERSION),
}).strict();

export type DemandProviderPolicy = z.infer<typeof demandProviderPolicySchema>;

/** Absence is a frozen legacy contract, not an alias for a malformed policy. */
export function readDemandProviderPolicy(input: { providerPolicy?: unknown }): DemandProviderPolicy | undefined {
  return Object.hasOwn(input, "providerPolicy") ? demandProviderPolicySchema.parse(input.providerPolicy) : undefined;
}
