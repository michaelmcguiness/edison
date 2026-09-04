#!/usr/bin/env node

import { pathToFileURL } from "node:url";

const TARGETS = new Set(["web", "api"]);
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{2,79}$/i;
const PRICED_MODEL_PATTERN = /^gpt-5\.6-(?:luna|terra)$/;
const PLACEHOLDER_PATTERN =
  /^(?:change[-_ ]?me|example|placeholder|replace[-_ ]?me|todo|unset|your[-_ ])/i;

function has(environment, name) {
  return Object.prototype.hasOwnProperty.call(environment, name);
}

function value(environment, name) {
  const raw = environment[name];
  return typeof raw === "string" ? raw.trim() : "";
}

function localHostname(hostname) {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  );
}

function parseUrl(raw) {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

function looksLikePlaceholder(raw) {
  return !raw || raw === "..." || raw.includes("<") || PLACEHOLDER_PATTERN.test(raw);
}

function jwtRole(raw) {
  const parts = raw.split(".");
  if (parts.length !== 3) return null;

  try {
    const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
    return typeof payload.role === "string" ? payload.role : null;
  } catch {
    return null;
  }
}

function createAudit(target) {
  const checks = [];

  const add = (level, name, message) => {
    checks.push({ level, name, message });
  };

  return {
    target,
    checks,
    ok(name, message) {
      add("ok", name, message);
    },
    warn(name, message) {
      add("warning", name, message);
    },
    error(name, message) {
      add("error", name, message);
    },
    finish() {
      const errorCount = checks.filter((check) => check.level === "error").length;
      const warningCount = checks.filter(
        (check) => check.level === "warning",
      ).length;
      return {
        target,
        ok: errorCount === 0,
        errorCount,
        warningCount,
        checks,
      };
    },
  };
}

function requireLiteral(environment, audit, name, expected) {
  const configured = value(environment, name);
  if (!configured) {
    audit.error(name, `missing; set it explicitly to ${expected}`);
  } else if (configured !== expected) {
    audit.error(name, `must be set explicitly to ${expected}`);
  } else {
    audit.ok(name, `set explicitly to ${expected}`);
  }
}

function requireHttpsUrl(environment, audit, name, expectedPath) {
  const configured = value(environment, name);
  if (!configured) {
    audit.error(name, "missing");
    return null;
  }

  const parsed = parseUrl(configured);
  if (!parsed) {
    audit.error(name, "must be a valid absolute URL");
    return null;
  }

  if (parsed.protocol !== "https:") {
    audit.error(name, "must use HTTPS in production");
    return null;
  }
  if (parsed.username || parsed.password) {
    audit.error(name, "must not contain URL credentials");
    return null;
  }
  if (localHostname(parsed.hostname)) {
    audit.error(name, "must not point at a local hostname in production");
    return null;
  }
  if (parsed.search || parsed.hash) {
    audit.error(name, "must not contain a query string or fragment");
    return null;
  }
  if (parsed.pathname !== expectedPath) {
    audit.error(name, `must use the exact ${expectedPath} path`);
    return null;
  }

  audit.ok(name, `valid production origin: ${parsed.origin}`);
  return parsed;
}

function requirePublishableKey(environment, audit, name) {
  const configured = value(environment, name);
  if (looksLikePlaceholder(configured)) {
    audit.error(name, "missing or still a placeholder");
    return;
  }

  const role = jwtRole(configured);
  if (
    configured.startsWith("sb_secret_") ||
    configured.startsWith("service_role") ||
    role === "service_role" ||
    role === "supabase_admin"
  ) {
    audit.error(name, "contains a secret/admin credential; use a publishable key");
    return;
  }

  audit.ok(name, "publishable credential is present; value redacted");
}

function requireSecret(environment, audit, name, options = {}) {
  const configured = value(environment, name);
  const minimumLength = options.minimumLength ?? 20;

  if (looksLikePlaceholder(configured)) {
    audit.error(name, "missing or still a placeholder");
    return;
  }
  if (configured.length < minimumLength) {
    audit.error(name, `must contain at least ${minimumLength} characters`);
    return;
  }
  if (options.entropy && new Set(configured).size < 8) {
    audit.error(name, "does not appear to be randomly generated");
    return;
  }

  audit.ok(name, "present; value redacted");
}

function requireInteger(environment, audit, name, minimum, maximum) {
  const configured = value(environment, name);
  const parsed = Number(configured);
  if (
    !configured ||
    !Number.isInteger(parsed) ||
    parsed < minimum ||
    parsed > maximum
  ) {
    audit.error(name, `must be an integer from ${minimum} through ${maximum}`);
    return null;
  }

  audit.ok(name, `valid integer in the allowed ${minimum}-${maximum} range`);
  return parsed;
}

function checkWebEnvironment(environment) {
  const audit = createAudit("web");

  requireLiteral(environment, audit, "EDISON_DEMO_MODE", "false");
  requireLiteral(environment, audit, "ENABLE_EXPERIMENTAL_COREPACK", "1");
  requireHttpsUrl(environment, audit, "NEXT_PUBLIC_API_URL", "/v1");
  requireHttpsUrl(environment, audit, "NEXT_PUBLIC_SUPABASE_URL", "/");
  requirePublishableKey(
    environment,
    audit,
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
  );

  const forbidden = [
    "CRON_SECRET",
    "DATABASE_URL",
    "DIRECT_URL",
    "OPENAI_ADMIN_KEY",
    "OPENAI_API_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ];
  for (const name of forbidden) {
    if (has(environment, name)) {
      audit.error(name, "must not exist in the web project environment");
    }
  }

  const unsafePublicNames = Object.keys(environment).filter(
    (name) =>
      name.startsWith("NEXT_PUBLIC_") &&
      /(?:ADMIN|DATABASE|DIRECT_URL|OPENAI_API_KEY|PRIVATE|SECRET|SERVICE_ROLE)/.test(
        name,
      ),
  );
  for (const name of unsafePublicNames) {
    audit.error(name, "appears secret and must never use the NEXT_PUBLIC_ prefix");
  }

  if (!forbidden.some((name) => has(environment, name)) && !unsafePublicNames.length) {
    audit.ok(
      "server-only credentials",
      "none of the known server-only credential names are present",
    );
  }

  return audit.finish();
}

function checkDatabaseUrl(environment, audit) {
  const configured = value(environment, "DATABASE_URL");
  if (!configured) {
    audit.error("DATABASE_URL", "missing");
    return;
  }

  const parsed = parseUrl(configured);
  if (!parsed || !["postgres:", "postgresql:"].includes(parsed.protocol)) {
    audit.error("DATABASE_URL", "must be a valid PostgreSQL URL");
    return;
  }
  if (localHostname(parsed.hostname)) {
    audit.error("DATABASE_URL", "must not point at a local database in production");
    return;
  }
  if (parsed.port !== "6543") {
    audit.error(
      "DATABASE_URL",
      "must use Supabase transaction-pooler port 6543 for the serverless API",
    );
    return;
  }

  const sslMode = parsed.searchParams.get("sslmode")?.toLowerCase();
  const sslFlag = parsed.searchParams.get("ssl")?.toLowerCase();
  const acceptedModes = new Set(["require", "verify-ca", "verify-full"]);
  if (!acceptedModes.has(sslMode ?? "") && sslFlag !== "true") {
    audit.error(
      "DATABASE_URL",
      "must explicitly require TLS with sslmode=require, verify-ca, or verify-full",
    );
    return;
  }

  audit.ok(
    "DATABASE_URL",
    "transaction-pooler URL and TLS setting are valid; credentials redacted",
  );
  if (sslMode === "require" || sslFlag === "true") {
    audit.warn(
      "DATABASE_URL TLS verification",
      "encrypted transport is configured; prefer sslmode=verify-full when the runtime trust store supports it",
    );
  }
}

function checkCors(environment, audit, webUrl) {
  const configured = value(environment, "CORS_ALLOWED_ORIGINS");
  if (!configured) {
    audit.error("CORS_ALLOWED_ORIGINS", "missing");
    return;
  }

  const entries = configured
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
  if (!entries.length || entries.includes("*")) {
    audit.error(
      "CORS_ALLOWED_ORIGINS",
      "must contain one or more exact origins and must not contain a wildcard",
    );
    return;
  }

  const origins = [];
  for (const entry of entries) {
    const parsed = parseUrl(entry);
    if (
      !parsed ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      parsed.pathname !== "/" ||
      entry !== parsed.origin ||
      localHostname(parsed.hostname)
    ) {
      audit.error(
        "CORS_ALLOWED_ORIGINS",
        "every entry must be an exact, credential-free HTTPS production origin without a trailing slash",
      );
      return;
    }
    origins.push(parsed.origin);
  }

  if (new Set(origins).size !== origins.length) {
    audit.error("CORS_ALLOWED_ORIGINS", "contains a duplicate origin");
    return;
  }
  if (webUrl && !origins.includes(webUrl.origin)) {
    audit.error(
      "CORS_ALLOWED_ORIGINS",
      "must include the canonical WEB_APP_URL origin",
    );
    return;
  }

  audit.ok(
    "CORS_ALLOWED_ORIGINS",
    `${origins.length} exact HTTPS origin(s), including the canonical web origin`,
  );
}

function parseEmailList(environment, audit, name, required) {
  const configured = value(environment, name);
  const entries = configured
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);

  if (!entries.length) {
    const message = "must contain at least one email for the private alpha";
    if (required) audit.error(name, message);
    else audit.warn(name, message);
    return [];
  }
  if (
    entries.some((entry) => !EMAIL_PATTERN.test(entry)) ||
    new Set(entries).size !== entries.length
  ) {
    audit.error(name, "contains an invalid or duplicate entry; values redacted");
    return [];
  }

  audit.ok(name, `${entries.length} valid unique email entr${entries.length === 1 ? "y" : "ies"}; values redacted`);
  return entries;
}

function checkApiEnvironment(environment) {
  const audit = createAudit("api");

  requireLiteral(environment, audit, "ENABLE_EXPERIMENTAL_COREPACK", "1");
  checkDatabaseUrl(environment, audit);
  requireHttpsUrl(environment, audit, "SUPABASE_URL", "/");
  requirePublishableKey(environment, audit, "SUPABASE_PUBLISHABLE_KEY");
  requireLiteral(
    environment,
    audit,
    "SUPABASE_JWT_AUDIENCE",
    "authenticated",
  );
  requireSecret(environment, audit, "OPENAI_API_KEY");

  for (const name of ["OPENAI_ARTICLE_MODEL", "OPENAI_UTILITY_MODEL"]) {
    const configured = value(environment, name);
    if (!MODEL_PATTERN.test(configured)) {
      audit.error(name, "must contain an explicit valid model identifier");
    } else if (!PRICED_MODEL_PATTERN.test(configured)) {
      audit.error(
        name,
        "must name a model with explicit Edison token pricing (gpt-5.6-luna or gpt-5.6-terra)",
      );
    } else {
      audit.ok(name, "explicit model identifier and token pricing are present");
    }
  }
  if (
    value(environment, "OPENAI_ARTICLE_MODEL") &&
    value(environment, "OPENAI_ARTICLE_MODEL") ===
      value(environment, "OPENAI_UTILITY_MODEL")
  ) {
    audit.warn(
      "OpenAI model split",
      "article and utility workloads use the same model; verify that cost is intentional",
    );
  }

  const maximumDailyGenerations = requireInteger(
    environment,
    audit,
    "OPENAI_MAX_DAILY_GENERATIONS",
    1,
    100,
  );
  requireInteger(
    environment,
    audit,
    "OPENAI_MAX_DAILY_ARTICLE_QUESTIONS",
    1,
    1_000,
  );
  requireInteger(
    environment,
    audit,
    "OPENAI_MAX_DAILY_FEED_COMMANDS",
    1,
    1_000,
  );
  const webSearchCost = requireInteger(
    environment,
    audit,
    "OPENAI_WEB_SEARCH_COST_MICROUSD",
    0,
    1_000_000_000,
  );
  if (webSearchCost !== null && webSearchCost !== 10_000) {
    audit.warn(
      "OPENAI_WEB_SEARCH_COST_MICROUSD pricing",
      "configured accounting rate differs from the rate verified on 2026-09-04; recheck official pricing",
    );
  }

  const webUrl = requireHttpsUrl(environment, audit, "WEB_APP_URL", "/");
  if (webUrl && value(environment, "WEB_APP_URL") !== webUrl.origin) {
    audit.error("WEB_APP_URL", "must be an exact origin without a trailing slash");
  }
  checkCors(environment, audit, webUrl);
  requireSecret(environment, audit, "CRON_SECRET", {
    minimumLength: 32,
    entropy: true,
  });

  const allowedEmails = parseEmailList(
    environment,
    audit,
    "EDISON_ALLOWED_EMAILS",
    true,
  );
  const adminEmails = parseEmailList(
    environment,
    audit,
    "EDISON_ADMIN_EMAILS",
    true,
  );
  if (
    allowedEmails.length &&
    adminEmails.length &&
    adminEmails.some((email) => !allowedEmails.includes(email))
  ) {
    audit.error(
      "EDISON_ADMIN_EMAILS membership",
      "every admin must also appear in EDISON_ALLOWED_EMAILS; values redacted",
    );
  }

  const localHour = requireInteger(
    environment,
    audit,
    "EDISON_DAILY_EDITION_LOCAL_HOUR",
    0,
    23,
  );
  const dailyTarget = requireInteger(
    environment,
    audit,
    "EDISON_DAILY_EDITION_TARGET",
    1,
    10,
  );
  requireInteger(
    environment,
    audit,
    "EDISON_DAILY_EDITION_BATCH_SIZE",
    1,
    100,
  );
  if (
    maximumDailyGenerations !== null &&
    dailyTarget !== null &&
    maximumDailyGenerations < dailyTarget
  ) {
    audit.error(
      "daily generation capacity",
      "OPENAI_MAX_DAILY_GENERATIONS must be at least EDISON_DAILY_EDITION_TARGET",
    );
  }
  if (localHour !== null) {
    audit.ok(
      "daily edition schedule",
      "local delivery hour is explicit; cron execution remains UTC and catch-up based",
    );
  }

  for (const name of ["EDISON_DEV_USER_ID", "EDISON_DEV_USER_EMAIL"]) {
    if (has(environment, name)) {
      audit.error(name, "local development identity must not exist in production");
    }
  }
  for (const name of [
    "DIRECT_URL",
    "OPENAI_ADMIN_KEY",
    "SUPABASE_SECRET_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ]) {
    if (has(environment, name)) {
      audit.error(
        name,
        "elevated/admin credential is unnecessary and must not exist in the API runtime",
      );
    }
  }

  return audit.finish();
}

export function checkProductionEnvironment(environment, target) {
  if (!TARGETS.has(target)) {
    throw new Error('Target must be either "web" or "api".');
  }
  return target === "web"
    ? checkWebEnvironment(environment)
    : checkApiEnvironment(environment);
}

export function formatProductionEnvironmentReport(result) {
  const labels = { ok: "OK", warning: "WARN", error: "ERROR" };
  const lines = [
    `Edison production environment preflight: ${result.target}`,
    "Credential values are never printed.",
    "",
  ];
  for (const check of result.checks) {
    lines.push(`[${labels[check.level]}] ${check.name}: ${check.message}`);
  }
  lines.push(
    "",
    result.ok
      ? `PASS (${result.warningCount} warning${result.warningCount === 1 ? "" : "s"})`
      : `FAIL (${result.errorCount} error${result.errorCount === 1 ? "" : "s"}, ${result.warningCount} warning${result.warningCount === 1 ? "" : "s"})`,
  );
  return lines.join("\n");
}

function printUsage() {
  console.log(`Usage: node scripts/check-production-env.mjs <web|api>

Checks only the environment inherited by this process. It never loads an env
file automatically and never prints credential values. Run each target with
only that Vercel project's production environment.`);
}

const isDirectInvocation =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isDirectInvocation) {
  const target = process.argv[2];
  if (target === "--help" || target === "-h") {
    printUsage();
  } else if (!TARGETS.has(target)) {
    printUsage();
    process.exitCode = 2;
  } else {
    const result = checkProductionEnvironment(process.env, target);
    console.log(formatProductionEnvironmentReport(result));
    if (!result.ok) process.exitCode = 1;
  }
}
