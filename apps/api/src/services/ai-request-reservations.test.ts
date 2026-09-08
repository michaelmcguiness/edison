import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ProviderResponseValidationError,
  providerResponseUsage,
} from "@edison/ai";
import { HttpError } from "../http/errors";
import {
  AI_REQUEST_LEASE_MS,
  AI_REQUEST_MAX_ATTEMPTS,
  AI_REQUEST_PROVIDER_TIMEOUT_MS,
  aiRequestRetryAt,
  configuredAiRequestLimit,
  invalidProviderResponseFailure,
  priceRecordedAiUsage,
  providerIdempotencyKey,
  reservationClaimDisposition,
} from "./ai-request-reservations";
import { fingerprintRequest } from "./request-fingerprint";

test("AI request quota configuration is explicit, bounded, and fail-closed", () => {
  assert.equal(
    configuredAiRequestLimit("article_qa", {
      OPENAI_MAX_DAILY_ARTICLE_QUESTIONS: "24",
    }),
    24,
  );
  assert.equal(
    configuredAiRequestLimit("preference_command", {
      OPENAI_MAX_DAILY_FEED_COMMANDS: "12",
    }),
    12,
  );

  for (const invalid of [undefined, "", "0", "1.5", "1001", "many"]) {
    assert.throws(
      () =>
        configuredAiRequestLimit("article_qa", {
          OPENAI_MAX_DAILY_ARTICLE_QUESTIONS: invalid,
        }),
      (error: unknown) =>
        error instanceof HttpError &&
        error.status === 503 &&
        error.code === "article_question_limit_not_configured",
    );
  }
});

test("an active lease makes a parallel caller wait and an expired lease is reclaimable", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  const base = {
    status: "in_progress",
    attemptCount: 1,
    nextAttemptAt: new Date("2026-09-04T11:59:00.000Z"),
  };

  assert.equal(
    reservationClaimDisposition(
      {
        ...base,
        leaseExpiresAt: new Date("2026-09-04T12:01:00.000Z"),
      },
      now,
    ),
    "busy",
  );
  assert.equal(
    reservationClaimDisposition(
      {
        ...base,
        leaseExpiresAt: new Date("2026-09-04T11:59:59.999Z"),
      },
      now,
    ),
    "claimable",
  );
});

test("retry ownership is bounded and terminal states cannot be reclaimed", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  const retryable = {
    status: "reserved",
    attemptCount: AI_REQUEST_MAX_ATTEMPTS - 1,
    leaseExpiresAt: null,
    nextAttemptAt: now,
  };
  assert.equal(reservationClaimDisposition(retryable, now), "claimable");
  assert.equal(
    reservationClaimDisposition(
      { ...retryable, attemptCount: AI_REQUEST_MAX_ATTEMPTS },
      now,
    ),
    "failed",
  );
  assert.equal(
    reservationClaimDisposition(
      {
        ...retryable,
        status: "in_progress",
        attemptCount: AI_REQUEST_MAX_ATTEMPTS,
        leaseExpiresAt: new Date("2026-09-04T12:01:00.000Z"),
      },
      now,
    ),
    "busy",
  );
  assert.equal(
    reservationClaimDisposition(
      {
        ...retryable,
        status: "in_progress",
        attemptCount: AI_REQUEST_MAX_ATTEMPTS,
        leaseExpiresAt: new Date("2026-09-04T11:59:59.999Z"),
      },
      now,
    ),
    "failed",
  );
  assert.equal(
    reservationClaimDisposition(
      { ...retryable, status: "succeeded" },
      now,
    ),
    "succeeded",
  );
});

test("the provider timeout ends before the bounded database lease", () => {
  assert.ok(AI_REQUEST_PROVIDER_TIMEOUT_MS > 0);
  assert.ok(AI_REQUEST_PROVIDER_TIMEOUT_MS < AI_REQUEST_LEASE_MS);
});

test("ambiguous failures cannot retry before the original lease window", () => {
  const now = new Date("2026-09-04T12:00:00.000Z");
  const leaseExpiry = new Date("2026-09-04T12:03:00.000Z");

  assert.equal(aiRequestRetryAt(now, leaseExpiry).toISOString(), leaseExpiry.toISOString());
  assert.equal(
    aiRequestRetryAt(now, new Date("2026-09-04T11:59:00.000Z")).toISOString(),
    "2026-09-04T12:00:03.000Z",
  );
});

