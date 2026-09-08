import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { demandArticleResultSchema, demandConversationSchema, parseDemandConversationQuery } from "@edison/contracts";
import { decodeDemandConversationCursor, encodeDemandConversationCursor, demandConversationTurn } from "../apps/api/src/services/demand-conversation";
import { assertDemandLoopOpen } from "../apps/api/src/services/demand-reading";
import { matchDemandRoute } from "../apps/api/src/services/demand-dispatch";
import { isDemandProxyPath, proxyDemandRequest } from "../lib/demand-proxy";
import { fetchDemandPublicShare, demandPublicShareMetadata } from "../lib/demand-public-share";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const now = "2026-09-07T14:00:00.000Z";
const answer = { version: 2, basis: "general_knowledge", researchedAt: null, sources: [], body: [{ type: "paragraph", text: "A saved answer.", citations: [] }] };
const row = { id: id(1), loopId: id(2), ideaId: id(3), kind: "question" as const, status: "succeeded" as const, stage: "ready",
  failureCode: null, createdAt: new Date(now), updatedAt: new Date(now), question: "The actual submitted question?", answer };

test("conversation projection preserves actual question and answer; raw context and private provider fields never escape", () => {
  const turn = demandConversationTurn({ ...row, ...{ snapshot: { private: true }, provider: "secret" } });
  assert.equal(turn.question, row.question);
  assert.deepEqual(turn.answer, answer);
  assert.deepEqual(Object.keys(turn).sort(), ["answer", "question", "request"]);
  assert.equal(JSON.stringify(turn).includes("secret"), false);
  for (const status of ["queued", "running", "failed"] as const) {
    const pending = demandConversationTurn({ ...row, status, stage: status === "failed" ? "failed" : "answering", failureCode: status === "failed" ? "editorial_withheld" : null });
    assert.equal(pending.answer, null);
    assert.equal(pending.request.failure?.retryable ?? false, false);
  }
  assert.throws(() => demandConversationTurn({ ...row, question: null }));
  assert.throws(() => demandConversationTurn({ ...row, answer: null }));
  const precise = demandConversationTurn({ ...row, createdAtPrecise: "2026-09-07T14:00:00.000123Z", updatedAtPrecise: "2026-09-07T14:00:00.000124Z" });
  assert.equal(precise.request.createdAt, "2026-09-07T14:00:00.000123Z");
  assert.equal(precise.request.updatedAt, "2026-09-07T14:00:00.000124Z");
});

test("conversation cursor is canonical, ownership/article-bound and not an access credential", () => {
  const cursor = encodeDemandConversationCursor(id(1), id(2), id(3));
  assert.equal(decodeDemandConversationCursor(id(1), id(2), cursor), id(3));
  assert.equal(decodeDemandConversationCursor(id(1), id(2)), null);
  for (const args of [[id(9), id(2), cursor], [id(1), id(9), cursor], [id(1), id(2), `${cursor}=`], [id(1), id(2), "invalid"]]) {
    assert.throws(() => decodeDemandConversationCursor(...args as [string, string, string]));
  }
  assert.deepEqual(parseDemandConversationQuery(new URLSearchParams({ cursor })), { cursor });
  for (const query of ["cursor=x&cursor=y", "limit=10000", "workspaceId=x", "__proto__=x"]) {
    assert.throws(() => parseDemandConversationQuery(new URLSearchParams(query)));
  }
});

test("conversation pages retain pending/failed identities but reject duplicate, private or oversized entries", () => {
  const turn = demandConversationTurn(row);
  const page = { workspaceId: id(4), articleId: id(5), turns: [turn], nextCursor: null };
  assert.deepEqual(demandConversationSchema.parse(page), page);
  for (const invalid of [{ ...page, turns: [turn, turn] }, { ...page, snapshot: {} },
    { ...page, turns: [{ ...turn, privateContext: {} }] },
    { ...page, turns: Array.from({ length: 61 }, (_, i) => ({ ...turn, request: { ...turn.request, id: id(i + 10) } })) }]) {
    assert.equal(demandConversationSchema.safeParse(invalid).success, false);
  }
});

test("v10 API and same-origin relay agree on exact routes without accepting traversal or unknown methods", () => {
  for (const [method, path, kind] of [
    ["GET", `articles/${id(1)}`, "article-result"], ["GET", `articles/${id(1)}/conversation`, "conversation"],
    ["POST", `articles/${id(1)}/share`, "share"], ["POST", `loops/${id(1)}/edit`, "edit-loop"], ["POST", `loops/${id(1)}/archive`, "archive-loop"],
  ]) {
    assert.equal(isDemandProxyPath(method, path), true);
    assert.equal(matchDemandRoute(method, path.split("/"))?.kind, kind);
    assert.equal(isDemandProxyPath("DELETE", path), false);
    assert.equal(matchDemandRoute("DELETE", path.split("/")), null);
  }
  for (const path of ["articles/nope", `articles/${id(1)}/../share`, `articles/${id(1)}/private`, `loops/${id(1)}/delete`]) {
    assert.equal(matchDemandRoute("GET", path.split("/")), null);
    assert.equal(isDemandProxyPath("GET", path), false);
  }
});

