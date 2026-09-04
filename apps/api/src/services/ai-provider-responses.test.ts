import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ProviderResponseValidationError,
  parseArticleQuestionProviderResponse,
  parsePreferenceCommandProviderResponse,
} from "@edison/ai";

const observedUsage = {
  input_tokens: 321,
  input_tokens_details: { cached_tokens: 123 },
  output_tokens: 45,
};

test("malformed article answers retain observed provider usage", () => {
  assert.throws(
    () =>
      parseArticleQuestionProviderResponse(
        {
          id: "resp_bad_article_answer",
          model: "gpt-5.6-luna",
          output_text: '{"answer":42,"citations":[]}',
          usage: observedUsage,
        },
        new Set(),
      ),
    (error: unknown) => {
      assert.ok(error instanceof ProviderResponseValidationError);
      assert.deepEqual(error.observedUsage, {
        providerResponseId: "resp_bad_article_answer",
        model: "gpt-5.6-luna",
        inputTokens: 321,
        cachedInputTokens: 123,
        outputTokens: 45,
      });
      return true;
    },
  );
});

test("malformed preference commands retain observed provider usage", () => {
  assert.throws(
    () =>
      parsePreferenceCommandProviderResponse({
        id: "resp_bad_preference_command",
        model: "gpt-5.6-luna",
        output_text: '{"changes":"not-an-array","confirmation":true}',
        usage: observedUsage,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderResponseValidationError);
      assert.deepEqual(error.observedUsage, {
        providerResponseId: "resp_bad_preference_command",
        model: "gpt-5.6-luna",
        inputTokens: 321,
        cachedInputTokens: 123,
        outputTokens: 45,
      });
      return true;
    },
  );
});

test("interactive AI utilities never let SDK parsing hide observed usage", () => {
  const articleQuestionSource = readFileSync(
    new URL("../../../../packages/ai/src/article-question.ts", import.meta.url),
    "utf8",
  );
  const preferenceParserSource = readFileSync(
    new URL("../../../../packages/ai/src/preference-parser.ts", import.meta.url),
    "utf8",
  );

  for (const source of [articleQuestionSource, preferenceParserSource]) {
    assert.match(source, /responses\.create\(/);
    assert.doesNotMatch(source, /responses\.parse\(/);
    assert.match(source, /JSON\.parse\(response\.output_text\)/);
    assert.match(source, /new ProviderResponseValidationError/);
  }
});
