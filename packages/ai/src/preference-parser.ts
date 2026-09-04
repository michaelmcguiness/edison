import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, getUtilityModel } from "./client";
import {
  ProviderResponseValidationError,
  providerResponseUsage,
} from "./provider-response-error";
import {
  parsedPreferenceCommandSchema,
  type ParsedPreferenceCommand,
} from "./schemas";

export type PreferenceCommandResult = ParsedPreferenceCommand & {
  providerResponseId: string;
  model: string;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
};

export type CurrentInterestSignals = {
  active: string[];
  muted: string[];
};

type PreferenceCommandProviderResponse = {
  id: string;
  model: string;
  output_text: string;
  usage?: {
    input_tokens?: number;
    input_tokens_details?: { cached_tokens?: number };
    output_tokens?: number;
  } | null;
};

export function buildPreferenceCommandInput(input: {
  command: string;
  currentPreferences: unknown;
  currentInterests: CurrentInterestSignals;
}) {
  return {
    command: input.command,
    currentPreferences: input.currentPreferences,
    currentInterests: input.currentInterests,
  };
}

export async function parsePreferenceCommand(input: {
  userId: string;
  command: string;
  currentPreferences: unknown;
  currentInterests: CurrentInterestSignals;
  providerIdempotencyKey?: string;
  providerTimeoutMs?: number;
}): Promise<PreferenceCommandResult> {
  // Use create + local parsing so schema-invalid output remains observable and
  // its provider identity/tokens can be recorded before retry decisions.
  const response = await getOpenAIClient().responses.create(
    {
      model: getUtilityModel(),
      instructions: `
Translate a reader's plain-language request into the smallest reversible set of
Edison feed preference changes. Preserve nuance. Never infer demographic or
sensitive personal traits. The confirmation should be one calm sentence that
states what will change without claiming that new articles already exist.

The active interest list contains positive topic signals. The muted interest
list contains negative topic signals. For an interests/remove change, copy only
exact topic values that currently appear in active interests. Never claim to
remove an unknown or already-muted interest. If the request has no effective
change, return an empty changes array and say that nothing needed changing.
An interests/add change may restore a muted topic when the reader explicitly
asks for more coverage of it.
    `.trim(),
      input: JSON.stringify(buildPreferenceCommandInput(input)),
      text: {
        format: zodTextFormat(
          parsedPreferenceCommandSchema,
          "edison_preference_changes",
        ),
        verbosity: "low",
      },
      reasoning: { effort: "low" },
      max_output_tokens: 1_200,
      safety_identifier: input.userId,
      store: false,
    },
    {
      idempotencyKey: input.providerIdempotencyKey,
      headers: input.providerIdempotencyKey
        ? { "Idempotency-Key": input.providerIdempotencyKey }
        : undefined,
      timeout: input.providerTimeoutMs,
      maxRetries: input.providerIdempotencyKey ? 0 : undefined,
    },
  );

  return parsePreferenceCommandProviderResponse(response);
}

export function parsePreferenceCommandProviderResponse(
  response: PreferenceCommandProviderResponse,
): PreferenceCommandResult {
  const observedUsage = providerResponseUsage(response);

  let parsed: ParsedPreferenceCommand;
  try {
    if (!response.output_text) {
      throw new Error("OpenAI returned no preference change");
    }
    parsed = parsedPreferenceCommandSchema.parse(
      JSON.parse(response.output_text),
    );
  } catch {
    throw new ProviderResponseValidationError(
      "OpenAI returned an unusable preference change",
      observedUsage,
    );
  }

  return {
    ...parsed,
    ...observedUsage,
  };
}