test("conversation relay validates pagination before forwarding credentials to its fixed upstream", async () => {
  let calls = 0;
  const path = `articles/${id(1)}/conversation`;
  const options = { enabled: true, production: true, apiUrl: "https://api.example.org/v1", fetcher: (async (url: string | URL | Request) => {
    calls++; assert.equal(url, `https://api.example.org/v1/demand/${path}?cursor=YWJj`); return Response.json({});
  }) as typeof fetch };
  assert.equal((await proxyDemandRequest(new Request(`https://edisonreader.com/api/demand/${path}?cursor=YWJj`), path, options)).status, 200);
  for (const suffix of ["cursor=x&cursor=y", "limit=500", "url=https://evil.example"]) {
    assert.equal((await proxyDemandRequest(new Request(`https://edisonreader.com/api/demand/${path}?${suffix}`), path, options)).status, 400);
  }
  assert.equal(calls, 1);
});

const publicArticle = { version: 1 as const, title: "A synthetic shared explanation", deck: "A constructed preview.", body: answer.body,
  sources: [], sourceCount: 0, basis: "general_knowledge" as const, researchedAt: null, readingMinutes: 1, publishedAt: now, correction: null };
const share = { token: "a".repeat(64), createdAt: now, article: publicArticle };

test("member recipient fetch uses a verified snapshot and bearer credential, never private cookies", async () => {
  const fetched = await fetchDemandPublicShare(share.token, { apiUrl: "https://api.example.org/v1", production: true, accessToken: "synthetic-member-token", fetcher: (async (url, init) => {
    assert.equal(url, `https://api.example.org/v1/public/demand-shares/${share.token}`);
    assert.equal(init?.credentials, "omit"); assert.equal(init?.cache, "no-store");
    assert.equal(new Headers(init?.headers).get("authorization"), "Bearer synthetic-member-token"); assert.equal(init?.redirect, "error"); return Response.json(share);
  }) as typeof fetch });
  assert.deepEqual(fetched, share);
  const metadata = demandPublicShareMetadata(fetched!);
  assert.equal(metadata.openGraph.title, publicArticle.title);
  assert.equal(metadata.twitter.description, publicArticle.deck);
  assert.equal(metadata.alternates.canonical, `https://edisonreader.com/s/demand/${share.token}`);
  assert.equal(metadata.robots.index, false);
  assert.equal(metadata.referrer, "no-referrer");
});

test("public fetch refuses invalid tokens, unsafe targets, foreign identity and any leaked field", async () => {
  let calls = 0;
  const fetcher = (async () => { calls++; return Response.json(share); }) as typeof fetch;
  for (const apiUrl of ["http://remote.example/v1", "https://user:pass@api.example/v1", "https://api.example/private", "https://api.example/v1?url=other"]) {
    assert.equal(await fetchDemandPublicShare(share.token, { apiUrl, production: true, accessToken: "synthetic-member-token", fetcher }), null);
  }
  assert.equal(await fetchDemandPublicShare("bad", { apiUrl: "https://api.example/v1", fetcher }), null);
  assert.equal(calls, 0);
  await assert.rejects(() => fetchDemandPublicShare(share.token, { apiUrl: "https://api.example/v1", fetcher }), /Invited sign-in/);
  assert.equal(calls, 0);
  for (const invalid of [{ ...share, ownerId: id(1) }, { ...share, article: { ...publicArticle, whyWritten: "private" } }, { ...share, token: "b".repeat(64) }]) {
    await assert.rejects(() => fetchDemandPublicShare(share.token, { apiUrl: "https://api.example/v1", accessToken: "synthetic-member-token", fetcher: (async () => Response.json(invalid)) as typeof fetch }));
  }
});

test("archive prevents fresh work; exact article reads and conversation are independent of navigation and workspace limits", () => {
  assert.doesNotThrow(() => assertDemandLoopOpen({ archivedAt: null }));
  assert.throws(() => assertDemandLoopOpen({ archivedAt: new Date() }), /deleted/);
  const source = readFileSync(new URL("../apps/api/src/services/demand-conversation.ts", import.meta.url), "utf8");
  assert.match(source, /demand_principal_is_active/);
  assert.match(source, /eq\(demandRequests.principalId, principal.id\)/);
  assert.match(source, /snapshot.*articleVersion/);
  assert.match(source, /createdAt}::text/);
  assert.doesNotMatch(source, /reserveRequest|dispatchDemandRequest|demandWorkspace\(/);
});

test("exact owner article schema rejects mismatched article/request/idea identity", () => {
  const article = { id: id(6), slug: "synthetic", category: "tech-science", kicker: "Synthetic", topic: "Test", title: publicArticle.title,
    deck: publicArticle.deck, readingMinutes: 1, sourceCount: 0, researchedAt: null, basis: "general_knowledge", reason: "Private context",
    summary: ["One", "Two", "Three"], saved: false, completed: false, body: answer.body, sources: [], writtenFor: "Private reader", shareId: null };
  const request = { ...demandConversationTurn(row).request, id: id(6), kind: "article" };
  const idea = { id: id(3), loopId: id(2), batchRequestId: id(7), batchRevision: 0, rank: 1, title: article.title,
    deck: article.deck, articleRequestId: id(6), saved: false, createdAt: now };
  const loop = { id: id(2), title: "Synthetic", originalCuriosity: "Test", revision: 0, principles: [],
    lastMutationId: null, canUndo: false, createdAt: now, updatedAt: now };
  const result = { workspaceId: id(8), idea, request, article, loop };
  assert.equal(demandArticleResultSchema.safeParse(result).success, true);
  assert.equal(demandArticleResultSchema.safeParse({ ...result, article: { ...article, id: id(9) } }).success, false);
  assert.equal(demandArticleResultSchema.safeParse({ ...result, request: { ...request, status: "failed" } }).success, false);
});
