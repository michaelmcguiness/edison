import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient } from "./client";
import { providerResponseUsage, ProviderResponseValidationError } from "./provider-response-error";
import type { OnDemandProvider } from "./on-demand";

function researchUrls(output: unknown[]) {
  const urls = new Set<string>();
  for (const item of output) {
    if (!item || typeof item !== "object" || !("type" in item) || item.type !== "web_search_call" || !("action" in item)) continue;
    const action = item.action;
    if (!action || typeof action !== "object" || !("type" in action)) continue;
    if (action.type === "open_page" && "url" in action && typeof action.url === "string") urls.add(action.url);
    if (action.type === "search" && "sources" in action && Array.isArray(action.sources)) {
      for (const source of action.sources) {
        if (source && typeof source === "object" && "url" in source && typeof source.url === "string") urls.add(source.url);
      }
    }
  }
  return [...urls];
}

/** One provider request only. The caller owns durable retries and stage ledgers. */
export const openAIOnDemandProvider: OnDemandProvider = async (request) => {
  const response = await getOpenAIClient().responses.create({
    model: request.model,
    instructions: request.instructions,
    input: JSON.stringify(request.input),
    ...(request.research ? {
      tools: [{ type: "web_search_preview" as const, search_context_size: "medium" as const }],
      include: ["web_search_call.action.sources" as const],
      ...{ max_tool_calls: 8 },
    } : {}),
    text: { format: request.wireFormat ?? zodTextFormat(request.schema, `edison_demand_${request.stage}`), verbosity: "medium" },
    reasoning: { effort: "low" },
    max_output_tokens: request.maxOutputTokens,
    safety_identifier: request.safetyIdentifier,
    store: false,
  }, {
    idempotencyKey: request.idempotencyKey,
    headers: { "Idempotency-Key": request.idempotencyKey },
    timeout: request.timeoutMs,
    maxRetries: 0,
  });
  const usage = {
    ...providerResponseUsage(response),
    webSearchCalls: response.output.filter((item) => item.type === "web_search_call").length,
  };
  try {
    if (response.status !== "completed" || !response.output_text || response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"))) {
      throw new Error("Incomplete, refused or absent provider output");
    }
    return { output: JSON.parse(response.output_text), usage, researchedUrls: researchUrls(response.output) };
  } catch {
    throw new ProviderResponseValidationError(`The ${request.stage} provider response did not contain usable JSON`, usage);
  }
};
