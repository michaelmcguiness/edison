import test from "node:test";
import assert from "node:assert/strict";
import { isDemandProxyPath, proxyDemandRequest } from "../lib/demand-proxy";
import { GET as routeGet } from "../app/api/demand/[...path]/route";

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

const protectedApiUrl = "https://edison-api-candidate123-team.vercel.app/v1";
function workloadToken(exp = Math.floor(Date.now() / 1000) + 3600) {
  return `${Buffer.from(JSON.stringify({ alg: "RS256" })).toString("base64url")}.${Buffer.from(JSON.stringify({ exp })).toString("base64url")}.test-signature`;
}
function readerRequest(headers: Record<string, string> = {}, body?: string) {
  return new Request("https://edison-app-candidate123-team.vercel.app/api/demand/loops", {
    method: "POST", headers: { Origin: "https://edison-app-candidate123-team.vercel.app", "Sec-Fetch-Site": "same-origin", ...headers },
    body: body ?? JSON.stringify({ curiosity: "Synthetic Biology", idempotencyKey: "unit-test:loop" }),
  });
}

test("normal relay preserves its real upstream Origin and never forwards client protection identities", async () => {
  const response = await proxyDemandRequest(readerRequest({
    "X-Vercel-Trusted-Oidc-Idp-Token": "client-trusted-token",
    "X-Vercel-Oidc-Token": "client-workload-token",
    "X-Vercel-Protection-Bypass": "client-bypass",
  }), "loops", { ...options, fetcher: (async (_url, init) => {
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("origin"), "https://edison-app-candidate123-team.vercel.app");
    for (const name of ["x-vercel-trusted-oidc-idp-token", "x-vercel-oidc-token", "x-vercel-protection-bypass"]) assert.equal(headers.get(name), null);
    return Response.json({ normal: true });
  }) as typeof fetch });
  assert.equal(response.status, 200);
});

test("trusted relay uses only the fresh server identity, omits upstream Origin and preserves reader authorization", async () => {
  const serverIdentity = workloadToken(); let tokenCalls = 0; let fetchCalls = 0;
  const request = readerRequest({
    Authorization: "Bearer test-reader-access", Cookie: `__Host-edison_demand=${"b".repeat(64)}; unrelated=private`,
    "X-Vercel-Trusted-Oidc-Idp-Token": "client-trusted-token", "X-Vercel-Oidc-Token": "client-workload-token",
    "X-Vercel-Protection-Bypass": "client-bypass", "X-Edison-Demand-Token": "client-forged-reader",
  });
  const response = await proxyDemandRequest(request, "loops", { ...options, apiUrl: protectedApiUrl,
    trustedSource: { apiUrl: protectedApiUrl, getToken: async () => { tokenCalls++; return serverIdentity; } },
    fetcher: (async (url, init) => {
      fetchCalls++;
      assert.equal(url, `${protectedApiUrl}/demand/loops`);
      const headers = new Headers(init?.headers);
      assert.equal(headers.get("origin"), null);
      assert.equal(headers.get("x-vercel-trusted-oidc-idp-token"), serverIdentity);
      assert.equal(headers.get("authorization"), "Bearer test-reader-access");
      assert.equal(headers.get("x-edison-demand-token"), "b".repeat(64));
      for (const name of ["cookie", "x-vercel-oidc-token", "x-vercel-protection-bypass"]) assert.equal(headers.get(name), null);
      assert.equal(init?.redirect, "error"); assert.equal(init?.cache, "no-store");
      assert.equal(init?.body, JSON.stringify({ curiosity: "Synthetic Biology", idempotencyKey: "unit-test:loop" }));
      return Response.json({ accepted: true }, { headers: { "X-Vercel-Trusted-Oidc-Idp-Token": serverIdentity, "Set-Cookie": "upstream=secret", "X-Debug": "private" } });
    }) as typeof fetch,
  });
  assert.equal(tokenCalls, 1); assert.equal(fetchCalls, 1);
  for (const name of ["x-vercel-trusted-oidc-idp-token", "set-cookie", "x-debug"]) assert.equal(response.headers.get(name), null);
  assert.deepEqual(await response.json(), { accepted: true });
});

