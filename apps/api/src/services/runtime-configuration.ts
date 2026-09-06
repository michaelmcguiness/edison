import { demandLimits } from "./demand-configuration";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRICED_CONFIGURED_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-terra",
]);

export const requiredRuntimeConfiguration = [
  "DATABASE_URL",
  "SUPABASE_URL",
  "SUPABASE_PUBLISHABLE_KEY",
  "SUPABASE_JWT_AUDIENCE",
  "OPENAI_API_KEY",
  "OPENAI_ARTICLE_MODEL",
  "OPENAI_UTILITY_MODEL",
  "OPENAI_MAX_DAILY_GENERATIONS",
  "OPENAI_MAX_DAILY_ARTICLE_QUESTIONS",
  "OPENAI_MAX_DAILY_FEED_COMMANDS",
  "OPENAI_WEB_SEARCH_COST_MICROUSD",
  "WEB_APP_URL",
  "CRON_SECRET",
  "CORS_ALLOWED_ORIGINS",
  "EDISON_ALLOWED_EMAILS",
  "EDISON_ADMIN_EMAILS",
  "EDISON_DAILY_EDITION_LOCAL_HOUR",
  "EDISON_DAILY_EDITION_TARGET",
  "EDISON_DAILY_EDITION_BATCH_SIZE",
] as const;

function value(
  environment: Readonly<Record<string, string | undefined>>,
  name: string,
) {
  return environment[name]?.trim() ?? "";
}

function validInteger(raw: string, minimum: number, maximum: number) {
  const parsed = Number(raw);
  return (
    raw.length > 0 &&
    Number.isInteger(parsed) &&
    parsed >= minimum &&
    parsed <= maximum
  );
}

function emailList(raw: string) {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean);
  if (
    !entries.length ||
    entries.some((entry) => !EMAIL_PATTERN.test(entry)) ||
    new Set(entries).size !== entries.length
  ) {
    return null;
  }
  return entries;
}

function exactHttpsOrigin(raw: string) {
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" && parsed.pathname === "/" &&
        !parsed.search && !parsed.hash && !parsed.username && !parsed.password
      ? parsed.origin
      : null;
  } catch {
    return null;
  }
}

export function productionRuntimeConfigurationIssues(
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const issues = new Set<string>();
  const demandFlag = environment.EDISON_ON_DEMAND_ENABLED;
  if (demandFlag !== undefined && demandFlag !== "true" && demandFlag !== "false") issues.add("EDISON_ON_DEMAND_ENABLED");
  if (demandFlag === "true") {
    try { demandLimits(environment); } catch { issues.add("on_demand_limits"); }
  }
  for (const name of requiredRuntimeConfiguration) {
    if (!value(environment, name)) issues.add(name);
  }

  if (value(environment, "SUPABASE_JWT_AUDIENCE") !== "authenticated") {
    issues.add("SUPABASE_JWT_AUDIENCE");
  }
  for (const name of ["OPENAI_ARTICLE_MODEL", "OPENAI_UTILITY_MODEL"]) {
    if (!PRICED_CONFIGURED_MODELS.has(value(environment, name))) {
      issues.add(name);
    }
  }

  const integerRequirements = [
    ["OPENAI_MAX_DAILY_GENERATIONS", 1, 100],
    ["OPENAI_MAX_DAILY_ARTICLE_QUESTIONS", 1, 1_000],
    ["OPENAI_MAX_DAILY_FEED_COMMANDS", 1, 1_000],
    // Keep readiness identical to the provider-stage fail-closed boundary.
    // Per-request reservations still decide whether an otherwise valid price
    // can be afforded; they are never raised or silently clamped here.
    ["OPENAI_WEB_SEARCH_COST_MICROUSD", 0, 1_000_000],
    ["EDISON_DAILY_EDITION_LOCAL_HOUR", 0, 23],
    ["EDISON_DAILY_EDITION_TARGET", 1, 10],
    ["EDISON_DAILY_EDITION_BATCH_SIZE", 1, 100],
  ] as const;
  for (const [name, minimum, maximum] of integerRequirements) {
    if (!validInteger(value(environment, name), minimum, maximum)) {
      issues.add(name);
    }
  }
  if (
    Number(value(environment, "OPENAI_MAX_DAILY_GENERATIONS")) <
    Number(value(environment, "EDISON_DAILY_EDITION_TARGET"))
  ) {
    issues.add("daily_generation_capacity");
  }

  const webOrigin = exactHttpsOrigin(value(environment, "WEB_APP_URL"));
  if (!webOrigin) issues.add("WEB_APP_URL");
  const corsOrigins = value(environment, "CORS_ALLOWED_ORIGINS")
    .split(",")
    .map((origin) => exactHttpsOrigin(origin.trim()))
    .filter((origin): origin is string => Boolean(origin));
  if (
    !corsOrigins.length ||
    new Set(corsOrigins).size !== corsOrigins.length ||
    corsOrigins.length !==
      value(environment, "CORS_ALLOWED_ORIGINS").split(",").length ||
    (webOrigin !== null && !corsOrigins.includes(webOrigin))
  ) {
    issues.add("CORS_ALLOWED_ORIGINS");
  }

  if (value(environment, "CRON_SECRET").length < 32) {
    issues.add("CRON_SECRET");
  }
  const allowedEmails = emailList(value(environment, "EDISON_ALLOWED_EMAILS"));
  const adminEmails = emailList(value(environment, "EDISON_ADMIN_EMAILS"));
  if (!allowedEmails) issues.add("EDISON_ALLOWED_EMAILS");
  if (!adminEmails) issues.add("EDISON_ADMIN_EMAILS");
  if (
    allowedEmails &&
    adminEmails?.some((email) => !allowedEmails.includes(email))
  ) {
    issues.add("EDISON_ADMIN_EMAILS");
  }

  return [...issues];
}
