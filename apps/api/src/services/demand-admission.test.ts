import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "../http/errors";
import {
  assertDemandAdmissionCapacity, assertDemandBudgetCapacity, demandRequestHeldMicrousd,
} from "./demand-admission";

const limits = { EDISON_DEMAND_DAILY_MICROUSD: "4000000", EDISON_DEMAND_MONTHLY_MICROUSD: "40000000" };
const settledLegacy = { daily: 0, monthly: 0, unpriced: false, outstanding: false };
const request = { status: "failed", failureCode: "provider_invalid", attempts: 1, reservedMicrousd: 1_200_000 };
const succeeded = [{ status: "succeeded" }, { status: "succeeded" }];
const budgetError = (error: unknown) => error instanceof HttpError && error.status === 429 && error.code === "reading_budget_reached";

test("a completed provider-invalid failure released only its unused hold, not its recorded spend", () => {
  const spent = 50_000;
  const held = demandRequestHeldMicrousd(request, succeeded, spent);
  assert.equal(held, 0);
  const additional = Math.max(0, request.reservedMicrousd - spent - held);
  assert.equal(additional, 1_150_000);
  assert.doesNotThrow(() => assertDemandBudgetCapacity({
    daily: 2_850_000, monthly: 2_850_000, unpriced: false,
    legacy: settledLegacy, additionalMicrousd: additional,
  }, limits));
  assert.throws(() => assertDemandBudgetCapacity({
    daily: 2_850_001, monthly: 2_850_001, unpriced: false,
    legacy: settledLegacy, additionalMicrousd: additional,
  }, limits), budgetError);
});

test("ordinary safe transport retries retain their unused hold and must not reserve it twice", () => {
  for (const failureCode of ["worker_interrupted", "workflow_dispatch_failed"]) {
    for (const attempts of [1, 2]) {
      const original = { ...request, failureCode, attempts };
      const held = demandRequestHeldMicrousd(original, succeeded, 50_000);
      assert.equal(held, 1_150_000);
      assert.equal(Math.max(0, original.reservedMicrousd - 50_000 - held), 0);
      assert.doesNotThrow(() => assertDemandBudgetCapacity({ daily: 4_000_000, monthly: 40_000_000,
        unpriced: false, legacy: settledLegacy, additionalMicrousd: 0 }, limits));
    }
    assert.equal(demandRequestHeldMicrousd({ ...request, failureCode, attempts: 3 }, succeeded, 50_000), 0);
  }
});

test("queued, running and ambiguous provider work keep the unused reservation", () => {
  for (const status of ["queued", "running"]) {
    assert.equal(demandRequestHeldMicrousd({ ...request, status }, succeeded, 50_000), 1_150_000);
  }
  for (const status of ["reserved", "uncertain"]) {
    assert.equal(demandRequestHeldMicrousd(request, [{ status }], 50_000), 1_150_000);
    assert.equal(demandRequestHeldMicrousd({ ...request, attempts: 3 }, [{ status }], 50_000), 1_150_000);
  }
  assert.equal(demandRequestHeldMicrousd({ ...request, status: "succeeded" }, succeeded, 50_000), 0);
  assert.equal(demandRequestHeldMicrousd(request, [{ status: "failed" }], 50_000), 0);
});

test("held amounts never go negative and invalid amounts are not silently accepted", () => {
  assert.equal(demandRequestHeldMicrousd({ ...request, status: "running" }, succeeded, 1_200_001), 0);
  for (const amount of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => demandRequestHeldMicrousd(request, succeeded, amount), /amount_invalid/);
    assert.throws(() => demandRequestHeldMicrousd({ ...request, reservedMicrousd: amount }, succeeded, 0), /amount_invalid/);
  }
});