test("trusted mode fails closed before identity lookup for a missing, changed or non-Vercel upstream pin", async () => {
  let calls = 0;
  const forbidden = async () => { calls++; throw new Error("must not run"); };
  for (const [apiUrl, pin, production] of [
    [protectedApiUrl, undefined, true], [protectedApiUrl, "https://other-candidate.vercel.app/v1", true],
    ["https://evil.example/v1", "https://evil.example/v1", true],
    ["https://edison-api-candidate123-team.vercel.app.evil.example/v1", "https://edison-api-candidate123-team.vercel.app.evil.example/v1", true],
    [protectedApiUrl, `${protectedApiUrl}?target=evil`, true], [protectedApiUrl, `${protectedApiUrl}/`, true],
    [protectedApiUrl, protectedApiUrl, false],
  ] as const) {
    const response = await proxyDemandRequest(readerRequest(), "loops", { ...options, apiUrl, production,
      trustedSource: { apiUrl: pin, getToken: forbidden }, fetcher: forbidden as typeof fetch });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "protected_api_not_configured");
  }
  assert.equal(calls, 0);
});

test("missing, malformed, expired or throwing server identities never reach the protected API or leak errors", async () => {
  let fetchCalls = 0;
  for (const identity of [undefined, "", "static-secret", "not-json.invalid.signature", "a".repeat(16_385), workloadToken(1), workloadToken() + "\r\nInjected: secret"]) {
    const response = await proxyDemandRequest(readerRequest({ "X-Vercel-Trusted-Oidc-Idp-Token": workloadToken() }), "loops", {
      ...options, apiUrl: protectedApiUrl, trustedSource: { apiUrl: protectedApiUrl, getToken: async () => identity as string },
      fetcher: (async () => { fetchCalls++; return Response.json({}); }) as typeof fetch,
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error.code, "protected_api_identity_unavailable");
  }
  const response = await proxyDemandRequest(readerRequest(), "loops", { ...options, apiUrl: protectedApiUrl,
    trustedSource: { apiUrl: protectedApiUrl, getToken: async () => { throw new Error("secret SDK context and credential details"); } },
    fetcher: (async () => { fetchCalls++; return Response.json({}); }) as typeof fetch,
  });
  assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|SDK|credential details/);
  assert.equal(fetchCalls, 0);
});

test("trusted mode still rejects cross-site requests, malformed cookies and oversized/invalid bodies before token lookup", async () => {
  let calls = 0;
  const forbidden = async () => { calls++; throw new Error("must not run"); };
  for (const [request, expected] of [
    [readerRequest({ Origin: "https://evil.example" }),403],
    [new Request("https://edisonreader.com/api/demand/loops", { method: "POST" }),403],
    [readerRequest({ "Sec-Fetch-Site": "cross-site" }),403],
    [readerRequest({ Cookie: "__Host-edison_demand=invalid" }),401],
    [readerRequest({}, JSON.stringify({ curiosity: "a".repeat(8192) })),413],
    [readerRequest({}, "not JSON"),400],
  ] as const) {
    const response = await proxyDemandRequest(request, "loops", { ...options, apiUrl: protectedApiUrl,
      trustedSource: { apiUrl: protectedApiUrl, getToken: forbidden }, fetcher: forbidden as typeof fetch });
    assert.equal(response.status, expected);
  }
  assert.equal(calls,0);
});

