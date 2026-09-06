import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { OnDemandProvider, OnDemandProviderRequest, OnDemandProviderResponse } from "../packages/ai/src/on-demand";

// No URL, linked-project, credential or provider option. This is the standard
// disposable Supabase container only, never the application's saved environment.
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DOCKER_SOCKET = "unix:///var/run/docker.sock";
const CONTAINER = "supabase_db_edison-reader";
const environment = { OPENAI_ARTICLE_MODEL: "gpt-5.6-terra", OPENAI_UTILITY_MODEL: "gpt-5.6-luna", OPENAI_WEB_SEARCH_COST_MICROUSD: "10000" };

function assertLocalEnvironment(values: Readonly<Record<string, string | undefined>>) {
  // Inspect names, not secret values. Even a local inherited override is refused.
  if (Object.keys(values).some((name) => /^(?:PG|POSTGRES|SUPABASE_|OPENAI_|DOCKER_|DATABASE_URL$|DIRECT_URL$)/.test(name))) {
    throw new Error("Disposable demand check refuses inherited database, provider or Docker configuration");
  }
  if (values.NODE_ENV === "production" || Object.hasOwn(values, "VERCEL")) {
    throw new Error("Disposable demand check cannot run in a production environment");
  }
}

function assertLocalContainer() {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const databaseSection = config.split(/^\[db\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  if (!/^project_id\s*=\s*"edison-reader"\s*$/m.test(config) || !/^port\s*=\s*54322\s*$/m.test(databaseSection)) {
    throw new Error("Disposable demand check requires the existing edison-reader local database configuration");
  }
  // Read only running state and port bindings; never inspect container env/secrets.
  const metadata = JSON.parse(execFileSync("docker", ["--host", DOCKER_SOCKET, "container", "inspect", CONTAINER,
    "--format", '{"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}'],
  { encoding: "utf8", timeout: 10000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] })) as {
    running?: boolean; ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
  if (metadata.running !== true || !metadata.ports?.["5432/tcp"]?.some((binding) =>
    binding.HostPort === "54322" && ["0.0.0.0", "127.0.0.1", "::"].includes(binding.HostIp))) {
    throw new Error("The named disposable Supabase container does not own the expected local database port");
  }
}

function safetyChecks() {
  assert.doesNotThrow(() => assertLocalEnvironment({ CI: "true", NODE_ENV: "test" }));
  for (const name of ["DATABASE_URL", "DIRECT_URL", "PGHOST", "PGPASSWORD", "PGSERVICEFILE", "SUPABASE_ACCESS_TOKEN", "OPENAI_API_KEY", "DOCKER_HOST", "DOCKER_CONTEXT"]) {
    assert.throws(() => assertLocalEnvironment({ [name]: "forbidden-constructed-override" }));
  }
  assert.throws(() => assertLocalEnvironment({ DATABASE_URL: LOCAL_DATABASE_URL }));
  assert.throws(() => assertLocalEnvironment({ NODE_ENV: "production" }));
  assert.throws(() => assertLocalEnvironment({ VERCEL: "1" }));
  assert.equal(new URL(LOCAL_DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(LOCAL_DATABASE_URL).port, "54322");
  console.log("Disposable demand check: local-only safety guards passed; no database or provider imported or contacted.");
}

async function integrationChecks() {
  assertLocalEnvironment(process.env);
  assertLocalContainer();
  Object.assign(process.env, { DATABASE_URL: LOCAL_DATABASE_URL, NODE_ENV: "test" });
  // Dynamic imports occur only AFTER the local-only gates and forced URL.
  const { getDb, demandPrincipals, demandLoops, demandRequests, demandStages, demandUsage } = await import("../packages/db/src/index");
  const { durableDemandProvider } = await import("../apps/api/src/services/demand-provider-stages");
  const { ProviderResponseValidationError } = await import("../packages/ai/src/provider-response-error");
  const { HttpError } = await import("../apps/api/src/http/errors");
  const database = getDb();
  const [server] = await database.execute<{ database: string; version: string }>(sql`select current_database() as database, current_setting('server_version_num') as version`);
  assert.equal(server.database, "postgres");
  assert.equal(Math.floor(Number(server.version) / 10000), 17);
  const principalIds: string[] = [];
  const runId = randomUUID();
  let providerCalls = 0;
  type Fixture = { principalId: string; loopId: string; requestId: string; context: { loopId: string; revision: number } };

  async function principal() {
    const id = randomUUID();
    await database.insert(demandPrincipals).values({ id, guestTokenHash: createHash("sha256").update(`${runId}:${id}`).digest("hex"), expiresAt: new Date(Date.now() + 3600000) });
    principalIds.push(id);
    return id;
  }
  async function fixture(principalId: string): Promise<Fixture> {
    const loopId = randomUUID(); const requestId = randomUUID(); const context = { loopId, revision: 0 };
    await database.insert(demandLoops).values({ id: loopId, principalId, title: "Disposable provider gate", originalCuriosity: "How does this constructed example work?" });
    await database.insert(demandRequests).values({ id: requestId, principalId, loopId, kind: "question", status: "running", stage: "answering",
      idempotencyKey: `local-db:${requestId}`, requestFingerprint: createHash("sha256").update(requestId).digest("hex"),
      snapshot: { version: 2, context }, reservedMicrousd: 250000, leaseExpiresAt: new Date(Date.now() + 900000) });
    return { principalId, loopId, requestId, context };
  }
  function stage(item: Fixture, name: "answer" | "check" | "repair", key: string = name, mode: "auto" | "required" | "none" = name === "check" ? "none" : "auto"): OnDemandProviderRequest {
    return { stage: name, promptVersion: "disposable-v2-transaction-gate", instructions: "Constructed local integration fixture only.",
      input: { context: item.context }, schema: z.object({ text: z.string() }), model: "gpt-5.6-luna",
      idempotencyKey: `local-db:${key}`, safetyIdentifier: item.principalId, timeoutMs: 10000, maxOutputTokens: 1000,
      research: mode !== "none", researchPolicy: { mode, reason: "Constructed local allowance check", maxCalls: mode === "none" ? 0 : 8 } };
  }
  function observed(toolCalls: number, searches: number, pricing: "priced" | "unpriced" = "priced"): OnDemandProviderResponse {
    return { output: { text: "Constructed response; not reader content." },
      usage: { providerResponseId: `resp-local-${randomUUID()}`, model: "gpt-5.6-luna", inputTokens: 100, cachedInputTokens: 10, outputTokens: 100,
        webSearchCalls: searches, webSearchToolCalls: toolCalls, webSearchPricingStatus: pricing },
      researchedUrls: searches ? ["https://example.org/constructed"] : [],
      researchProvenance: { consultedUrls: searches ? ["https://example.org/constructed"] : [], openedUrls: [], citedUrls: [] } };
  }
  function provider(item: Fixture, stub: OnDemandProvider) {
    return durableDemandProvider(item.requestId, item.principalId, { environment, provider: async (request) => {
      providerCalls++; return stub(request);
    } });
  }
  const code = (expected: string) => (error: unknown) => error instanceof HttpError && error.code === expected;
  async function records(item: Fixture) {
    return {
      stages: await database.select().from(demandStages).where(and(eq(demandStages.principalId, item.principalId), eq(demandStages.requestId, item.requestId))).orderBy(demandStages.createdAt, demandStages.id),
      usage: await database.select().from(demandUsage).where(and(eq(demandUsage.principalId, item.principalId), eq(demandUsage.requestId, item.requestId))).orderBy(demandUsage.createdAt, demandUsage.id),
    };
  }

  try {
    const firstPrincipal = await principal(); const secondPrincipal = await principal();
    const first = await fixture(firstPrincipal);
    const received: Array<Pick<OnDemandProviderRequest, "idempotencyKey" | "researchPolicy">> = [];
    const paid = provider(first, async (request) => {
      received.push(structuredClone({ idempotencyKey: request.idempotencyKey, researchPolicy: request.researchPolicy }));
      return request.stage === "answer" ? observed(6, 2) : request.stage === "repair" ? observed(2, 1) : observed(0, 0);
    });
    const answer = await paid(stage(first, "answer"));
    await paid(stage(first, "check", "initial-check"));
    await paid(stage(first, "repair"));
    await paid(stage(first, "check", "final-check"));
    assert.deepEqual(received.map((request) => request.researchPolicy?.maxCalls), [8, 0, 2, 0]);
    const beforeReplay = await records(first);
    assert.equal(beforeReplay.stages.length, 4);
    assert.equal(beforeReplay.usage.length, 4);
    assert.equal(beforeReplay.usage.reduce((sum, usage) => sum + usage.searchCalls, 0), 3);
    // Luna fixture tokens cost 138 microdollars per response; only 3 searches cost 30000.
    assert.equal(beforeReplay.usage.reduce((sum, usage) => sum + usage.costMicrousd!, 0), 30552);
    assert.deepEqual(beforeReplay.stages.map((row) => row.snapshot.researchCallsBefore), [0, 6, 6, 8]);
    const repair = beforeReplay.stages.find((row) => row.snapshot.stage === "repair")!;
    assert.equal((repair.snapshot.researchPolicy as { maxCalls: number }).maxCalls, 2);
    assert.equal(repair.snapshot.requestedResearchMaxCalls, 8);
    assert.deepEqual(await paid(stage(first, "answer")), answer);
    assert.deepEqual(await records(first), beforeReplay);
    assert.equal(received.length, 4);
    await assert.rejects(paid(stage(first, "check", "fifth-stage")), code("provider_stage_limit"));
    const [reservation] = await database.select().from(demandRequests).where(eq(demandRequests.id, first.requestId));
    assert.equal(reservation.reservedMicrousd, 250000);

    // Request ownership and frozen loop context are checked before replay/calls.
    const callsBeforeIsolation = providerCalls;
    await assert.rejects(provider({ ...first, principalId: secondPrincipal }, async () => observed(0, 0))(stage(first, "answer")), code("provider_request_not_found"));
    await assert.rejects(paid({ ...stage(first, "answer"), input: { context: { ...first.context, loopId: randomUUID() } } }), code("provider_snapshot_mismatch"));
    assert.equal(providerCalls, callsBeforeIsolation);
    for (const owner of [firstPrincipal, secondPrincipal]) {
      const independent = await fixture(owner);
      await provider(independent, async (request) => {
        assert.equal(request.researchPolicy?.maxCalls, 8);
        assert.notEqual(request.idempotencyKey, received[0].idempotencyKey);
        return observed(1, 1);
      })(stage(independent, "answer"));
      assert.equal((await records(independent)).usage.length, 1);
    }

    // Mandatory research has no new allowance after the request spent all 8.
    const exhausted = await fixture(firstPrincipal);
    const full = provider(exhausted, async () => observed(8, 2));
    await full(stage(exhausted, "answer"));
    const callsBeforeExhaustion = providerCalls;
    await assert.rejects(full(stage(exhausted, "repair", "required-repair", "required")), code("provider_search_budget_exhausted"));
    assert.equal(providerCalls, callsBeforeExhaustion);
    assert.equal((await records(exhausted)).stages.length, 1);

    // A provider overrun is retained at its actual cost, then withheld.
    const overrun = await fixture(firstPrincipal);
    const excessive = provider(overrun, async (request) => {
      if (request.stage === "repair") assert.equal(request.researchPolicy?.maxCalls, 2);
      return request.stage === "answer" ? observed(6, 2) : observed(3, 1);
    });
    await excessive(stage(overrun, "answer"));
    await assert.rejects(excessive(stage(overrun, "repair")), code("provider_invalid"));
    const overrunRows = await records(overrun);
    assert.equal(overrunRows.stages[1].status, "failed");
    assert.equal(overrunRows.stages[1].output, null);
    assert.equal(overrunRows.stages[1].usage?.webSearchToolCalls, 3);
    assert.equal(overrunRows.usage.reduce((sum, usage) => sum + usage.costMicrousd!, 0), 30276);
    const callsBeforeOverrunReplay = providerCalls;
    await assert.rejects(excessive(stage(overrun, "repair")), code("provider_invalid"));
    assert.equal(providerCalls, callsBeforeOverrunReplay);

    // Unknown action metadata preserves observed tokens/counts as UNPRICED.
    const unknown = await fixture(firstPrincipal);
    const unpriced = provider(unknown, async () => { throw new ProviderResponseValidationError("Constructed unknown action", observed(2, 1, "unpriced").usage); });
    await assert.rejects(unpriced(stage(unknown, "answer")), ProviderResponseValidationError);
    const unknownRows = await records(unknown);
    assert.equal(unknownRows.usage.length, 1);
    assert.equal(unknownRows.usage[0].pricingStatus, "unpriced");
    assert.equal(unknownRows.usage[0].costMicrousd, null);
    assert.equal(unknownRows.usage[0].searchCalls, 1);
    assert.equal(unknownRows.stages[0].usage?.webSearchToolCalls, 2);
    assert.equal(unknownRows.stages[0].status, "failed");
    const callsBeforeUnknownReplay = providerCalls;
    await assert.rejects(unpriced(stage(unknown, "answer")), code("provider_invalid"));
    assert.equal(providerCalls, callsBeforeUnknownReplay);

    // Revocation while the stub is running withholds content but keeps its charge.
    const revoked = await fixture(secondPrincipal);
    await assert.rejects(provider(revoked, async () => {
      await database.update(demandPrincipals).set({ revokedAt: new Date() }).where(eq(demandPrincipals.id, secondPrincipal));
      return observed(1, 1);
    })(stage(revoked, "answer")), code("provider_invalid"));
    const revokedRows = await records(revoked);
    assert.equal(revokedRows.usage[0].costMicrousd, 10138);
    assert.equal(revokedRows.stages[0].status, "failed");
    assert.equal(revokedRows.stages[0].output, null);
    const callsBeforeRevokedReplay = providerCalls;
    await assert.rejects(provider(revoked, async () => observed(0, 0))(stage(revoked, "answer")), code("reading_session_expired"));
    assert.equal(providerCalls, callsBeforeRevokedReplay);
    console.log("Disposable database: real v2 stage transactions enforced 8 total tool actions, billable searches, stable replay, stage/ownership limits, overrun and unpriced settlement, and charge retention after revocation. All provider responses were local stubs.");
  } finally {
    // Only this run's randomly generated principals; FK cascades remove their
    // constructed loops/requests/stages/usage. No existing fixture is touched.
    if (principalIds.length) await database.delete(demandPrincipals).where(inArray(demandPrincipals.id, principalIds));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--check-safety") { safetyChecks(); return; }
  if (args.length) throw new Error("Only --check-safety is accepted; database and provider overrides are forbidden");
  await integrationChecks();
}

await main();