test("daily and monthly totals include legacy charges and accept only exact available capacity", () => {
  const input = { daily: 2_000_000, monthly: 38_000_000, unpriced: false,
    legacy: { ...settledLegacy, daily: 1_000_000, monthly: 1_000_000 }, additionalMicrousd: 1_000_000 };
  assert.doesNotThrow(() => assertDemandBudgetCapacity(input, limits));
  assert.throws(() => assertDemandBudgetCapacity({ ...input, daily: input.daily + 1 }, limits), budgetError);
  assert.throws(() => assertDemandBudgetCapacity({ ...input, monthly: input.monthly + 1 }, limits), budgetError);
  assert.throws(() => assertDemandBudgetCapacity({ ...input, additionalMicrousd: input.additionalMicrousd + 1 }, limits), budgetError);
});

test("unknown current or legacy spend and outstanding legacy work block recovery, including zero new hold", () => {
  const input = { daily: 0, monthly: 0, unpriced: false, legacy: settledLegacy, additionalMicrousd: 0 };
  for (const changed of [
    { ...input, unpriced: true }, { ...input, legacy: null },
    { ...input, legacy: { ...settledLegacy, unpriced: true } },
    { ...input, legacy: { ...settledLegacy, outstanding: true } },
  ]) assert.throws(() => assertDemandBudgetCapacity(changed, limits), budgetError);
});

test("budget arithmetic fails closed on missing, noninteger or unsafe amounts", () => {
  const input = { daily: 0, monthly: 0, unpriced: false, legacy: settledLegacy, additionalMicrousd: 1 };
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
    for (const key of ["daily", "monthly", "additionalMicrousd"] as const) {
      assert.throws(() => assertDemandBudgetCapacity({ ...input, [key]: value }, limits), budgetError);
    }
    for (const key of ["daily", "monthly"] as const) {
      assert.throws(() => assertDemandBudgetCapacity({ ...input, legacy: { ...settledLegacy, [key]: value } }, limits), budgetError);
    }
  }
});

test("configured ceilings still enforce the project's maximum spending settings", () => {
  const input = { daily: 0, monthly: 0, unpriced: false, legacy: settledLegacy, additionalMicrousd: 0 };
  for (const environment of [
    { EDISON_DEMAND_DAILY_MICROUSD: "10000001" },
    { EDISON_DEMAND_MONTHLY_MICROUSD: "50000001" },
    { EDISON_DEMAND_DAILY_MICROUSD: "NaN" },
  ]) assert.throws(() => assertDemandBudgetCapacity(input, environment),
    (error: unknown) => error instanceof HttpError && error.code === "on_demand_limit_invalid");
});

test("concurrency rejects before consulting or changing any budget data", async () => {
  let executions = 0;
  const transaction = {
    select: () => ({ from: () => ({ where: async () => [{ outstanding: 2 }] }) }),
    execute: async () => { executions++; throw new Error("must not execute"); },
  } as unknown as Parameters<typeof assertDemandAdmissionCapacity>[0];
  await assert.rejects(assertDemandAdmissionCapacity(transaction, { principalId: "constructed-principal", additionalMicrousd: 0 }, limits),
    (error: unknown) => error instanceof HttpError && error.code === "reading_busy");
  assert.equal(executions, 0);
});

test("the shared transaction helper combines current and legacy budget rows without mutation", async () => {
  let executions = 0;
  const transaction = {
    select: () => ({ from: () => ({ where: async () => [{ outstanding: 1 }] }) }),
    execute: async () => ++executions % 2 === 1
      ? [{ daily: "2000000", monthly: "38000000", unpriced: false }]
      : [{ daily: "1000000", monthly: "1000000", unpriced: false, outstanding: false }],
  } as unknown as Parameters<typeof assertDemandAdmissionCapacity>[0];
  await assertDemandAdmissionCapacity(transaction, { principalId: "constructed-principal", additionalMicrousd: 1_000_000 }, limits);
  assert.equal(executions, 2);
  await assert.rejects(assertDemandAdmissionCapacity(transaction, { principalId: "constructed-principal", additionalMicrousd: 1_000_001 }, limits), budgetError);
  assert.equal(executions, 4);
});
