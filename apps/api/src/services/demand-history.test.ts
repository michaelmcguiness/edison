import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseDemandHistoryQuery } from "@edison/contracts";
import { HttpError } from "../http/errors";
import { decodeDemandHistoryCursor, encodeDemandHistoryCursor } from "./demand-history";
import { matchDemandRoute } from "./demand-dispatch";
import { demandIdeaSummarySelection, demandRequestSummarySelection } from "./demand-reading";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;

test("history cursors are bound to version, verified reader and exact filter", () => {
  const query = { scope: "saved" as const, loopId: id(2) };
  const cursor = encodeDemandHistoryCursor(id(1), query, id(3));
  assert.equal(decodeDemandHistoryCursor(id(1), { ...query, cursor }), id(3));
  assert.equal(decodeDemandHistoryCursor(id(1), query), null);
  for (const [workspaceId, input] of [
    [id(4), { ...query, cursor }],
    [id(1), { ...query, cursor, scope: "all" as const }],
    [id(1), { scope: "saved" as const, cursor }],
    [id(1), { ...query, loopId: id(4), cursor }],
  ] as const) {
    assert.throws(() => decodeDemandHistoryCursor(workspaceId, input),
      (error) => error instanceof HttpError && error.code === "invalid_history_cursor");
  }
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString());
  for (const mutation of [{ ...decoded, version: 2 }, { ...decoded, secret: "unexpected" }, { ...decoded, anchorId: "not-a-uuid" }]) {
    assert.throws(() => decodeDemandHistoryCursor(id(1), { ...query,
      cursor: Buffer.from(JSON.stringify(mutation)).toString("base64url") }), HttpError);
  }
});

test("malformed, noncanonical, oversized and arbitrary cursor strings fail closed", () => {
  for (const cursor of ["invalid-json", "=", "a".repeat(513), Buffer.from("{}").toString("base64url")]) {
    assert.throws(() => decodeDemandHistoryCursor(id(1), { scope: "all", cursor }), HttpError);
  }
});

test("history query rejects duplicate/unknown/prototype keys and arbitrary page sizes", () => {
  assert.deepEqual(parseDemandHistoryQuery(new URLSearchParams()), { scope: "all" });
  assert.deepEqual(parseDemandHistoryQuery(new URLSearchParams({ scope: "saved", loopId: id(2) })), { scope: "saved", loopId: id(2) });
  for (const query of ["scope=saved&scope=all", "limit=100000", "cursor=", "loopId=invalid", "scope=private", "__proto__=hidden", "constructor=hidden"]) {
    assert.throws(() => parseDemandHistoryQuery(new URLSearchParams(query)));
  }
});

test("history and exact idea recovery are GET-only bounded demand routes", () => {
  assert.deepEqual(matchDemandRoute("GET", ["history"]), { kind: "history" });
  assert.deepEqual(matchDemandRoute("GET", ["ideas", id(1)]), { kind: "idea-result", ideaId: id(1) });
  for (const [method, path] of [["POST", ["history"]], ["POST", ["ideas", id(1)]],
    ["GET", ["ideas", "invalid"]], ["GET", ["history", id(1)]]] as const) {
    assert.equal(matchDemandRoute(method, path), null);
  }
});

test("history source retains exact timestamp keysets, explicit authorization, bounded joins and no commissioning", () => {
  const source = readFileSync(new URL("./demand-history.ts", import.meta.url), "utf8");
  assert.match(source, /withDemandDb\(principal.id/);
  assert.match(source, /withDemandDb\(workspaceId/);
  assert.match(source, /inArray\(demandIdeas.principalId, owners\)/);
  assert.match(source, /private\.demand_principal_is_active/);
  assert.match(source, /createdAt: sql<string>`\$\{demandIdeas.createdAt\}::text`/);
  assert.match(source, /orderBy\(desc\(demandIdeas.createdAt\), asc\(demandIdeas.rank\), desc\(demandIdeas.id\)\)/);
  assert.match(source, /limit\(DEMAND_HISTORY_PAGE_SIZE \+ 1\)/);
  assert.match(source, /inArray\(demandRequests.ideaId, page.map/);
  assert.doesNotMatch(source, /\.offset\(|\.insert\(|\.update\(|\.delete\(|dispatchDemand|requestDemandArticle/);
});

test("workspace and history metadata selects never materialize private generation payloads", () => {
  assert.deepEqual(Object.keys(demandRequestSummarySelection).sort(),
    ["id", "loopId", "ideaId", "kind", "status", "stage", "failureCode", "createdAt", "updatedAt"].sort());
  assert.deepEqual(Object.keys(demandIdeaSummarySelection).sort(),
    ["id", "loopId", "batchRequestId", "batchRevision", "rank", "title", "deck", "articleRequestId", "saved", "createdAt", "art"].sort());
  const reading = readFileSync(new URL("./demand-reading.ts", import.meta.url), "utf8");
  const workspace = reading.slice(reading.indexOf("export async function demandWorkspace"), reading.indexOf("export async function demandRequestResult"));
  assert.match(workspace, /demandLoopPage\(principal/);
  const listing = readFileSync(new URL("./demand-loop-list.ts", import.meta.url), "utf8");
  assert.match(listing, /select\(demandIdeaSummarySelection\)\.from\(demandIdeas\)/);
  assert.match(listing, /select\(demandRequestSummarySelection\)\.from\(demandRequests\)/);
  assert.doesNotMatch(listing, /select\(\)\.from\(demand(?:Ideas|Requests)\)/);
  const history = readFileSync(new URL("./demand-history.ts", import.meta.url), "utf8");
  assert.doesNotMatch(history, /select\(\)\.from\(demand(?:Ideas|Requests)\)/);
});
