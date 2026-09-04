import assert from "node:assert/strict";
import test from "node:test";

import {
  checkProductionEnvironment,
  formatProductionEnvironmentReport,
} from "../scripts/check-production-env.mjs";

function validWebEnvironment(): Record<string, string> {
  return {
    EDISON_DEMO_MODE: "false",
    ENABLE_EXPERIMENTAL_COREPACK: "1",
    NEXT_PUBLIC_API_URL: "https://api.edisonreader.com/v1",
    NEXT_PUBLIC_SUPABASE_URL: "https://project-ref.supabase.co",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      "sb_publishable_browser_credential_for_test_only",
  };
}

function validApiEnvironment(): Record<string, string> {
  return {
    ENABLE_EXPERIMENTAL_COREPACK: "1",
    DATABASE_URL:
      "postgresql://postgres.project:db-password-SENTINEL@aws-0-us-east-1.pooler.supabase.com:6543/postgres?sslmode=verify-full",
    SUPABASE_URL: "https://project-ref.supabase.co",
    SUPABASE_PUBLISHABLE_KEY:
      "sb_publishable_server_verification_key_for_test_only",
    SUPABASE_JWT_AUDIENCE: "authenticated",
    OPENAI_API_KEY: "sk-proj-openai-SENTINEL-production-test-key",
    OPENAI_ARTICLE_MODEL: "gpt-5.6-terra",
    OPENAI_UTILITY_MODEL: "gpt-5.6-luna",
    OPENAI_MAX_DAILY_GENERATIONS: "8",
    OPENAI_MAX_DAILY_ARTICLE_QUESTIONS: "20",
    OPENAI_MAX_DAILY_FEED_COMMANDS: "10",
    OPENAI_WEB_SEARCH_COST_MICROUSD: "10000",
    WEB_APP_URL: "https://app.edisonreader.com",
    CORS_ALLOWED_ORIGINS: "https://app.edisonreader.com",
    CRON_SECRET:
      "cron-SENTINEL-7f12a9c48bd650e31f47a2c98de503a61b84",
    EDISON_ALLOWED_EMAILS: "reader-SENTINEL@example.com",
    EDISON_ADMIN_EMAILS: "reader-SENTINEL@example.com",
    EDISON_DAILY_EDITION_LOCAL_HOUR: "5",
    EDISON_DAILY_EDITION_TARGET: "3",
    EDISON_DAILY_EDITION_BATCH_SIZE: "25",
  };
}

test("accepts a minimal credential-separated web production environment", () => {
  const result = checkProductionEnvironment(validWebEnvironment(), "web");

  assert.equal(result.ok, true);
  assert.equal(result.errorCount, 0);
});

test("rejects demo mode and server credentials in the web project", () => {
  const environment = {
    ...validWebEnvironment(),
    EDISON_DEMO_MODE: "true",
    OPENAI_API_KEY: "sk-proj-never-in-the-browser-SENTINEL",
    NEXT_PUBLIC_DATABASE_SECRET: "browser-leak-SENTINEL",
  };
  const result = checkProductionEnvironment(environment, "web");
  const report = formatProductionEnvironmentReport(result);

  assert.equal(result.ok, false);
  assert.match(report, /EDISON_DEMO_MODE/);
  assert.match(report, /OPENAI_API_KEY/);
  assert.match(report, /NEXT_PUBLIC_DATABASE_SECRET/);
  assert.doesNotMatch(report, /never-in-the-browser-SENTINEL/);
  assert.doesNotMatch(report, /browser-leak-SENTINEL/);
});

test("rejects a Supabase secret key in the publishable web slot", () => {
  const environment = {
    ...validWebEnvironment(),
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_secret_SUPABASE-SENTINEL",
  };
  const result = checkProductionEnvironment(environment, "web");
  const report = formatProductionEnvironmentReport(result);

  assert.equal(result.ok, false);
  assert.match(report, /secret\/admin credential/);
  assert.doesNotMatch(report, /SUPABASE-SENTINEL/);
});

