import { zodTextFormat } from "openai/helpers/zod";
import { getOpenAIClient, getUtilityModel } from "./client";
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
}): Promise<PreferenceCommandResult> {
  const response = await getOpenAIClient().responses.parse({
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
  });

  if (!response.output_parsed) {
    throw new Error("OpenAI returned no validated preference change");
  }

  return {
    ...response.output_parsed,
    providerResponseId: response.id,
    model: response.model,
    inputTokens: response.usage?.input_tokens ?? 0,
    cachedInputTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
  };
}
