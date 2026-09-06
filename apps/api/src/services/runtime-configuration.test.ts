import assert from "node:assert/strict";
import test from "node:test";

import { productionRuntimeConfigurationIssues } from "./runtime-configuration";

function validEnvironment(): Record<string, string> {
  return {
    DATABASE_URL: "postgresql://example.invalid/database",
    SUPABASE_URL: "https://project.supabase.co",
    SUPABASE_PUBLISHABLE_KEY: "publishable-test-key",
    SUPABASE_JWT_AUDIENCE: "authenticated",
    OPENAI_API_KEY: "openai-test-key",
    OPENAI_ARTICLE_MODEL: "gpt-5.6-terra",
    OPENAI_UTILITY_MODEL: "gpt-5.6-luna",
    OPENAI_MAX_DAILY_GENERATIONS: "8",
    OPENAI_MAX_DAILY_ARTICLE_QUESTIONS: "20",
    OPENAI_MAX_DAILY_FEED_COMMANDS: "10",
    OPENAI_WEB_SEARCH_COST_MICROUSD: "10000",
    WEB_APP_URL: "https://app.edisonreader.com",
    CRON_SECRET: "a-secure-cron-secret-with-32-characters",
    CORS_ALLOWED_ORIGINS: "https://app.edisonreader.com",
    EDISON_ALLOWED_EMAILS: "reader@example.com",
    EDISON_ADMIN_EMAILS: "reader@example.com",
    EDISON_DAILY_EDITION_LOCAL_HOUR: "5",
    EDISON_DAILY_EDITION_TARGET: "3",
    EDISON_DAILY_EDITION_BATCH_SIZE: "25",
  };
}

test("runtime readiness validates every production setting", () => {
  assert.deepEqual(productionRuntimeConfigurationIssues(validEnvironment()), []);
});

test("runtime readiness rejects missing, unpriced, and out-of-range settings", () => {
  const environment = {
    ...validEnvironment(),
    EDISON_ALLOWED_EMAILS: "",
    OPENAI_UTILITY_MODEL: "future-unpriced-model",
    OPENAI_MAX_DAILY_ARTICLE_QUESTIONS: "0",
    EDISON_DAILY_EDITION_LOCAL_HOUR: "24",
  };
  const issues = productionRuntimeConfigurationIssues(environment);

  assert.ok(issues.includes("EDISON_ALLOWED_EMAILS"));
  assert.ok(issues.includes("OPENAI_UTILITY_MODEL"));
  assert.ok(issues.includes("OPENAI_MAX_DAILY_ARTICLE_QUESTIONS"));
  assert.ok(issues.includes("EDISON_DAILY_EDITION_LOCAL_HOUR"));
});

test("runtime readiness shares the provider's web-search price ceiling", () => {
  const environment = {
    ...validEnvironment(),
    EDISON_ON_DEMAND_ENABLED: "true",
    OPENAI_MAX_DAILY_GENERATIONS: "4",
    OPENAI_WEB_SEARCH_COST_MICROUSD: "1000001",
  };
  assert.ok(
    productionRuntimeConfigurationIssues(environment).includes(
      "OPENAI_WEB_SEARCH_COST_MICROUSD",
    ),
  );

  environment.OPENAI_WEB_SEARCH_COST_MICROUSD = "1000000";
  assert.equal(
    productionRuntimeConfigurationIssues(environment).includes(
      "OPENAI_WEB_SEARCH_COST_MICROUSD",
    ),
    false,
  );
});
