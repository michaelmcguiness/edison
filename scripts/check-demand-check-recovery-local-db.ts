import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import type { OnDemandProvider, OnDemandProviderResponse } from "../packages/ai/src/on-demand";
import type { ReaderFirstPipelineState } from "../apps/api/src/services/reader-first-pipeline";

// No saved credentials, linked project, user-supplied URL or provider fallback.
// This script and each race worker use ONLY the named disposable local database.
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DOCKER_SOCKET = "unix:///var/run/docker.sock";
const CONTAINER = "supabase_db_edison-reader";
const settings = {
  OPENAI_ARTICLE_MODEL: "gpt-5.6-terra", OPENAI_UTILITY_MODEL: "gpt-5.6-luna",
  OPENAI_WEB_SEARCH_COST_MICROUSD: "10000", OPENAI_MAX_DAILY_GENERATIONS: "8",
  EDISON_DEMAND_DAILY_MICROUSD: "10000000", EDISON_DEMAND_MONTHLY_MICROUSD: "50000000",
  EDISON_ON_DEMAND_ENABLED: "true",
};
const workerSchema = z.object({
  runId: z.string().uuid(), principalId: z.string().uuid(), requestId: z.string().uuid(),
  kind: z.enum(["retry", "fresh"]), daily: z.number().int().min(1).max(10_000_000),
  monthly: z.number().int().min(1).max(50_000_000),
}).strict();
type WorkerInput = z.infer<typeof workerSchema>;
type WorkerResult = { ok: boolean; outcome?: string; code?: string; pid: number };

