import assert from "node:assert/strict";
import test from "node:test";
import { demandHistorySchema, demandIdeaResultSchema, type DemandIdea, type DemandRequest } from "@edison/contracts";

const id = (number: number) => `00000000-0000-4000-8000-${String(number).padStart(12, "0")}`;
const now = "2026-09-06T18:00:00.000Z";
const idea: DemandIdea = { id: id(1), loopId: id(2), batchRequestId: id(3), batchRevision: 0,
  rank: 1, title: "An earlier saved idea", deck: "Previously checked reading", articleRequestId: id(4), saved: true, createdAt: now };
const request: DemandRequest = { id: id(4), loopId: id(2), ideaId: id(1), kind: "article", stage: "ready",
  status: "succeeded", failure: null, createdAt: now, updatedAt: now };
const page = { workspaceId: id(10), ideas: [idea], requests: [request], nextCursor: null };

test("bounded history DTO preserves canonical article identity without exposing generation internals", () => {
  assert.deepEqual(demandHistorySchema.parse(page), page);
  for (const invalid of [
    { ...page, ideas: [idea, idea] },
    { ...page, requests: [request, request] },
    { ...page, requests: [{ ...request, ideaId: id(11) }] },
    { ...page, requests: [{ ...request, loopId: id(11) }] },
    { ...page, requests: [{ ...request, kind: "feedback" }] },
    { ...page, requests: [{ ...request, snapshot: { providerDraft: "private" } }] },
    { ...page, ideas: Array.from({ length: 61 }, (_, index) => ({ ...idea, id: id(100 + index) })) },
  ]) assert.equal(demandHistorySchema.safeParse(invalid).success, false);
});

test("exact idea recovery accepts unwritten ideas and rejects mismatched article ownership", () => {
  const result = { workspaceId: id(10), idea, request };
  assert.deepEqual(demandIdeaResultSchema.parse(result), result);
  assert.equal(demandIdeaResultSchema.safeParse({ ...result, idea: { ...idea, articleRequestId: null }, request: null }).success, true);
  for (const invalid of [
    { ...result, request: { ...request, id: id(12) } },
    { ...result, request: { ...request, ideaId: id(12) } },
    { ...result, request: { ...request, kind: "question" } },
  ]) assert.equal(demandIdeaResultSchema.safeParse(invalid).success, false);
});
