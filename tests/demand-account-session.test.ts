import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { Script } from "node:vm";
import ts from "typescript";
import * as contracts from "@edison/contracts";

const workspace = contracts.demandWorkspaceSchema.parse({ workspaceId: "00000000-0000-4000-8000-000000000001",
  readerKind: "account", loops: [], ideas: [], requests: [] });
type Client = Pick<typeof import("../lib/demand-client"), "startDemandAccountSession" | "startDemandSession">;
function client(input: { token?: string | null; authError?: boolean; fetcher: typeof fetch }) {
  const exports: Record<string, unknown> = {};
  const source = readFileSync(new URL("../lib/demand-client.ts", import.meta.url), "utf8");
  const imports: Record<string, unknown> = {
    "@edison/contracts": contracts,
    "@/lib/supabase/env": { isSupabaseConfigured: () => true },
    "@/lib/supabase/client": { createClient: () => ({ auth: { getSession: async () => ({
      data: { session: input.token === null ? null : { access_token: input.token ?? "constructed-member" } },
      error: input.authError ? new Error("Constructed auth failure") : null,
    }) } }) },
    "@/lib/demand-auth-continuation": {},
  };
  new Script(ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText)
    .runInNewContext({ exports, Headers, Response, Request, Promise, JSON, Error, fetch: input.fetcher,
      require(name: string) { if (!(name in imports)) throw new Error(`Unstubbed dependency ${name}`); return imports[name]; } });
  return exports as Client;
}
const errorCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code;

test("account recovery sends only the explicit local intent and coalesces repeated clicks", async () => {
  let release!: (response: Response) => void;
  const waiting = new Promise<Response>((resolve) => { release = resolve; });
  let calls = 0;
  const app = client({ fetcher: (async (url, init) => {
    calls++; assert.equal(url, "/api/demand/session"); assert.equal(init?.method, "POST");
    assert.equal(init?.body, '{"continueWithAccount":true}'); assert.equal(init?.credentials, "same-origin"); assert.equal(init?.cache, "no-store");
    const headers = new Headers(init?.headers);
    assert.equal(headers.get("authorization"), "Bearer constructed-member"); assert.equal(headers.get("content-type"), "application/json");
    assert.equal(headers.get("cookie"), null); assert.equal(headers.get("x-edison-demand-token"), null);
    return waiting;
  }) as typeof fetch });
  const first = app.startDemandAccountSession(), same = app.startDemandAccountSession();
  assert.equal(first, same);
  await new Promise<void>((resolve) => setImmediate(resolve)); assert.equal(calls, 1);
  release(Response.json({ workspace })); assert.deepEqual(await first, workspace);
});

test("ordinary startup failure never triggers account recovery without a separate explicit call", async () => {
  const bodies: Array<BodyInit | null | undefined> = [];
  const app = client({ fetcher: (async (_url, init) => {
    bodies.push(init?.body);
    return init?.body ? Response.json({ workspace }) : Response.json({ error: { code: "guest_already_claimed", message: "Keep the guest history." } }, { status: 409 });
  }) as typeof fetch });
  await assert.rejects(app.startDemandSession(), errorCode("guest_already_claimed"));
  assert.deepEqual(bodies, [undefined]);
  assert.deepEqual(await app.startDemandAccountSession(), workspace);
  assert.deepEqual(bodies, [undefined, '{"continueWithAccount":true}']);
});

test("missing or uncertain sign-in never manufactures account authorization", async () => {
  let calls = 0;
  const unsigned = client({ token: null, fetcher: (async (_url, init) => {
    calls++; assert.equal(new Headers(init?.headers).get("authorization"), null);
    return Response.json({ error: { code: "sign_in_required", message: "Sign in first." } }, { status: 401 });
  }) as typeof fetch });
  await assert.rejects(unsigned.startDemandAccountSession(), errorCode("sign_in_required"));
  const uncertain = client({ authError: true, fetcher: (async () => { calls++; throw new Error("Must not run"); }) as typeof fetch });
  await assert.rejects(uncertain.startDemandAccountSession(), errorCode("session_unavailable"));
  assert.equal(calls, 1);
});

test("failed or invalid account recovery remains explicitly retryable and never accepts a guest workspace", async () => {
  for (const failure of [
    () => { throw new Error("Constructed lost response"); },
    () => Response.json({ workspace: { ...workspace, readerKind: "guest" } }),
    () => Response.json({ workspace: { readerKind: "account", workspaceId: "invalid" } }),
    () => Response.json({ error: { code: "invite_required", message: "Invitation required." } }, { status: 403 }),
  ]) {
    let calls = 0;
    const app = client({ fetcher: (async () => { calls++; return calls === 1 ? failure() : Response.json({ workspace }); }) as typeof fetch });
    await assert.rejects(app.startDemandAccountSession()); assert.equal(calls, 1);
    assert.deepEqual(await app.startDemandAccountSession(), workspace); assert.equal(calls, 2);
  }
});
