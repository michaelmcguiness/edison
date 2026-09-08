import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("admin diagnostics expose incomplete cost accounting", () => {
  const source = readFileSync(
    new URL("../../app/v1/admin/jobs/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /unpricedResponses/);
  assert.match(source, /knownCostUsd/);
  assert.match(
    source,
    /usage\.unpricedResponses > 0\s*\? null\s*:\s*usage\.costMicrousd/,
  );
});

test("readiness requires nullable unknown cost and its consistency constraint", () => {
  const source = readFileSync(
    new URL("../../app/v1/health/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /attribute\.attname = 'pricing_status'/);
  assert.match(source, /attribute\.attname = 'cost_microusd'/);
  assert.match(source, /not attribute\.attnotnull/);
  assert.match(source, /usage_ledger_pricing_consistent/);
});
