import { demandWorkspaceSchema, parseDemandHistoryQuery, parseDemandConversationQuery, parseDemandLoopsQuery } from "@edison/contracts";

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const routes: Record<string, RegExp[]> = {
  GET: [/^workspace$/, /^history$/, /^loops$/, /^invitations$/, new RegExp(`^loops/${UUID}$`), new RegExp(`^ideas/${UUID}$`), new RegExp(`^requests/${UUID}$`),
    new RegExp(`^articles/${UUID}(?:/conversation)?$`)],
  POST: [/^session$/, /^loops$/, /^allowance\/reset$/, /^invitations$/, new RegExp(`^invitations/${UUID}/(?:resend|revoke)$`), new RegExp(`^loops/${UUID}/(?:ideas|feedback|edit|archive)$`), new RegExp(`^articles/${UUID}/share$`),
    new RegExp(`^ideas/${UUID}/(?:article|questions)$`), new RegExp(`^requests/${UUID}/retry$`)],
  PUT: [new RegExp(`^ideas/${UUID}/events$`)],
};

export function isDemandProxyPath(method: string, path: string) {
  return Boolean(routes[method]?.some((pattern) => pattern.test(path)));
}

function fail(status: number, code: string, message: string) {
  return Response.json({ error: { code, message } }, { status, headers: { "Cache-Control": "no-store" } });
}

