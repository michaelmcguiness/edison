import { HttpError } from "../http/errors";

export function demandEnabled(environment = process.env) {
  return environment.EDISON_ON_DEMAND_ENABLED === "true";
}

export function requireDemandEnabled() {
  if (!demandEnabled()) throw new HttpError(503, "on_demand_unavailable", "On-demand reading is not available yet.");
}

export function requireLegacyAiEnabled() {
  if (demandEnabled()) throw new HttpError(409, "use_on_demand_reading", "Create a learning loop and choose the article you want to read.");
}

function boundedSetting(environment: Readonly<Record<string, string | undefined>>, name: string, fallback: number, maximum: number) {
  const value = environment[name];
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new HttpError(503, "on_demand_limit_invalid", "On-demand reading limits need attention.");
  }
  return parsed;
}

export function demandLimits(environment: Readonly<Record<string, string | undefined>> = process.env) {
  return {
    // New-path ceilings cannot raise the existing funded project cap. Reservations
    // stay charged to the limit even on failures until actual usage is known.
    monthlyMicrousd: boundedSetting(environment, "EDISON_DEMAND_MONTHLY_MICROUSD", 40_000_000, 50_000_000),
    dailyMicrousd: boundedSetting(environment, "EDISON_DEMAND_DAILY_MICROUSD", 4_000_000, 10_000_000),
    dailySessions: boundedSetting(environment, "EDISON_DEMAND_DAILY_SESSIONS", 30, 100),
    dailyIdeas: 3,
    dailyArticles: boundedSetting(environment, "OPENAI_MAX_DAILY_GENERATIONS", 4, 4),
    dailyFeedback: boundedSetting(environment, "OPENAI_MAX_DAILY_FEED_COMMANDS", 10, 10),
    dailyQuestions: boundedSetting(environment, "OPENAI_MAX_DAILY_ARTICLE_QUESTIONS", 20, 20),
    maxConcurrent: 2,
  };
}

export const demandReservationMicrousd = {
  ideas: 600_000, article: 1_200_000, feedback: 100_000, question: 250_000,
} as const;

export function demandFailure(code: string | null) {
  const failures: Record<string, { message: string; retryable: boolean }> = {
    workflow_dispatch_failed: { message: "Preparation could not start. Try again to resume this request.", retryable: true },
    worker_interrupted: { message: "Preparation was interrupted. Try again to resume the saved work.", retryable: true },
    evidence_unavailable: { message: "We could not retrieve enough reliable evidence for this idea. Your loop is saved; you can request other ideas.", retryable: false },
    editorial_withheld: { message: "This article did not pass its evidence and editorial checks. It has not been published. You can choose another idea.", retryable: false },
    feedback_unclear: { message: "We could not confidently apply that change. Your previous settings are unchanged. Try describing what to change more specifically.", retryable: false },
    loop_changed: { message: "The loop changed while this request was running. Your latest settings are safe; request fresh ideas or submit your feedback again.", retryable: false },
    provider_uncertain: { message: "We could not confirm the provider result. We have stopped this request to avoid commissioning it twice.", retryable: false },
    provider_invalid: { message: "The provider returned a result we could not safely use. Nothing was published. You can choose another idea.", retryable: false },
    budget_exhausted: { message: "The reading allowance is currently used up. Existing articles remain available; try new reading later.", retryable: false },
    evidence_limit: { message: "This evidence packet was too large to check safely. Your loop is saved; try a more specific direction or another idea.", retryable: false },
    reading_session_expired: { message: "This reading session is no longer active. The request was stopped without publishing new reading.", retryable: false },
    loop_context_full: { message: "This loop has reached its saved-instruction limit. Your existing preferences are unchanged.", retryable: false },
  };
  return { code: code ?? "preparation_failed", ...(failures[code ?? ""] ?? {
    message: "We could not finish preparing this request. Your existing reading is safe.", retryable: false,
  }) };
}