test("the real route defaults to ordinary forwarding and an opt-in cannot use local or client identity", async () => {
  const names = ["EDISON_ON_DEMAND_ENABLED", "EDISON_DEMAND_TRUSTED_SOURCE_ENABLED", "EDISON_DEMAND_PROTECTED_API_URL", "NEXT_PUBLIC_API_URL", "NODE_ENV", "VERCEL"] as const;
  const previous = new Map(names.map((name) => [name,process.env[name]]));
  const originalFetch = globalThis.fetch; let calls = 0;
  try {
    process.env.EDISON_ON_DEMAND_ENABLED = "true"; Object.assign(process.env, { NODE_ENV: "production" });
    process.env.NEXT_PUBLIC_API_URL = protectedApiUrl;
    process.env.EDISON_DEMAND_PROTECTED_API_URL = protectedApiUrl;
    delete process.env.EDISON_DEMAND_TRUSTED_SOURCE_ENABLED; delete process.env.VERCEL;
    globalThis.fetch = (async (_url, init) => {
      calls++;
      assert.equal(new Headers(init?.headers).get("origin"), "https://edisonreader.com");
      assert.equal(new Headers(init?.headers).get("x-vercel-trusted-oidc-idp-token"), null);
      return Response.json({ ordinary: true });
    }) as typeof fetch;
    const context = { params: Promise.resolve({ path: ["workspace"] }) };
    assert.equal((await routeGet(new Request("https://edisonreader.com/api/demand/workspace"),context)).status,200);
    process.env.EDISON_DEMAND_TRUSTED_SOURCE_ENABLED = "true";
    const denied = await routeGet(new Request("https://edisonreader.com/api/demand/workspace", { headers: { "X-Vercel-Oidc-Token": workloadToken() } }), context);
    assert.equal(denied.status,503);
    assert.equal((await denied.json()).error.code,"protected_api_identity_unavailable");
    assert.equal(calls,1);
  } finally {
    globalThis.fetch = originalFetch;
    for (const [name,value] of previous) { if (value === undefined) delete process.env[name]; else Object.assign(process.env, { [name]: value }); }
  }
});

test("the real trusted route reads only current SDK request context without refreshing missing or expired identity", async () => {
  const names = ["EDISON_ON_DEMAND_ENABLED", "EDISON_DEMAND_TRUSTED_SOURCE_ENABLED", "EDISON_DEMAND_PROTECTED_API_URL", "NEXT_PUBLIC_API_URL", "NODE_ENV", "VERCEL", "VERCEL_OIDC_TOKEN"] as const;
  const previous = new Map(names.map((name) => [name, process.env[name]]));
  const contextKey = Symbol.for("@vercel/request-context");
  const runtime = globalThis as typeof globalThis & { [key: symbol]: unknown };
  const previousContext = Object.getOwnPropertyDescriptor(runtime, contextKey);
  const originalFetch = globalThis.fetch; let calls = 0;
  const serverIdentity = workloadToken();
  let contextIdentity: string | undefined;
  try {
    Object.assign(process.env, {
      EDISON_ON_DEMAND_ENABLED: "true", EDISON_DEMAND_TRUSTED_SOURCE_ENABLED: "true",
      EDISON_DEMAND_PROTECTED_API_URL: protectedApiUrl, NEXT_PUBLIC_API_URL: protectedApiUrl,
      NODE_ENV: "production", VERCEL: "1", VERCEL_OIDC_TOKEN: workloadToken(),
    });
    Object.defineProperty(runtime, contextKey, { configurable: true, value: { get: () => ({
      headers: contextIdentity ? { "x-vercel-oidc-token": contextIdentity } : {},
    }) } });
    globalThis.fetch = (async (url, init) => {
      calls++;
      assert.equal(url, `${protectedApiUrl}/demand/workspace`);
      assert.equal(new Headers(init?.headers).get("origin"), null);
      assert.equal(new Headers(init?.headers).get("x-vercel-trusted-oidc-idp-token"), serverIdentity);
      return Response.json({ trusted: true });
    }) as typeof fetch;
    const request = () => new Request("https://edisonreader.com/api/demand/workspace", { headers: {
      "X-Vercel-Oidc-Token": workloadToken(), "X-Vercel-Trusted-Oidc-Idp-Token": workloadToken(),
    } });
    const context = { params: Promise.resolve({ path: ["workspace"] }) };
    for (const identity of [undefined, workloadToken(1)]) {
      contextIdentity = identity;
      const denied = await routeGet(request(), context);
      assert.equal(denied.status, 503);
      assert.equal((await denied.json()).error.code, "protected_api_identity_unavailable");
      assert.equal(calls, 0, "missing/expired context does not invoke refresh or upstream network requests");
    }
    contextIdentity = serverIdentity;
    const accepted = await routeGet(request(), context);
    assert.equal(accepted.status, 200);
    assert.deepEqual(await accepted.json(), { trusted: true });
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
    if (previousContext) Object.defineProperty(runtime, contextKey, previousContext); else delete runtime[contextKey];
    for (const [name, value] of previous) { if (value === undefined) delete process.env[name]; else Object.assign(process.env, { [name]: value }); }
  }
});
