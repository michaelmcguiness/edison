import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import * as drizzle from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import ts from "typescript";
import * as contracts from "@edison/contracts";
import * as database from "@edison/db";
import { demandOwnerIds, demandWorkspaceId, type DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";

const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
const plain = (value: unknown) => JSON.parse(JSON.stringify(value));
const allowance: contracts.DemandAllowance = {
  limit: 500, used: 20, periodUsed: 37, reserved: 6, remaining: 480, available: 474,
  periodStart: "2026-09-07T00:00:00.000Z", resetsAt: "2026-09-14T00:00:00.000Z",
  revision: 1, manualResetAt: "2026-09-08T00:00:00.000Z",
};
function principal(account: boolean, group = [id(1)]): DemandPrincipal {
  return {
    id: id(1), accountUserId: account ? id(2) : null,
    guestTokenHash: null, createdAt: new Date("2026-09-07T00:00:00Z"), expiresAt: null, revokedAt: null,
    workspaceId: id(3), ownerPrincipalIds: group,
  };
}
const failedRequest: contracts.DemandRequest = {
  id: id(10), loopId: id(11), ideaId: id(12), kind: "article", status: "failed", stage: "failed",
  failure: { code: "provider_invalid", retryable: false, message: "Constructed failure." },
  createdAt: "2026-09-08T00:00:00.000Z", updatedAt: "2026-09-08T00:00:01.000Z",
};

// Execute the complete current service module, injecting only I/O boundaries.
// SQL expressions, ownership helpers and public DTO validation remain real.
function workspaceHarness(options: {
  size?: number; requests?: contracts.DemandRequest[]; pageError?: Error;
  allowanceError?: Error; countError?: Error; recoveryError?: Error;
} = {}) {
  const calls: Array<{ name: string; args: unknown[] }> = [];
  const countQueries: ReturnType<PgDialect["sqlToQuery"]>[] = [];
  const page = { loops: [], ideas: [], requests: options.requests ?? [], nextCursor: "retained-cursor" };
  const tx = {
    select(selection: Record<string, unknown>) {
      const counting = Object.hasOwn(selection, "size");
      calls.push({ name: counting ? "count" : "owners", args: [selection] });
      return { from(table: unknown) {
        assert.equal(table, counting ? database.demandLoops : database.demandRequests);
        return { where(predicate: drizzle.SQL) {
          if (counting) {
            countQueries.push(new PgDialect().sqlToQuery(predicate));
            if (options.countError) throw options.countError;
            return Promise.resolve([{ size: options.size ?? 0 }]);
          }
          return { orderBy() { return { limit(limit: number) {
            assert.equal(limit, 8);
            return Promise.resolve([{ id: failedRequest.id, principalId: id(4) }]);
          } }; } };
        } };
      } };
    },
  };
  const imports: Record<string, unknown> = {
    "node:crypto": crypto, "drizzle-orm": drizzle, "@edison/contracts": contracts,
    "@edison/db": { ...database, withDemandDb: async (owner: string, operation: (transaction: typeof tx) => Promise<unknown>) => {
      calls.push({ name: "transaction", args: [owner] });
      return operation(tx);
    }, withDemandWorkerDb: () => { throw new Error("Workspace must not invoke a worker transaction."); } },
    "@edison/domain": {}, "@edison/ai": {}, "../http/errors": { HttpError },
    "../auth/verify-demand-principal": { demandOwnerIds, demandWorkspaceId },
    "./demand-allowance": { demandAllowance: async (owner: DemandPrincipal) => {
      calls.push({ name: "allowance", args: [owner] });
      if (options.allowanceError) throw options.allowanceError;
      return allowance;
    } },
    "./demand-loop-list": { demandLoopPage: async (owner: DemandPrincipal, input: unknown) => {
      calls.push({ name: "page", args: [owner, input] });
      if (options.pageError) throw options.pageError;
      return page;
    } },
    "./demand-check-recovery": { recoverableDemandCheckIds: async (owner: string, ids: string[]) => {
      calls.push({ name: "recovery", args: [owner, ids] });
      if (options.recoveryError) throw options.recoveryError;
      return new Set(ids);
    } },
    "./demand-idea-art": {}, "./demand-configuration": {}, "./demand-result-compatibility": {},
    "./demand-question-history": {}, "./demand-admission": {}, "./demand-loop-management": {},
  };
  const exports: Record<string, unknown> = {};
  const file = new URL("./demand-reading.ts", import.meta.url);
  new Script(ts.transpileModule(readFileSync(file, "utf8"), {
    fileName: file.pathname, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText).runInNewContext({ exports, Date, JSON, Set, Error, require(name: string) {
    if (!(name in imports)) throw new Error(`Unexpected workspace dependency: ${name}`);
    return imports[name];
  } });
  return { calls, countQueries, page,
    read: exports.demandWorkspace as (owner: DemandPrincipal) => Promise<contracts.DemandWorkspace> };
}
const names = (harness: ReturnType<typeof workspaceHarness>) => harness.calls.map(call => call.name);

test("account workspace skips the count transaction while retaining real validation, allowance and page identity", async () => {
  const owner = principal(true, [id(1), id(4)]);
  const before = plain(owner);
  const harness = workspaceHarness({ countError: new Error("Unused count must not execute.") });
  const workspace = await harness.read(owner);
  assert.deepEqual(names(harness), ["page", "allowance"]);
  assert.deepEqual(plain(workspace), {
    workspaceId: id(3), readerKind: "account", loops: [], ideas: [], requests: [],
    loopsNextCursor: "retained-cursor", allowance,
    accountGate: { canCreateLoop: true, canRefresh: true, reason: null },
  });
  assert.equal(harness.calls[0].args[0], owner);
  assert.deepEqual(plain(harness.calls[0].args[1]), {});
  assert.equal(harness.calls[1].args[0], owner);
  assert.deepEqual(plain(owner), before);
});

test("historical guest gate still counts the complete verified owner group, including off-page archived loops", async () => {
  for (const size of [0, 1, 31]) {
    const owner = principal(false, [id(1), id(4)]);
    const harness = workspaceHarness({ size });
    const workspace = await harness.read(owner);
    assert.deepEqual(names(harness), ["page", "allowance", "transaction", "count"]);
    assert.equal(harness.calls[2].args[0], owner.id);
    assert.equal(workspace.readerKind, "guest");
    assert.deepEqual(plain(workspace.accountGate), { canCreateLoop: size === 0, canRefresh: false, reason: "account_required" });
    assert.deepEqual(harness.countQueries[0].params, [id(1), id(4)]);
    assert.match(harness.countQueries[0].sql, /"demand_loops"\."principal_id" in \(\$1, \$2\)/);
    assert.doesNotMatch(harness.countQueries[0].sql, /archived_at|limit|offset/);
  }
  const single = principal(false);
  delete single.ownerPrincipalIds;
  const harness = workspaceHarness();
  await harness.read(single);
  assert.deepEqual(harness.countQueries[0].params, [single.id]);
});

test("skipping the account count does not bypass page, allowance or guest count failures", async () => {
  for (const boundary of ["pageError", "allowanceError", "countError"] as const) {
    const error = new HttpError(403, "reading_session_expired", "Constructed denied reader.");
    const harness = workspaceHarness({ [boundary]: error });
    await assert.rejects(harness.read(principal(boundary !== "countError")), failure => failure === error);
    assert.deepEqual(names(harness), boundary === "pageError" ? ["page"]
      : boundary === "allowanceError" ? ["page", "allowance"] : ["page", "allowance", "transaction", "count"]);
  }
});

test("account recovery still queries exact owners and qualifies the retained failed request without mutation", async () => {
  const original = plain(failedRequest);
  const harness = workspaceHarness({ requests: [failedRequest] });
  const result = await harness.read(principal(true, [id(1), id(4)]));
  assert.deepEqual(names(harness), ["page", "allowance", "transaction", "owners", "recovery"]);
  assert.deepEqual(plain(harness.calls.at(-1)?.args), [id(4), [failedRequest.id]]);
  assert.equal(result.requests[0].failure?.retryable, true);
  assert.equal(result.requests[0].id, failedRequest.id);
  assert.equal(result.requests[0].createdAt, failedRequest.createdAt);
  assert.deepEqual(plain(failedRequest), original);
  const error = new Error("Constructed qualification failure.");
  await assert.rejects(workspaceHarness({ requests: [failedRequest], recoveryError: error }).read(principal(true)), failure => failure === error);
});
