export type ObservedProviderUsage = {
  providerResponseId: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  webSearchCalls?: number;
  // v2 bills search actions, but bounds search/open/find actions together.
  webSearchToolCalls?: number;
  webSearchPricingStatus?: "priced" | "unpriced";
  // Actual provider metadata, not the requested tier. Missing legacy metadata
  // stays absent; an unusable value on a tier-aware response is explicit null.
  serviceTier?: string | null;
};

/**
 * The provider returned (and may have billed for) a response, but Edison could
 * not safely use its structured payload. Callers can still account for the
 * observed usage without logging response content.
 */
export class ProviderResponseValidationError extends Error {
  constructor(
    message: string,
    public readonly observedUsage: ObservedProviderUsage,
  ) {
    super(message);
    this.name = "ProviderResponseValidationError";
  }
}

export function providerResponseUsage(response: {
  id: string;
  model: string;
  service_tier?: unknown;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  } | null;
}, options: { requireServiceTier?: boolean } = {}): ObservedProviderUsage {
  const retainTier = Object.hasOwn(response, "service_tier") || options.requireServiceTier === true;
  const serviceTier = Object.hasOwn(response, "service_tier") && typeof response.service_tier === "string" && response.service_tier.length > 0 && response.service_tier.length <= 80
    ? response.service_tier : null;
  return {
    providerResponseId: response.id,
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    ...(retainTier ? { serviceTier } : {}),
  };
}