export async function proxyDemandRequest(request: Request, path: string, options: {
  apiUrl?: string; enabled: boolean; production: boolean; fetcher?: typeof fetch;
  // Server-only opt-in: the separately configured exact URL must match the
  // existing fixed API target. A caller cannot choose the recipient or token.
  trustedSource?: { apiUrl?: string; getToken: () => Promise<string> };
}) {
  if (!options.enabled) return fail(503, "on_demand_unavailable", "On-demand reading is not available yet.");
  if (!isDemandProxyPath(request.method, path)) return fail(404, "not_found", "That reading resource was not found.");
  const ownUrl = new URL(request.url);
  if (ownUrl.search) {
    const conversation = request.method === "GET" && new RegExp(`^articles/${UUID}/conversation$`).test(path);
    const loops = request.method === "GET" && path === "loops";
    if (path !== "history" && !conversation && !loops) return fail(400, "invalid_request", "Query parameters are not supported here.");
    try { if (conversation) parseDemandConversationQuery(ownUrl.searchParams); else if (loops) parseDemandLoopsQuery(ownUrl.searchParams); else parseDemandHistoryQuery(ownUrl.searchParams); }
    catch { return fail(400, "invalid_request", "That reading history request is not valid."); }
  }
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");
  if ((origin && origin !== ownUrl.origin) || (fetchSite && !["same-origin", "none"].includes(fetchSite)) ||
      (request.method !== "GET" && origin !== ownUrl.origin)) {
    return fail(403, "origin_not_allowed", "This request must come from Edison.");
  }
  let base: URL;
  try {
    base = new URL(options.apiUrl ?? "");
    const local = !options.production && ["localhost", "127.0.0.1"].includes(base.hostname);
    if (base.username || base.password || base.search || base.hash ||
        (base.protocol !== "https:" && !(local && base.protocol === "http:")) ||
        base.pathname.replace(/\/$/, "") !== "/v1") throw new Error("invalid_api");
  } catch { return fail(503, "api_not_configured", "The reading service is not connected yet."); }
  if (options.trustedSource && (!options.production ||
      !/^https:\/\/[a-z0-9]+(?:-[a-z0-9]+)*\.vercel\.app\/v1$/.test(options.trustedSource.apiUrl ?? "") ||
      options.trustedSource.apiUrl !== base.href.replace(/\/$/, ""))) {
    return fail(503, "protected_api_not_configured", "The protected reading service is not connected yet.");
  }
  const insecureLocal = !options.production && ownUrl.protocol === "http:" && ["localhost", "127.0.0.1"].includes(ownUrl.hostname);
  const cookieName = insecureLocal ? "edison_demand_dev" : "__Host-edison_demand";
  const guestCookie = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const token = guestCookie?.slice(cookieName.length + 1);
  const headers = new Headers({ "Content-Type": "application/json", Origin: ownUrl.origin });
  const authorization = request.headers.get("authorization");
  const hasBearer = Boolean(authorization && /^Bearer \S+$/i.test(authorization));
  if (authorization) headers.set("Authorization", authorization);
  let body: string | undefined;
  let parsedBody: unknown;
  if (request.method !== "GET") {
    const reader = request.body?.getReader();
    let bytes = 0;
    const decoder = new TextDecoder("utf-8", { fatal: true });
    body = "";
    try {
      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.byteLength;
        if (bytes > 8192) { await reader.cancel(); return fail(413, "request_too_large", "That request is too large."); }
        body += decoder.decode(value, { stream: true });
      }
      body += decoder.decode();
      if (body) parsedBody = JSON.parse(body);
    } catch { return fail(400, "invalid_json", "That request was not valid JSON."); }
  }
  let continueWithAccount = false;
  if (request.method === "POST" && path === "session" && body) {
    if (!parsedBody || typeof parsedBody !== "object" || Array.isArray(parsedBody)) {
      return fail(400, "invalid_request", "That session request is not valid.");
    }
    const keys = Object.keys(parsedBody);
    if (keys.length) {
      if (keys.length !== 1 || keys[0] !== "continueWithAccount" ||
          (parsedBody as { continueWithAccount?: unknown }).continueWithAccount !== true ||
          !/^\s*\{\s*"continueWithAccount"\s*:\s*true\s*\}\s*$/.test(body)) {
        return fail(400, "invalid_request", "That session request is not valid.");
      }
      if (!hasBearer) {
        return fail(401, "sign_in_required", "Sign in before continuing with your account.");
      }
      // This explicit browser action neither claims nor deletes guest history.
      // Membership and the account identity are still verified by the API.
      continueWithAccount = true;
      body = "{}";
    }
  }
  if (!continueWithAccount && token && !/^[a-f0-9]{64}$/.test(token)) {
    return fail(401, "guest_session_invalid", "This browser's reading session is not valid.");
  }
  if (!continueWithAccount && token) headers.set("X-Edison-Demand-Token", token);
  if (options.trustedSource) {
    try {
      // Obtain the short-lived workload identity only after validating the
      // browser's origin, fixed target, route, cookie and bounded request body.
      const identity = await options.trustedSource.getToken();
      if (typeof identity !== "string" || identity.length > 16_384 ||
          !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(identity)) throw new Error("missing_identity");
      // Signature/issuer/project/environment validation belongs to Vercel's
      // Trusted Sources gate. Do not relay a known-expired SDK token.
      const claims = JSON.parse(Buffer.from(identity.split(".")[1], "base64url").toString("utf8")) as { exp?: unknown };
      if (typeof claims.exp !== "number" || !Number.isSafeInteger(claims.exp) || claims.exp <= Math.floor(Date.now() / 1000)) throw new Error("expired_identity");
      headers.set("x-vercel-trusted-oidc-idp-token", identity);
      // This authenticated server-to-server leg is not a browser CORS request.
      // The exact incoming browser-origin check above remains mandatory.
      headers.delete("Origin");
    } catch {
      return fail(503, "protected_api_identity_unavailable", "The protected reading connection is unavailable. Please try again.");
    }
  }
  try {
    const response = await (options.fetcher ?? fetch)(`${base.href.replace(/\/$/, "")}/demand/${path}${ownUrl.search}`, {
      method: request.method, headers, body, cache: "no-store", redirect: "error", signal: AbortSignal.timeout(25_000),
    });
    // Never forward upstream cookies, arbitrary headers, or a raw guest token.
    const outputHeaders = new Headers({ "Cache-Control": "no-store", "Content-Type": "application/json", "X-Content-Type-Options": "nosniff" });
    if (path === "session" && response.ok) {
      const payload = await response.json() as { workspace?: unknown; newGuestToken?: unknown };
      const workspace = demandWorkspaceSchema.parse(payload.workspace);
      if (continueWithAccount && workspace.readerKind !== "account") throw new Error("invalid_session_response");
      if (payload.newGuestToken !== undefined) {
        if (workspace.readerKind !== "guest") throw new Error("invalid_session_response");
        if (typeof payload.newGuestToken !== "string" || !/^[a-f0-9]{64}$/.test(payload.newGuestToken)) throw new Error("invalid_session_response");
        outputHeaders.set("Set-Cookie", `${cookieName}=${payload.newGuestToken}; Path=/; HttpOnly; SameSite=Lax; Max-Age=7776000${insecureLocal ? "" : "; Secure"}`);
      } else if (workspace.readerKind === "account" && hasBearer && (token || (continueWithAccount && guestCookie !== undefined))) {
        // Only a confirmed account-session response can retire a transferred or
        // explicitly left-behind credential. Failed/unknown outcomes keep it.
        outputHeaders.set("Set-Cookie", `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${insecureLocal ? "" : "; Secure"}`);
      }
      return Response.json({ workspace }, { status: response.status, headers: outputHeaders });
    }
    return new Response(response.body, { status: response.status, headers: outputHeaders });
  } catch { return fail(502, "reading_service_unavailable", "The reading service did not respond. Your saved reading is safe; try again."); }
}