test("accepts the least-privilege API production environment", () => {
  const result = checkProductionEnvironment(validApiEnvironment(), "api");

  assert.equal(result.ok, true);
  assert.equal(result.errorCount, 0);
  assert.equal(result.warningCount, 0);
});

test("rejects wildcard or mismatched browser origins", () => {
  const wildcard = checkProductionEnvironment(
    { ...validApiEnvironment(), CORS_ALLOWED_ORIGINS: "*" },
    "api",
  );
  const mismatch = checkProductionEnvironment(
    {
      ...validApiEnvironment(),
      CORS_ALLOWED_ORIGINS: "https://different.example.com",
    },
    "api",
  );

  assert.equal(wildcard.ok, false);
  assert.equal(mismatch.ok, false);
  assert.match(formatProductionEnvironmentReport(wildcard), /wildcard/);
  assert.match(
    formatProductionEnvironmentReport(mismatch),
    /canonical WEB_APP_URL origin/,
  );
});

test("rejects weak transport, cron, and scheduling settings", () => {
  const environment = {
    ...validApiEnvironment(),
    DATABASE_URL:
      "postgresql://postgres.project:db-SENTINEL@pooler.supabase.com:5432/postgres",
    CRON_SECRET: "too-short",
    OPENAI_MAX_DAILY_GENERATIONS: "2",
    OPENAI_MAX_DAILY_ARTICLE_QUESTIONS: "0",
    OPENAI_MAX_DAILY_FEED_COMMANDS: "unbounded",
    EDISON_DAILY_EDITION_TARGET: "3",
    EDISON_DAILY_EDITION_LOCAL_HOUR: "24",
  };
  const result = checkProductionEnvironment(environment, "api");
  const report = formatProductionEnvironmentReport(result);

  assert.equal(result.ok, false);
  assert.match(report, /port 6543/);
  assert.match(report, /at least 32 characters/);
  assert.match(report, /must be at least EDISON_DAILY_EDITION_TARGET/);
  assert.match(report, /OPENAI_MAX_DAILY_ARTICLE_QUESTIONS/);
  assert.match(report, /OPENAI_MAX_DAILY_FEED_COMMANDS/);
  assert.match(report, /0 through 23/);
  assert.doesNotMatch(report, /db-SENTINEL/);
});

test("rejects a model without explicit token pricing", () => {
  const result = checkProductionEnvironment(
    {
      ...validApiEnvironment(),
      OPENAI_UTILITY_MODEL: "future-unpriced-model",
    },
    "api",
  );

  assert.equal(result.ok, false);
  assert.match(
    formatProductionEnvironmentReport(result),
    /explicit Edison token pricing/,
  );
});

test("rejects local identities and elevated credentials in the API runtime", () => {
  const environment = {
    ...validApiEnvironment(),
    EDISON_DEV_USER_ID: "00000000-0000-4000-8000-000000000001",
    SUPABASE_SECRET_KEY: "sb_secret_admin-SENTINEL",
    DIRECT_URL: "postgresql://direct:direct-SENTINEL@db.example.com/postgres",
  };
  const result = checkProductionEnvironment(environment, "api");
  const report = formatProductionEnvironmentReport(result);

  assert.equal(result.ok, false);
  assert.match(report, /EDISON_DEV_USER_ID/);
  assert.match(report, /SUPABASE_SECRET_KEY/);
  assert.match(report, /DIRECT_URL/);
  assert.doesNotMatch(report, /admin-SENTINEL/);
  assert.doesNotMatch(report, /direct-SENTINEL/);
});

test("formatted reports never disclose credential, database, or email values", () => {
  const environment = validApiEnvironment();
  const report = formatProductionEnvironmentReport(
    checkProductionEnvironment(environment, "api"),
  );

  assert.doesNotMatch(report, /openai-SENTINEL/);
  assert.doesNotMatch(report, /db-password-SENTINEL/);
  assert.doesNotMatch(report, /cron-SENTINEL/);
  assert.doesNotMatch(report, /reader-SENTINEL/);
  assert.match(report, /Credential values are never printed/);
});
