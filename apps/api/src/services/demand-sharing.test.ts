import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";
import type { DemandTransaction, withDemandWorkerDb } from "@edison/db";
import { sharedArticleSnapshotSchema } from "@edison/contracts";
import { createDemandArticleShareSchema, demandSharedArticleSchema, publicDemandArticleShareSchema } from "../../../../packages/contracts/src/demand-sharing";
import { createDemandArticleShare, demandShareSnapshot, getDemandArticleShare,
  DEMAND_SHARES_PER_DAY, DEMAND_SHARE_OPERATIONS_PER_DAY } from "./demand-sharing";
import type { DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";

const ownerId = "10000000-0000-4000-8000-000000000001";
const articleId = "10000000-0000-4000-8000-000000000002";
const otherArticleId = "10000000-0000-4000-8000-000000000003";
const sourceId = "10000000-0000-4000-8000-000000000004";
const shareId = "10000000-0000-4000-8000-000000000005";
const now = new Date("2026-09-07T14:00:00.000Z");
const token = "b".repeat(64);
const principal: DemandPrincipal = { id: ownerId, accountUserId: null, guestTokenHash: "a".repeat(64),
  expiresAt: new Date("2026-12-01T00:00:00Z"), revokedAt: null, createdAt: now };
const input = { confirmPublic: true as const, idempotencyKey: "share-test-key" };
function article(sourced = false) {
  return { id: articleId, slug: "constructed-sharing", category: "tech-science", kicker: "Example",
    topic: "Feedback", title: "A constructed feedback example", deck: "A short explanation without private context.",
    body: [{ type: "heading", level: 2, text: "The comparison" },
      { type: "paragraph", text: "A controller compares a reading with its target.", citations: sourced ? [{ sourceId, label: "1" }] : [] },
      { type: "quote", text: "The target is not the reading.", attribution: "Constructed example", citations: [] }],
    sources: sourced ? [{ id: sourceId, title: "Constructed source", publisher: "Example", url: "https://example.org/control",
      publishedAt: null, accessedAt: now.toISOString() }] : [],
    sourceCount: sourced ? 1 : 0, basis: sourced ? "mixed" : "general_knowledge", researchedAt: sourced ? now.toISOString() : null,
    readingMinutes: 1, reason: "PRIVATE WHY WRITTEN", summary: ["Measure", "Compare", "Adjust"],
    saved: true, completed: true, writtenFor: "PRIVATE PERSONALIZATION", shareId: null,
    originalCuriosity: "PRIVATE CURIOSITY", principles: ["PRIVATE INSTRUCTION"],
    history: ["PRIVATE HISTORY"], chat: ["PRIVATE CHAT"], principalId: ownerId };
}
const saved = { id: shareId, articleRequestId: articleId, token, createdAt: now, revokedAt: null };
const ready = { id: articleId, kind: "article", status: "succeeded", result: { article: article(),
  evidence: { private: "NEVER SHARE RAW EVIDENCE" }, draft: { whyWritten: "PRIVATE DRAFT" } }, updatedAt: now };

function fakeTransaction(replies: unknown[][]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const transaction: typeof withDemandWorkerDb = async (callback) => callback({
    execute: async (statement: SQL) => {
      queries.push(new PgDialect().sqlToQuery(statement));
      assert.ok(replies.length, "Unexpected database operation");
      return replies.shift();
    },
  } as unknown as DemandTransaction);
  return { transaction, queries, replies };
}
function creationReplies(options: { operations?: number; shares?: number; existing?: typeof saved } = {}) {
  return [[{ id: ownerId }], [{ active: true }], [], [ready],
    [{ operations: options.operations ?? 0, shares: options.shares ?? 0 }],
    options.existing ? [options.existing] : [], ...(options.existing ? [] : [[saved]]), []];
}
const errorCode = (code: string) => (error: unknown) => error instanceof HttpError && error.code === code;

test("public snapshots retain source-free or sourced reading and exclude all private context recursively", () => {
  for (const sourced of [false, true]) {
    const original = article(sourced); const before = JSON.stringify(original);
    const snapshot = demandShareSnapshot(original, articleId, now);
    assert.deepEqual(snapshot.body, original.body);
    assert.deepEqual(snapshot.sources, original.sources);
    assert.equal(snapshot.researchedAt, sourced ? now.toISOString() : null);
    assert.equal(snapshot.basis, sourced ? "mixed" : "general_knowledge");
    assert.equal(snapshot.publishedAt, now.toISOString());
    assert.doesNotMatch(JSON.stringify(snapshot), /PRIVATE|principalId|originalCuriosity|whyWritten|reason|writtenFor|history|chat|draft|snapshot/);
    assert.equal(JSON.stringify(original), before);
    snapshot.body[0].text = "Changed local projection";
    assert.equal(JSON.stringify(original), before, "Projection must not share mutable references");
  }
  assert.throws(() => demandShareSnapshot(article(), otherArticleId, now), errorCode("article_not_found"));
});

test("new sharing contract is strict, bounded and citation-consistent without weakening legacy shares", () => {
  const snapshot = demandShareSnapshot(article(), articleId, now);
  assert.equal(demandSharedArticleSchema.safeParse(snapshot).success, true);
  assert.equal(sharedArticleSnapshotSchema.safeParse(snapshot).success, false, "Legacy schema is untouched");
  for (const invalid of [
    { ...snapshot, whyWritten: "private" },
    { ...snapshot, body: [{ ...snapshot.body[1], principalId: ownerId }] },
    { ...snapshot, body: [{ type: "paragraph", text: "Unknown citation", citations: [{ sourceId, label: "1" }] }] },
    { ...snapshot, researchedAt: now.toISOString() },
    { ...snapshot, body: [{ type: "paragraph", text: "界".repeat(100000), citations: [] }] },
  ]) assert.equal(demandSharedArticleSchema.safeParse(invalid).success, false);
  const sourced = demandShareSnapshot(article(true), articleId, now);
  assert.equal(demandSharedArticleSchema.safeParse({ ...sourced, sources: [...sourced.sources, ...sourced.sources], sourceCount: 2 }).success, false);
});

test("sharing requires explicit public confirmation before any database work", async () => {
  const fake = fakeTransaction([]);
  for (const raw of [{ idempotencyKey: input.idempotencyKey }, { ...input, confirmPublic: false }, { ...input, article: article() }]) {
    assert.equal(createDemandArticleShareSchema.safeParse(raw).success, false);
    await assert.rejects(createDemandArticleShare(principal, articleId, raw as typeof input, fake));
  }
  assert.equal(fake.queries.length, 0);
});

test("guest and account publication lock ownership and record one immutable copy plus operation atomically", async () => {
  for (const owner of [principal, { ...principal, accountUserId: otherArticleId, guestTokenHash: null, expiresAt: null }]) {
    const fake = fakeTransaction(creationReplies());
    const result = await createDemandArticleShare(owner, articleId, input, { ...fake, token: () => token });
    assert.deepEqual(result, { token, createdAt: now.toISOString(), created: true });
    assert.equal(fake.replies.length, 0);
    assert.match(fake.queries[0].sql, /demand_principals[\s\S]*for update/);
    assert.match(fake.queries[1].sql, /demand_principal_is_active/);
    assert.match(fake.queries[3].sql, /where id = [\s\S]* and principal_id = [\s\S]* for update/);
    assert.deepEqual(fake.queries[3].params, [articleId, ownerId]);
    const publication = fake.queries.find((query) => query.sql.includes("insert into private.demand_public_shares"))!;
    assert.deepEqual(publication.params.slice(0, 3), [ownerId, articleId, token]);
    assert.doesNotMatch(String(publication.params[3]), /PRIVATE|draft|reason|principalId/);
    assert.match(String(publication.params[4]), /^[a-f0-9]{64}$/);
    assert.match(fake.queries.at(-1)!.sql, /insert into private.demand_share_operations/);
    assert.doesNotMatch(fake.queries.map((query) => query.sql).join("\n"), /demand_usage|demand_stages|insert into private.demand_requests|update private.demand_requests/);
  }
});

test("lost-response recovery reuses one key before rate checks; conflicting keys or revoked shares do not republish", async () => {
  const replay = fakeTransaction([[{ id: ownerId }], [{ active: true }], [saved]]);
  assert.deepEqual(await createDemandArticleShare(principal, articleId, input, replay), { token, createdAt: now.toISOString(), created: false });
  assert.equal(replay.queries.length, 3);
  for (const [share, expected] of [[{ ...saved, articleRequestId: otherArticleId }, "idempotency_key_reused"],
    [{ ...saved, revokedAt: now }, "share_not_found"]] as const) {
    const fake = fakeTransaction([[{ id: ownerId }], [{ active: true }], [share]]);
    await assert.rejects(createDemandArticleShare(principal, articleId, input, fake), errorCode(expected));
    assert.equal(fake.queries.length, 3);
  }
  const reuse = fakeTransaction(creationReplies({ existing: saved, shares: DEMAND_SHARES_PER_DAY }));
  assert.equal((await createDemandArticleShare(principal, articleId, { ...input, idempotencyKey: "another-key" }, reuse)).created, false);
  assert.equal(reuse.queries.filter((query) => query.sql.includes("insert into private.demand_public_shares")).length, 0);
  assert.match(reuse.queries.at(-1)!.sql, /insert into private.demand_share_operations/);
});

test("expired or foreign ownership and incomplete/nonarticle results cannot publish", async () => {
  const inactive = fakeTransaction([[{ id: ownerId }], [{ active: false }]]);
  await assert.rejects(createDemandArticleShare(principal, articleId, input, inactive), errorCode("reading_session_expired"));
  for (const request of [undefined, { ...ready, status: "failed" }, { ...ready, status: "running" },
    { ...ready, kind: "question" }, { ...ready, result: null }]) {
    const fake = fakeTransaction([[{ id: ownerId }], [{ active: true }], [], request ? [request] : []]);
    await assert.rejects(createDemandArticleShare(principal, articleId, input, fake), errorCode("article_not_found"));
    assert.equal(fake.queries.length, 4);
  }
});

test("rolling share/operation limits enforce exact boundaries without touching generation budgets", async () => {
  assert.equal(DEMAND_SHARES_PER_DAY, 20); assert.equal(DEMAND_SHARE_OPERATIONS_PER_DAY, 200);
  const allowed = fakeTransaction(creationReplies({ shares: 19, operations: 199 }));
  assert.equal((await createDemandArticleShare(principal, articleId, input, { ...allowed, token: () => token })).created, true);
  for (const counts of [{ shares: 20, operations: 0 }, { shares: 0, operations: 200 }]) {
    const fake = fakeTransaction(creationReplies(counts));
    await assert.rejects(createDemandArticleShare(principal, articleId, input, fake), errorCode("sharing_rate_limit"));
    assert.equal(fake.queries.some((query) => query.sql.includes("insert into")), false);
    assert.match(fake.queries[4].sql, /statement_timestamp\(\) - interval '24 hours'/);
  }
});

test("public reads accept only opaque bounded tokens and use only the narrow public function", async () => {
  for (const invalid of ["", "b".repeat(63), "b".repeat(65), "B".repeat(64), "../private", "b".repeat(100000)]) {
    const fake = fakeTransaction([]);
    assert.equal(await getDemandArticleShare(invalid, fake), null);
    assert.equal(fake.queries.length, 0);
  }
  const snapshot = demandShareSnapshot(article(true), articleId, now);
  const fake = fakeTransaction([[{ token, createdAt: now, snapshot }]]);
  const result = await getDemandArticleShare(token, fake);
  assert.deepEqual(result, { token, createdAt: now.toISOString(), article: snapshot });
  assert.equal(publicDemandArticleShareSchema.safeParse(result).success, true);
  assert.match(fake.queries[0].sql, /edison_public_api\.read_demand_article_share/);
  assert.doesNotMatch(fake.queries[0].sql, /private\.|demand_requests/);
  assert.equal(await getDemandArticleShare(token, fakeTransaction([[]])), null);
});

test("migration preserves immutable ownership, denies public table access and whitelists nested public fields", () => {
  const migration = readFileSync(new URL("../../../../supabase/migrations/20260907000200_demand_public_shares.sql", import.meta.url), "utf8");
  assert.match(migration, /UNIQUE \(principal_id, article_request_id\)/);
  assert.match(migration, /UNIQUE \(principal_id, idempotency_key\)/);
  assert.match(migration, /FOREIGN KEY \(principal_id, article_request_id, share_id\)/);
  assert.match(migration, /ON DELETE RESTRICT/);
  assert.match(migration, /BEFORE UPDATE OR DELETE ON private.demand_public_shares/);
  assert.match(migration, /FORCE ROW LEVEL SECURITY/g);
  assert.match(migration, /GRANT SELECT, INSERT ON TABLE private.demand_public_shares, private.demand_share_operations TO edison_demand_worker/);
  assert.match(migration, /SECURITY DEFINER SET search_path = pg_catalog/);
  const reader = migration.slice(migration.indexOf("CREATE FUNCTION edison_public_api.read_demand_article_share"));
  assert.doesNotMatch(reader, /demand_loops|demand_requests|demand_principals|s\.snapshot\s*,/);
  assert.match(reader, /jsonb_build_object\('sourceId',c.value->'sourceId','label',c.value->'label'\)/);
  assert.match(reader, /s\.revoked_at IS NULL/);
});
