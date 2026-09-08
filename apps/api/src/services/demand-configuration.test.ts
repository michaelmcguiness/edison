import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../http/errors";
import { demandLimits, demandReservationMicrousd } from "./demand-configuration";
import { productionRuntimeConfigurationIssues } from "./runtime-configuration";

test("request allowances default to six ideas and eight articles without changing dollar limits or reservations", () => {
  assert.deepEqual(demandLimits({}), {
    monthlyMicrousd: 40_000_000,
    dailyMicrousd: 4_000_000,
    dailySessions: 30,
    dailyIdeas: 6,
    dailyArticles: 8,
    dailyFeedback: 10,
    dailyQuestions: 20,
    maxConcurrent: 2,
  });
  assert.deepEqual(demandReservationMicrousd, {
    ideas: 600_000, article: 1_200_000, feedback: 100_000, question: 250_000,
  });
});

test("explicit article allowances from one through eight remain configurable", () => {
  for (let count = 1; count <= 8; count += 1) {
    const limits = demandLimits({ OPENAI_MAX_DAILY_GENERATIONS: String(count) });
    assert.equal(limits.dailyArticles, count);
    assert.equal(limits.dailyIdeas, 6, "the article override does not alter the fixed ideas ceiling");
  }
});

test("article allowances above eight or invalid values fail closed", () => {
  for (const value of ["9", "100", "0", "-1", "4.5", "", "invalid", "Infinity"]) {
    assert.throws(() => demandLimits({ OPENAI_MAX_DAILY_GENERATIONS: value }),
      (error) => error instanceof HttpError && error.status === 503 && error.code === "on_demand_limit_invalid");
  }
});

test("doubled article count does not raise dollar, session, feedback or question ceilings", () => {
  const maximums = {
    EDISON_DEMAND_MONTHLY_MICROUSD: 50_000_000,
    EDISON_DEMAND_DAILY_MICROUSD: 10_000_000,
    EDISON_DEMAND_DAILY_SESSIONS: 100,
    OPENAI_MAX_DAILY_FEED_COMMANDS: 10,
    OPENAI_MAX_DAILY_ARTICLE_QUESTIONS: 20,
  };
  for (const [setting, maximum] of Object.entries(maximums)) {
    assert.doesNotThrow(() => demandLimits({ OPENAI_MAX_DAILY_GENERATIONS: "8", [setting]: String(maximum) }));
    assert.throws(() => demandLimits({ OPENAI_MAX_DAILY_GENERATIONS: "8", [setting]: String(maximum + 1) }), HttpError);
  }
});

test("on-demand runtime readiness accepts eight and flags nine at the same boundary", () => {
  const environment = { EDISON_ON_DEMAND_ENABLED: "true", OPENAI_MAX_DAILY_GENERATIONS: "8" };
  assert.equal(productionRuntimeConfigurationIssues(environment).includes("on_demand_limits"), false);
  assert.equal(productionRuntimeConfigurationIssues({ ...environment, OPENAI_MAX_DAILY_GENERATIONS: "9" }).includes("on_demand_limits"), true);
});