function assertLocalEnvironment(values: Readonly<Record<string, string | undefined>>) {
  if (Object.keys(values).some((name) => /^(?:PG|POSTGRES|SUPABASE_|OPENAI_|EDISON_|DOCKER_|DATABASE_URL$|DIRECT_URL$)/.test(name))) {
    throw new Error("Disposable recovery check refuses inherited database, provider or Docker configuration");
  }
  if (values.NODE_ENV === "production" || Object.hasOwn(values, "VERCEL")) throw new Error("Production execution is forbidden");
}
function assertLocalContainer() {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const section = config.split(/^\[db\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  if (!/^project_id\s*=\s*"edison-reader"\s*$/m.test(config) || !/^port\s*=\s*54322\s*$/m.test(section)) throw new Error("Unexpected disposable database configuration");
  const info = JSON.parse(execFileSync("docker", ["--host", DOCKER_SOCKET, "container", "inspect", CONTAINER,
    "--format", '{"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}'],
  { encoding: "utf8", timeout: 10000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] })) as {
    running?: boolean; ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
  if (info.running !== true || !info.ports?.["5432/tcp"]?.some((port) => port.HostPort === "54322" && ["0.0.0.0", "127.0.0.1", "::"].includes(port.HostIp))) {
    throw new Error("Named disposable container does not own the expected loopback database port");
  }
}
function safetyChecks() {
  assert.doesNotThrow(() => assertLocalEnvironment({ CI: "true", NODE_ENV: "test" }));
  for (const key of ["DATABASE_URL", "DIRECT_URL", "PGHOST", "PGPASSWORD", "SUPABASE_ACCESS_TOKEN", "OPENAI_API_KEY", "EDISON_DEMAND_DAILY_MICROUSD", "DOCKER_HOST"]) {
    assert.throws(() => assertLocalEnvironment({ [key]: "constructed-override" }));
  }
  assert.throws(() => assertLocalEnvironment({ DATABASE_URL: LOCAL_DATABASE_URL }));
  assert.throws(() => assertLocalEnvironment({ NODE_ENV: "production" }));
  assert.throws(() => assertLocalEnvironment({ VERCEL: "1" }));
  assert.equal(new URL(LOCAL_DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(LOCAL_DATABASE_URL).port, "54322");
  assert.equal(workerSchema.safeParse({ kind: "deploy" }).success, false);
  console.log("Disposable recovery safety checks passed; no database, provider or workflow imported/contacted.");
}
async function runtime() {
  assertLocalEnvironment(process.env); assertLocalContainer();
  Object.assign(process.env, settings, { DATABASE_URL: LOCAL_DATABASE_URL, NODE_ENV: "test" });
  const db = await import("../packages/db/src/index");
  const database = db.getDb();
  const [server] = await database.execute<{ database: string; version: string; pid: number }>(sql`select current_database() as database, current_setting('server_version_num') as version, pg_backend_pid() as pid`);
  assert.equal(server.database, "postgres"); assert.equal(Math.floor(Number(server.version) / 10000), 17);
  const { prepareDemandRetry } = await import("../apps/api/src/services/demand-dispatch");
  const { requestDemandArticle } = await import("../apps/api/src/services/demand-reading");
  return { ...db, database, prepareDemandRetry, requestDemandArticle, pid: server.pid };
}

async function worker(value: unknown) {
  if (!process.send) throw new Error("Race workers require the parent IPC channel");
  const input = workerSchema.parse(value);
  const { database, demandRequests, demandPrincipals, demandIdeas, prepareDemandRetry, requestDemandArticle, pid } = await runtime();
  Object.assign(process.env, { EDISON_DEMAND_DAILY_MICROUSD: String(input.daily), EDISON_DEMAND_MONTHLY_MICROUSD: String(input.monthly) });
  const [request] = await database.select().from(demandRequests).where(and(eq(demandRequests.id, input.requestId), eq(demandRequests.principalId, input.principalId)));
  if (!request?.idempotencyKey.startsWith(`check-recovery:${input.runId}:`)) throw new Error("Worker refuses data not owned by its test run");
  const [principal] = await database.select().from(demandPrincipals).where(eq(demandPrincipals.id, input.principalId));
  assert.ok(principal);
  const [idea] = input.kind === "fresh" ? await database.select().from(demandIdeas).where(and(eq(demandIdeas.batchRequestId, request.id), eq(demandIdeas.principalId, principal.id))) : [];
  process.send({ ready: true, pid });
  await new Promise<void>((resolve) => process.once("message", (message) => { assert.equal(message, "go"); resolve(); }));
  let result: WorkerResult;
  try {
    if (input.kind === "retry") {
      const prepared = await prepareDemandRetry(principal.id, request.id);
      result = { ok: true, outcome: prepared.outcome, pid };
    } else {
      assert.ok(idea);
      const admitted = await requestDemandArticle(principal, idea.id, { idempotencyKey: `check-recovery:${input.runId}:fresh:${idea.id}` });
      assert.equal(admitted.snapshot.checkerContractVersion, "edison-reader-first-v2.5-check-v1");
      result = { ok: true, outcome: "created", pid };
    }
  } catch (error) {
    const candidate = error as { code?: unknown };
    result = { ok: false, code: typeof candidate.code === "string" ? candidate.code : error instanceof Error ? error.message : "unknown", pid };
  }
  // The real DB transaction is settled. No workflow function was invoked.
  await new Promise<void>((resolve, reject) => process.send!(result, (error) => error ? reject(error) : resolve()));
  process.exit(0);
}

async function race(inputs: readonly WorkerInput[], releaseTogether: (pids: number[], start: () => void) => Promise<void>) {
  // The application pool has max:1. Independent OS processes are intentional:
  // a single-process Promise.all would not exercise PostgreSQL lock contention.
  const workers = inputs.map((input) => {
    const child = fork(fileURLToPath(import.meta.url), ["--worker", JSON.stringify(input)], {
      execArgv: ["--import", "tsx"], cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { PATH: process.env.PATH, NODE_ENV: "test" }, silent: true,
    });
    let readyResolve!: (pid: number) => void; let resultResolve!: (result: WorkerResult) => void; let fail!: (error: Error) => void;
    const ready = new Promise<number>((resolve) => { readyResolve = resolve; });
    const result = new Promise<WorkerResult>((resolve, reject) => { resultResolve = resolve; fail = reject; });
    let output = ""; let done = false;
    const timer = setTimeout(() => { child.kill("SIGTERM"); fail(new Error("Disposable recovery race timed out")); }, 30_000);
    for (const stream of [child.stdout, child.stderr]) stream?.on("data", (data: Buffer) => { output = (output + data.toString()).slice(-16_000); });
    child.on("message", (message: unknown) => {
      if (message && typeof message === "object" && "ready" in message && "pid" in message) readyResolve(Number(message.pid));
      else { done = true; clearTimeout(timer); resultResolve(message as WorkerResult); }
    });
    child.on("error", (error) => { clearTimeout(timer); fail(error); });
    child.on("exit", (code) => { clearTimeout(timer); if (!done) fail(new Error(`Disposable race worker exited ${code}: ${output}`)); });
    return { child, ready, result };
  });
  try {
    // Race setup failure against readiness, so a failed worker cannot hang the
    // parent barrier. Successful results cannot precede the explicit go signal.
    const pids = await Promise.race([Promise.all(workers.map((item) => item.ready)),
      Promise.all(workers.map((item) => item.result)).then((): never => { throw new Error("Race workers completed before the start barrier"); })]);
    assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
    await releaseTogether(pids, () => { for (const item of workers) item.child.send("go"); });
    const results = await Promise.all(workers.map((item) => item.result));
    assert.equal(new Set(results.map((result) => result.pid)).size, workers.length, "races require separate PostgreSQL sessions");
    return results;
  } finally { for (const item of workers) if (item.child.exitCode === null) item.child.kill("SIGTERM"); }
}

async function integrationChecks() {
  const { database, demandPrincipals, demandLoops, demandRequests, demandIdeas, demandEvents, demandStages, demandUsage,
    prepareDemandRetry, requestDemandArticle } = await runtime();
  const { durableDemandProvider } = await import("../apps/api/src/services/demand-provider-stages");
  const { advanceReaderFirstPipeline } = await import("../apps/api/src/services/reader-first-pipeline");
  const { initialDemandState } = await import("../apps/api/src/services/demand-runner");
  const { readerFirstFingerprint } = await import("../packages/ai/src/reader-first");
  const { createEmptyLoopPrincipleState } = await import("../packages/domain/src/loop-principles");
  const { HttpError } = await import("../apps/api/src/http/errors");
  const runId = randomUUID(); const owners = new Set<string>(); const accountIds = new Set<string>(); let stubCalls = 0;
  const empty = { sources: [], passages: [] };
  const cap = { daily: 10_000_000, monthly: 50_000_000 };
  const prefix = `check-recovery:${runId}:`;
  const [legacy] = await database.execute<{ daily: string; monthly: string; unpriced: boolean; outstanding: boolean }>(sql`select * from private.demand_legacy_budget()`);
  assert.ok(legacy && !legacy.unpriced && !legacy.outstanding, "disposable fixtures require settled priced legacy work");
  const [existing] = await database.execute<{ count: number }>(sql`select count(*)::integer as count from private.demand_requests`);
  assert.equal(existing.count, 0, "run this isolated check after the earlier disposable demand check has cleaned up");

  async function cleanup() {
    if (owners.size) await database.delete(demandPrincipals).where(inArray(demandPrincipals.id, [...owners]));
    owners.clear();
    if (accountIds.size) await database.execute(sql`delete from auth.users where id in (${sql.join([...accountIds].map((id) => sql`${id}::uuid`), sql`, `)})`);
    accountIds.clear(); Object.assign(process.env, settings);
  }
  async function fixture(failed = true) {
    const principalId = randomUUID(); owners.add(principalId);
    const accountUserId = randomUUID(); accountIds.add(accountUserId);
    const loopId = randomUUID(); const batchId = randomUUID(); const ideaId = randomUUID();
    const originalCuriosity = "How does a sensor connect an input to an output?";
    // Only these exact disposable accounts are admitted. D44 production
    // membership and the pending-by-default auth trigger remain unchanged.
    await database.execute(sql`insert into auth.users(id,email,email_confirmed_at)
      values(${accountUserId}::uuid,${`recovery-${runId}-${accountUserId}@example.test`},now())`);
    const admitted = await database.execute(sql`update public.alpha_memberships set status='active'
      where user_id=${accountUserId}::uuid returning user_id`);
    assert.equal(admitted.length, 1);
    const [principal] = await database.insert(demandPrincipals).values({ id: principalId, accountUserId,
      createdAt: new Date(Date.now() - 60_000), expiresAt: null }).returning();
    const [active] = await database.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
    assert.equal(active.active, true);
    const principles = createEmptyLoopPrincipleState({ loopId, originalCuriosity });
    await database.insert(demandLoops).values({ id: loopId, principalId, title: "Constructed recovery test", originalCuriosity,
      principles: principles as unknown as Record<string, unknown> });
    const context = { loopId, revision: 0, originalCuriosity, directions: [], declaredKnowledge: [], readingPreferences: [],
      preferences: { length: "standard" as const, depth: 50 }, previousArticles: [], currentDate: new Date().toISOString().slice(0, 10) };
    await database.insert(demandRequests).values({ id: batchId, principalId, loopId, kind: "ideas", status: "succeeded", stage: "ready",
      idempotencyKey: `${prefix}${batchId}`, requestFingerprint: createHash("sha256").update(batchId).digest("hex"), snapshot: { version: 2, context }, reservedMicrousd: 0 });
    const idea = { id: ideaId, key: "sensor", loopId, loopRevision: 0, headline: originalCuriosity,
      deck: "Connect the intended mechanism to its measured response.", readerQuestion: originalCuriosity,
      payoff: "Understand a sensor mechanism and its limits.", advanceBeyondPrevious: "A first explanation.", qualifications: [], passageIds: [] };
    await database.insert(demandIdeas).values({ id: ideaId, principalId, loopId, batchRequestId: batchId, batchRevision: 0,
      title: idea.headline, deck: idea.deck, brief: idea, evidence: empty, saved: true });
    if (!failed) return { principal, principalId, loopId, ideaId, requestId: batchId };
    // Construct a pre-D50 request at insertion time. Never remove a checker
    // marker from an admitted job or disable the immutable-snapshot trigger.
    const historicalKey = `${prefix}${randomUUID()}`;
    const [created] = await database.insert(demandRequests).values({ id: randomUUID(), principalId, loopId, ideaId,
      kind: "article", idempotencyKey: historicalKey,
      requestFingerprint: readerFirstFingerprint({ intent: "article", ideaId, idempotencyKey: historicalKey }),
      snapshot: { version: 2, context, principleState: principles, selection: { idea, evidence: empty } },
      reservedMicrousd: 1_200_000, stage: "queued" }).returning();
    await database.update(demandIdeas).set({ articleRequestId: created.id }).where(eq(demandIdeas.id, ideaId));
    for (const key of [historicalKey, `${prefix}canonical-${ideaId}`]) {
      const replay = await requestDemandArticle(principal, ideaId, { idempotencyKey: key });
      assert.equal(replay.id, created.id);
      assert.deepEqual(replay.snapshot, created.snapshot, "replay/canonical reads cannot upgrade legacy checker admission");
    }
    await database.update(demandRequests).set({ status: "running", stage: "writing", workflowRunId: `constructed-${runId}`, attempts: 1,
      leaseExpiresAt: new Date(Date.now() + 300_000) }).where(eq(demandRequests.id, created.id));
    const [request] = await database.select().from(demandRequests).where(eq(demandRequests.id, created.id));
    const prose = "A sensor connects an input signal to an output response. That intended mechanism must be distinguished from a measured result.";
    const provider: OnDemandProvider = async (call) => {
      stubCalls++;
      const usage = { providerResponseId: `constructed-${randomUUID()}`, model: call.model, inputTokens: 100, cachedInputTokens: 0,
        outputTokens: 100, webSearchCalls: 0, webSearchToolCalls: 0, webSearchPricingStatus: "priced" as const };
      const output = call.stage === "write" ? { status: "written", reason: null, research: empty, article: {
        category: "tech-science", kicker: "Mechanism", topic: "Sensors", title: idea.headline, deck: idea.deck,
        summary: ["A sensor receives a signal.", "Its mechanism produces a response.", "A test measures that response."],
        whyWritten: "Connect the signal and its observable response.", readingMinutes: 1, sourceKeys: [],
        body: [{ type: "heading", level: 2, text: "Intended and measured behavior" }, { type: "paragraph", text: prose, citations: [] }],
      } } : { fingerprint: (call.input as { fingerprint: string }).fingerprint, verdict: "repair", accuracyPassed: true,
        verificationPassed: true, promiseFulfilled: false, readerFit: true, continuity: true, privacyPassed: true,
        findings: [{ location: "body.0", excerpt: prose, severity: "material", kind: "payoff", reason: "Explain one concrete input-output example.",
          repair: "Add the missing explanatory bridge without changing the claim.", passageIds: [] }] };
      return { output, usage, researchProvenance: { consultedUrls: [], openedUrls: [], citedUrls: [] } } satisfies OnDemandProviderResponse;
    };
    const durable = durableDemandProvider(request.id, principalId, { environment: settings, provider });
    const initial = initialDemandState(request) as ReaderFirstPipelineState;
    const written = await advanceReaderFirstPipeline({ request, state: initial }, { provider: durable });
    assert.equal(written.state.phase, "check");
    const checked = await advanceReaderFirstPipeline({ request, state: written.state }, { provider: durable });
    assert.equal(checked.state.phase, "repair");
    // Model the prior deployed boundary failure, retaining the genuine raw
    // cached checker envelope and ledger already written by production code.
    await database.update(demandRequests).set({ status: "failed", stage: "failed", failureCode: "provider_invalid", leaseExpiresAt: null,
      progress: { ...written.state, phase: "failed", failureCode: "provider_invalid" } }).where(eq(demandRequests.id, request.id));
    await database.insert(demandEvents).values({ principalId, loopId, ideaId, type: "saved", idempotencyKey: `${prefix}event`, data: { saved: true } });
    return { principal, principalId, loopId, ideaId, requestId: request.id };
  }
  type Fixture = Awaited<ReturnType<typeof fixture>>;
  async function records(item: Fixture) {
    const [request] = await database.select().from(demandRequests).where(eq(demandRequests.id, item.requestId));
    return { request,
      stages: await database.select().from(demandStages).where(eq(demandStages.requestId, item.requestId)).orderBy(demandStages.id),
      usage: await database.select().from(demandUsage).where(eq(demandUsage.requestId, item.requestId)).orderBy(demandUsage.id),
      events: await database.select().from(demandEvents).where(eq(demandEvents.principalId, item.principalId)).orderBy(demandEvents.id),
      ideas: await database.select().from(demandIdeas).where(eq(demandIdeas.principalId, item.principalId)).orderBy(demandIdeas.id),
      counts: await database.execute(sql`select count(*)::integer as count from private.demand_requests where principal_id=${item.principalId}::uuid and kind='article' and reserved_microusd>0 and created_at>=now()-interval '24 hours'`),
    };
  }
  const job = (item: Fixture, kind: WorkerInput["kind"], limits = cap): WorkerInput => ({ runId, principalId: item.principalId, requestId: item.requestId, kind, ...limits });
  const contend = (jobs: readonly WorkerInput[]) => race(jobs, async (pids, start) => {
    await database.transaction(async (tx) => {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-demand-admission', 0))`);
      start();
      const deadline = Date.now() + 5000;
      do {
        const [waiting] = await tx.execute<{ count: number }>(sql`select count(distinct pid)::integer as count from pg_locks
          where locktype='advisory' and not granted and pid in (${sql.join(pids.map((pid) => sql`${pid}`), sql`,`)})`);
        if (waiting.count === pids.length) return;
        await new Promise((resolve) => setTimeout(resolve, 10));
      } while (Date.now() < deadline);
      throw new Error("Both real PostgreSQL sessions must wait on the shared admission lock before proceeding");
    });
  });
  try {
    const same = await fixture(); const before = await records(same); const calls = stubCalls;
    const simultaneous = await contend([job(same, "retry"), job(same, "retry")]);
    assert.ok(simultaneous.every((result) => result.ok));
    assert.deepEqual(simultaneous.map((result) => result.outcome).sort(), ["current", "requeued"]);
    const after = await records(same);
    assert.equal(after.request.status, "queued"); assert.equal(after.request.progress?.phase, "check");
    const receipts = after.request.progress?.checkRecoveries as Array<Record<string, unknown>>;
    assert.equal(receipts.length, 1, "concurrent retry appends exactly one historical failure receipt");
    const receipt = receipts[0];
    assert.equal(receipt.version, 1); assert.equal(receipt.reason, "cached_check_location_binding");
    assert.ok(Number.isFinite(Date.parse(String(receipt.recoveredAt))));
    assert.deepEqual(receipt.originalFailure, { status: before.request.status, failureCode: before.request.failureCode,
      stage: before.request.stage, updatedAt: before.request.updatedAt.toISOString(), workflowRunId: before.request.workflowRunId,
      attempts: before.request.attempts, progressFingerprint: readerFirstFingerprint(before.request.progress) });
    assert.match(String(receipt.checkpointFingerprint), /^[0-9a-f]{64}$/);
    assert.equal(receipt.readmittedMicrousd, before.request.reservedMicrousd - before.usage.reduce((sum, row) => sum + (row.costMicrousd ?? 0), 0));
    const stageReceipts = receipt.stages as Array<Record<string, unknown>>;
    assert.equal(stageReceipts.length, before.stages.length);
    for (const stage of before.stages) {
      const saved = stageReceipts.find((item) => item.id === stage.id);
      assert.ok(saved);
      assert.equal(saved.stageKey, stage.stageKey); assert.equal(saved.requestFingerprint, stage.requestFingerprint);
      assert.equal(saved.snapshotFingerprint, readerFirstFingerprint(stage.snapshot));
      assert.equal(saved.outputFingerprint, readerFirstFingerprint(stage.output));
      assert.equal(saved.usageFingerprint, readerFirstFingerprint(stage.usage));
      assert.equal(saved.providerResponseId, stage.providerResponseId); assert.equal(saved.costMicrousd, stage.costMicrousd);
    }
    for (const key of ["id", "principalId", "loopId", "ideaId", "idempotencyKey", "requestFingerprint", "snapshot", "createdAt", "attempts", "reservedMicrousd", "result"] as const) {
      assert.deepEqual(after.request[key], before.request[key], `recovery preserves ${key}`);
    }
    for (const key of ["stages", "usage", "events", "ideas", "counts"] as const) assert.deepEqual(after[key], before[key], key);
    assert.equal(stubCalls, calls);
    const replay = durableDemandProvider(same.requestId, same.principalId, { environment: settings,
      provider: async () => { throw new Error("A cached checker must not call a provider"); } });
    const resumed = await advanceReaderFirstPipeline({ request: after.request, state: after.request.progress as ReaderFirstPipelineState }, { provider: replay });
    assert.equal(resumed.state.phase, "repair"); assert.equal(resumed.state.check?.verdict, "repair");
    assert.deepEqual((await records(same)).stages, before.stages); assert.deepEqual((await records(same)).usage, before.usage);
    await cleanup();

    for (const constrained of ["daily", "monthly"] as const) {
      const recoverable = await fixture(); const fresh = await fixture(false);
      const saved = await records(recoverable); const spent = saved.usage.reduce((sum, row) => sum + (row.costMicrousd ?? 0), 0);
      const limits = { ...cap, [constrained]: Number(legacy[constrained]) + spent + saved.request.reservedMicrousd };
      assert.ok(limits[constrained] <= cap[constrained]);
      const results = await contend([job(recoverable, "retry", limits), job(fresh, "fresh", limits)]);
      assert.equal(results.filter((result) => result.ok).length, 1, `${constrained}: only one remaining hold fits`);
      assert.equal(results.find((result) => !result.ok)?.code, "reading_budget_reached");
      const [active] = await database.execute<{ count: number }>(sql`select count(*)::integer as count from private.demand_requests where principal_id in (${recoverable.principalId}::uuid,${fresh.principalId}::uuid) and status in ('queued','running')`);
      assert.equal(active.count, 1);
      await cleanup();
    }

    const priced = await fixture(); const unknownOwner = await fixture(false);
    const pricedBefore = await records(priced); const unknownId = randomUUID();
    await database.insert(demandRequests).values({ id: unknownId, principalId: unknownOwner.principalId, loopId: unknownOwner.loopId,
      kind: "feedback", status: "running", stage: "feedback", idempotencyKey: `${prefix}${unknownId}`,
      requestFingerprint: createHash("sha256").update(unknownId).digest("hex"), snapshot: { version: 2 },
      reservedMicrousd: 100_000, leaseExpiresAt: new Date(Date.now() + 300_000) });
    const unpricedProvider = durableDemandProvider(unknownId, unknownOwner.principalId, { environment: settings, provider: async () => ({
      output: { text: "Constructed unpriced response" }, usage: { providerResponseId: `constructed-${randomUUID()}`, model: "unpriced-constructed-model",
        inputTokens: 100, cachedInputTokens: 0, outputTokens: 100, webSearchCalls: 0, webSearchToolCalls: 0 },
    }) });
    await assert.rejects(unpricedProvider({ stage: "feedback", promptVersion: "constructed-local-only", instructions: "Constructed local-only feedback",
      input: {}, schema: z.object({ text: z.string() }), model: settings.OPENAI_UTILITY_MODEL, idempotencyKey: `${unknownId}:feedback`,
      safetyIdentifier: unknownOwner.principalId, timeoutMs: 10000, maxOutputTokens: 1000, research: false,
      researchPolicy: { mode: "none", reason: "Constructed local fixture", maxCalls: 0 } }),
    (error: unknown) => error instanceof HttpError && error.code === "provider_model_unpriced");
    const [unknownUsage] = await database.select().from(demandUsage).where(eq(demandUsage.requestId, unknownId));
    assert.equal(unknownUsage.pricingStatus, "unpriced"); assert.equal(unknownUsage.costMicrousd, null);
    await assert.rejects(prepareDemandRetry(priced.principalId, priced.requestId),
      (error: unknown) => error instanceof HttpError && error.code === "reading_budget_reached");
    assert.deepEqual(await records(priced), pricedBefore, "unpriced global work blocks recovery without erasing the failed receipt");
    await cleanup();

    const limited = await fixture(); const foreign = await fixture(false); const original = await records(limited);
    await assert.rejects(prepareDemandRetry(foreign.principalId, limited.requestId), (error: unknown) => error instanceof HttpError && error.status === 404);
    assert.deepEqual(await records(limited), original);
    const queuedIds = [randomUUID(), randomUUID()];
    for (const id of queuedIds) await database.insert(demandRequests).values({ id, principalId: limited.principalId, loopId: limited.loopId,
      kind: "feedback", status: "queued", stage: "queued", idempotencyKey: `${prefix}${id}`, requestFingerprint: createHash("sha256").update(id).digest("hex"),
      snapshot: { version: 2 }, reservedMicrousd: 100_000 });
    await assert.rejects(prepareDemandRetry(limited.principalId, limited.requestId), (error: unknown) => error instanceof HttpError && error.code === "reading_busy");
    assert.deepEqual(await records(limited), original);
    await database.update(demandRequests).set({ status: "failed", stage: "failed", failureCode: "editorial_withheld" }).where(inArray(demandRequests.id, queuedIds));
    await database.update(demandRequests).set({ attempts: 3 }).where(eq(demandRequests.id, limited.requestId));
    const exhausted = await records(limited);
    await assert.rejects(prepareDemandRetry(limited.principalId, limited.requestId), (error: unknown) => error instanceof HttpError && error.code === "request_retry_exhausted");
    assert.deepEqual(await records(limited), exhausted);
    await database.update(demandPrincipals).set({ revokedAt: new Date() }).where(eq(demandPrincipals.id, limited.principalId));
    await assert.rejects(prepareDemandRetry(limited.principalId, limited.requestId), (error: unknown) => error instanceof HttpError && error.status === 401);
    assert.deepEqual(await records(limited), exhausted);
    // Keep the legacy expired-guest rejection case separate from valid D44
    // accounts, whose schema correctly forbids an expiration timestamp.
    const expiredGuestId = randomUUID(); owners.add(expiredGuestId);
    await database.insert(demandPrincipals).values({ id: expiredGuestId,
      guestTokenHash: createHash("sha256").update(`${runId}:${expiredGuestId}`).digest("hex"),
      createdAt: new Date(Date.now() - 60_000), expiresAt: new Date(Date.now() - 1000) });
    await assert.rejects(prepareDemandRetry(expiredGuestId, limited.requestId), (error: unknown) => error instanceof HttpError && error.status === 401);
    assert.deepEqual(await records(limited), exhausted);
    console.log("Disposable recovery: independent-session same-request and fresh-admission budget races, unpriced-spend blocking, concurrency, ownership, account revocation, expired-guest denial, attempt cap, unchanged history/accounting and cached checker replay passed. Provider responses were constructed local stubs; no workflow started.");
  } finally { await cleanup(); }
}

const args = process.argv.slice(2);
if (args.length === 1 && args[0] === "--check-safety") safetyChecks();
else if (args.length === 2 && args[0] === "--worker") await worker(JSON.parse(args[1]));
else if (args.length === 0) await integrationChecks();
else throw new Error("Only --check-safety or the parent-owned local race worker is accepted");
