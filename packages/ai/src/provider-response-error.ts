export type ObservedProviderUsage = {
  providerResponseId: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  webSearchCalls?: number;
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
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  } | null;
}): ObservedProviderUsage {
  return {
    providerResponseId: response.id,
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
