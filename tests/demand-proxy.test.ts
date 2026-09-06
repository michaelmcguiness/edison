import test from "node:test";
import assert from "node:assert/strict";
import { isDemandProxyPath, proxyDemandRequest } from "../lib/demand-proxy";

const options = { apiUrl: "https://api.example.org/v1", enabled: true, production: true };
test("demand relay permits only bounded reading routes", () => {
  assert.equal(isDemandProxyPath("POST", "session"), true);
  for (const path of ["../admin/jobs", "https://evil.example", "loops/../session", "private/profile", "session?url=evil"]) {
    assert.equal(isDemandProxyPath("POST", path), false);
  }
});

test("cross-origin and missing-origin mutations never reach the API", async () => {
  let calls = 0;
  const fetcher = (async () => { calls += 1; return Response.json({}); }) as typeof fetch;
  for (const origin of [undefined, "https://evil.example"]) {
    const response = await proxyDemandRequest(new Request("https://edisonreader.com/api/demand/session", {
      method: "POST", headers: origin ? { Origin: origin } : {},
    }), "session", { ...options, fetcher });
    assert.equal(response.status, 403);
  }
  assert.equal(calls, 0);
});

test("new opaque token is only an HttpOnly host cookie, never response JSON", async () => {
  const token = "a".repeat(64);
  const workspace = { workspaceId: "00000000-0000-4000-8000-000000000001", readerKind: "guest", loops: [], ideas: [], requests: [] };
  const response = await proxyDemandRequest(new Request("https://edisonreader.com/api/demand/session", {
    method: "POST", headers: { Origin: "https://edisonreader.com", Cookie: "unrelated=private; __Host-edison_demand=" + "b".repeat(64) },
  }), "session", { ...options, fetcher: (async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("cookie"), null);
    assert.equal(headers.get("x-edison-demand-token"), "b".repeat(64));
    return Response.json({ workspace, newGuestToken: token });
  }) as typeof fetch });
  assert.deepEqual(await response.json(), { workspace });
  assert.match(response.headers.get("set-cookie")!, /^__Host-edison_demand=[a-f0-9]{64}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=7776000; Secure$/);
});

test("relay refuses insecure remote upstream and arbitrary upstream credentials", async () => {
  const request = new Request("https://edisonreader.com/api/demand/workspace");
  for (const apiUrl of ["http://api.example.org/v1", "https://user:secret@api.example.org/v1", "https://api.example.org/internal"]) {
    assert.equal((await proxyDemandRequest(request, "workspace", { ...options, apiUrl })).status, 503);
  }
});

test("history relay forwards only validated bounded query keys to the fixed API", async () => {
  const loopId = "00000000-0000-4000-8000-000000000002";
  let calls = 0;
  const fetcher = (async (url, init) => {
    calls++;
    assert.equal(url, `https://api.example.org/v1/demand/history?scope=saved&loopId=${loopId}&cursor=YWJj`);
    assert.equal(init?.method, "GET");
    assert.equal(init?.cache, "no-store");
    return Response.json({ workspaceId: loopId, ideas: [], requests: [], nextCursor: null });
  }) as typeof fetch;
  const valid = await proxyDemandRequest(new Request(`https://edisonreader.com/api/demand/history?scope=saved&loopId=${loopId}&cursor=YWJj`), "history", { ...options, fetcher });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get("cache-control"), "no-store");
  for (const query of ["url=https://evil.example", "limit=10000", "scope=saved&scope=all", "loopId=bad", "__proto__=ignored"]) {
    assert.equal((await proxyDemandRequest(new Request(`https://edisonreader.com/api/demand/history?${query}`), "history", { ...options, fetcher })).status, 400);
  }
  assert.equal((await proxyDemandRequest(new Request("https://edisonreader.com/api/demand/workspace?scope=saved"), "workspace", { ...options, fetcher })).status, 400);
  assert.equal(calls, 1);
});

test("exact idea recovery stays on a GET-only fixed route", () => {
  const path = "ideas/00000000-0000-4000-8000-000000000001";
  assert.equal(isDemandProxyPath("GET", path), true);
  assert.equal(isDemandProxyPath("POST", path), false);
  assert.equal(isDemandProxyPath("GET", "history"), true);
  assert.equal(isDemandProxyPath("POST", "history"), false);
});
