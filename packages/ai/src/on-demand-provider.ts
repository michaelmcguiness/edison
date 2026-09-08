import { zodTextFormat } from "openai/helpers/zod";
import type { ResponseCreateParamsNonStreaming } from "openai/resources/responses/responses";
import { getOpenAIClient } from "./client";
import { providerResponseUsage, ProviderResponseValidationError } from "./provider-response-error";
import type { OnDemandProvider, OnDemandProviderRequest, OnDemandProviderResponse } from "./on-demand";

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

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** These URLs come only from provider tool results and citation annotations.
 * A source claimed inside output_text is deliberately never examined here. */
export function onDemandResearchProvenance(output: readonly unknown[]): NonNullable<OnDemandProviderResponse["researchProvenance"]> {
  const consultedUrls = new Set<string>();
  const openedUrls = new Set<string>();
  const citedUrls = new Set<string>();
  function add(target: Set<string>, value: unknown) {
    if (typeof value !== "string" || value.length > 2048) return;
    try {
      const url = new URL(value);
      if ((url.protocol === "https:" || url.protocol === "http:") && !url.username && !url.password) target.add(value);
    } catch { /* Malformed metadata is not usable URL provenance. */ }
  }
  for (const value of output) {
    const item = object(value);
    if (item?.type === "web_search_call") {
      const action = object(item.action);
      if (action?.type === "search" && Array.isArray(action.sources)) {
        for (const source of action.sources) add(consultedUrls, object(source)?.url);
      }
      if (action?.type === "open_page") {
        add(openedUrls, action.url);
        add(consultedUrls, action.url);
      }
      if (action?.type === "find_in_page") add(consultedUrls, action.url);
    }
    if (item?.type === "message" && Array.isArray(item.content)) {
      for (const content of item.content) {
        const annotations = object(content)?.annotations;
        if (!Array.isArray(annotations)) continue;
        for (const value of annotations) {
          const annotation = object(value);
          if (annotation?.type === "url_citation") add(citedUrls, annotation.url);
        }
      }
    }
  }
  return { consultedUrls: [...consultedUrls], openedUrls: [...openedUrls], citedUrls: [...citedUrls] };
}

/** Exported for offline wire-contract tests; this does not create a client. */
export function onDemandProviderBody(request: OnDemandProviderRequest): ResponseCreateParamsNonStreaming & { max_tool_calls?: number } {
  const policy = request.researchPolicy;
  const tools = policy
    ? policy.mode !== "none" && policy.maxCalls > 0 ? {
      tools: [{ type: "web_search" as const, search_context_size: "medium" as const }],
      include: ["web_search_call.action.sources" as const],
      tool_choice: policy.mode,
      max_tool_calls: policy.maxCalls,
    } : {}
    : request.research ? {
      tools: [{ type: "web_search_preview" as const, search_context_size: "medium" as const }],
      include: ["web_search_call.action.sources" as const],
      max_tool_calls: 8,
    } : {};
  return {
    model: request.model,
    instructions: request.instructions,
    input: JSON.stringify(request.input),
    ...tools,
    text: { format: request.wireFormat ?? zodTextFormat(request.schema, `edison_demand_${request.stage}`), verbosity: "medium" },
    reasoning: { effort: "low" },
    max_output_tokens: request.maxOutputTokens,
    safety_identifier: request.safetyIdentifier,
    store: false,
  };
}

/** Unknown action metadata cannot be priced as a free tool call. Legacy runs
 * retain their original all-web-items search-count convention. */
export function onDemandSearchUsage(output: readonly unknown[], readerFirst: boolean) {
  const calls = output.map(object).filter((item) => item?.type === "web_search_call");
  if (!readerFirst) return { webSearchCalls: calls.length };
  const actions = calls.map((item) => object(item?.action)?.type);
  return {
    webSearchCalls: actions.filter((action) => action === "search").length,
    webSearchToolCalls: calls.length,
    webSearchPricingStatus: actions.every((action) => action === "search" || action === "open_page" || action === "find_in_page") ? "priced" as const : "unpriced" as const,
  };
}

/** One provider request only. The caller owns durable retries and stage ledgers. */
export const openAIOnDemandProvider: OnDemandProvider = async (request) => {
  const response = await getOpenAIClient().responses.create(onDemandProviderBody(request), {
    idempotencyKey: request.idempotencyKey,
    headers: { "Idempotency-Key": request.idempotencyKey },
    timeout: request.timeoutMs,
    maxRetries: 0,
  });
  const usage = {
    ...providerResponseUsage(response),
    ...onDemandSearchUsage(response.output, Boolean(request.researchPolicy)),
  };
  try {
    if (response.status !== "completed" || !response.output_text || response.output.some((item) => item.type === "message" && item.content.some((content) => content.type === "refusal"))) {
      throw new Error("Incomplete, refused or absent provider output");
    }
    if (usage.webSearchPricingStatus === "unpriced") throw new Error("Unknown web search action pricing");
    const researchProvenance = onDemandResearchProvenance(response.output);
    const researchedUrls = request.researchPolicy
      ? [...new Set([...researchProvenance.consultedUrls, ...researchProvenance.openedUrls, ...researchProvenance.citedUrls])]
      : researchUrls(response.output);
    return { output: JSON.parse(response.output_text), usage, researchedUrls, researchProvenance };
  } catch {
    throw new ProviderResponseValidationError(`The ${request.stage} provider response did not contain usable JSON`, usage);
  }
};