test("provider idempotency keys are stable per reservation and contain no request text", () => {
  const reservationId = "10000000-0000-4000-8000-000000000001";
  const key = providerIdempotencyKey(reservationId);
  assert.equal(key, providerIdempotencyKey(reservationId));
  assert.match(key, /^edison-ai-[0-9a-f-]{36}$/);
  assert.doesNotMatch(key, /question|history/i);
});

test("request fingerprints distinguish content while remaining stable", () => {
  const parts = ["article_qa", "article-id", "What changed?"];
  assert.equal(fingerprintRequest(parts), fingerprintRequest(parts));
  assert.notEqual(
    fingerprintRequest(parts),
    fingerprintRequest(["article_qa", "article-id", "Why did it change?"]),
  );
  assert.match(fingerprintRequest(parts), /^[a-f0-9]{64}$/);
});

test("rejected structured responses retain non-content usage for accounting", () => {
  const observedUsage = providerResponseUsage({
    id: "resp_observed_1",
    model: "gpt-5.6-luna",
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 25 },
      output_tokens: 10,
    },
  });
  const error = new ProviderResponseValidationError(
    "Rejected payload",
    observedUsage,
  );

  assert.deepEqual(error.observedUsage, {
    providerResponseId: "resp_observed_1",
    model: "gpt-5.6-luna",
    inputTokens: 100,
    cachedInputTokens: 25,
    outputTokens: 10,
  });
  assert.equal(JSON.stringify(error.observedUsage).includes("payload"), false);
});

test("unknown-model usage is retained with null cost and an explicit status", () => {
  const usage = {
    providerResponseId: "resp_unpriced_1",
    model: "future-unpriced-model",
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 10,
  };
  const pricing = priceRecordedAiUsage(usage);

  assert.equal(pricing.pricingStatus, "unpriced");
  assert.equal(pricing.costMicrousd, null);
  assert.equal(pricing.pricingError?.model, usage.model);
  assert.deepEqual(usage, {
    providerResponseId: "resp_unpriced_1",
    model: "future-unpriced-model",
    inputTokens: 100,
    cachedInputTokens: 0,
    outputTokens: 10,
  });
});

test("an invalid provider response is terminal only after durable accounting", () => {
  assert.deepEqual(invalidProviderResponseFailure("persisted"), {
    terminal: true,
    preserveRetryCapacity: false,
    failureCode: "provider_response_invalid",
  });
  assert.deepEqual(invalidProviderResponseFailure("persisted_unpriced"), {
    terminal: true,
    preserveRetryCapacity: false,
    failureCode: "provider_response_invalid_unpriced",
  });
  assert.deepEqual(invalidProviderResponseFailure("failed"), {
    terminal: false,
    preserveRetryCapacity: true,
    failureCode: "ai_usage_persistence_failed",
  });
});

test("both interactive AI paths retry accounting failures without spending retry capacity", () => {
  const articleQuestionSource = readFileSync(
    new URL(
      "../../app/v1/articles/[articleId]/conversation/route.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const feedCommandSource = readFileSync(
    new URL("../../workflows/apply-feed-command.ts", import.meta.url),
    "utf8",
  );

  for (const source of [articleQuestionSource, feedCommandSource]) {
    assert.match(source, /invalidProviderResponseFailure\("failed"\)/);
    assert.match(
      source,
      /invalidResponseFailure\?\.preserveRetryCapacity \?\? false/,
    );
    assert.match(source, /error instanceof AiUsagePersistenceError/);
  }
  assert.match(articleQuestionSource, /"ai_usage_persistence_failed"/);
  assert.match(
    feedCommandSource,
    /Feed-command usage accounting was not durably recorded/,
  );
  assert.match(feedCommandSource, /settleFeedCommandFailure/);
  assert.match(
    feedCommandSource,
    /reservation\?\.status === "reserved"[\s\S]*workflowRunId: null/,
  );
});
