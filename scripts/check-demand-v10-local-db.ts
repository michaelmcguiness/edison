import assert from "node:assert/strict";
import { execFileSync, fork } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";

// No configurable URL or saved credentials. Each worker independently checks
// the existing named local Supabase container before importing any DB service.
const LOCAL_DATABASE_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";
const DOCKER_SOCKET = "unix:///var/run/docker.sock";
const CONTAINER = "supabase_db_edison-reader";
const workerSchema = z.object({ runId: z.string().uuid(), principalId: z.string().uuid(),
  articleId: z.string().uuid(), key: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/) }).strict();
type WorkerInput = z.infer<typeof workerSchema>;
type WorkerResult = { ok: boolean; pid: number; token?: string; created?: boolean; code?: string };

function assertLocalEnvironment(values: Readonly<Record<string, string | undefined>>) {
  if (Object.keys(values).some((key) => /^(?:PG|POSTGRES|SUPABASE_|OPENAI_|EDISON_|DOCKER_|DATABASE_URL$|DIRECT_URL$)/.test(key))) {
    throw new Error("Disposable v10 check refuses inherited database, provider, app or Docker configuration");
  }
  if (values.NODE_ENV === "production" || Object.hasOwn(values, "VERCEL")) throw new Error("Production execution is forbidden");
}
function assertLocalContainer() {
  const config = readFileSync(new URL("../supabase/config.toml", import.meta.url), "utf8");
  const section = config.split(/^\[db\]\s*$/m)[1]?.split(/^\[/m)[0] ?? "";
  if (!/^project_id\s*=\s*"edison-reader"\s*$/m.test(config) || !/^port\s*=\s*54322\s*$/m.test(section)) throw new Error("Unexpected local database configuration");
  const metadata = JSON.parse(execFileSync("docker", ["--host", DOCKER_SOCKET, "container", "inspect", CONTAINER,
    "--format", '{"running":{{json .State.Running}},"ports":{{json .NetworkSettings.Ports}}}'],
  { encoding: "utf8", timeout: 10000, maxBuffer: 65536, stdio: ["ignore", "pipe", "pipe"] })) as {
    running?: boolean; ports?: Record<string, Array<{ HostIp: string; HostPort: string }> | null>;
  };
  if (metadata.running !== true || !metadata.ports?.["5432/tcp"]?.some((binding) =>
    binding.HostPort === "54322" && ["0.0.0.0", "127.0.0.1", "::"].includes(binding.HostIp))) {
    throw new Error("Named disposable container does not own the expected local port");
  }
}
function safetyChecks() {
  assert.doesNotThrow(() => assertLocalEnvironment({ CI: "true", NODE_ENV: "test" }));
  for (const key of ["DATABASE_URL", "DIRECT_URL", "PGHOST", "PGPASSWORD", "SUPABASE_ACCESS_TOKEN", "OPENAI_API_KEY", "EDISON_ON_DEMAND_ENABLED", "DOCKER_HOST"]) {
    assert.throws(() => assertLocalEnvironment({ [key]: "constructed-override" }));
  }
  assert.throws(() => assertLocalEnvironment({ DATABASE_URL: LOCAL_DATABASE_URL }));
  assert.throws(() => assertLocalEnvironment({ NODE_ENV: "production" }));
  assert.throws(() => assertLocalEnvironment({ VERCEL: "1" }));
  assert.equal(new URL(LOCAL_DATABASE_URL).hostname, "127.0.0.1");
  assert.equal(new URL(LOCAL_DATABASE_URL).port, "54322");
  assert.equal(workerSchema.safeParse({ kind: "deploy" }).success, false);
  console.log("Disposable v10 safety checks passed; no database or provider imported/contacted.");
}
async function runtime() {
  assertLocalEnvironment(process.env); assertLocalContainer();
  Object.assign(process.env, { DATABASE_URL: LOCAL_DATABASE_URL, NODE_ENV: "test", EDISON_ON_DEMAND_ENABLED: "true" });
  const db = await import("../packages/db/src/index");
  const database = db.getDb();
  const [server] = await database.execute<{ database: string; version: string; pid: number }>(sql`
    select current_database() as database, current_setting('server_version_num') as version, pg_backend_pid() as pid
  `);
  assert.equal(server.database, "postgres"); assert.equal(Math.floor(Number(server.version) / 10000), 17);
  const sharing = await import("../apps/api/src/services/demand-sharing");
  return { ...db, ...sharing, database, pid: server.pid };
}
async function worker(value: unknown) {
  if (!process.send) throw new Error("Workers require their parent IPC channel");
  const input = workerSchema.parse(value);
  const { database, demandPrincipals, demandRequests, createDemandArticleShare, pid } = await runtime();
  const [principal] = await database.select().from(demandPrincipals).where(eq(demandPrincipals.id, input.principalId));
  const [article] = await database.select().from(demandRequests).where(and(eq(demandRequests.id, input.articleId), eq(demandRequests.principalId, input.principalId)));
  assert.ok(principal && article?.idempotencyKey.startsWith(`v10:${input.runId}:`), "Worker refuses records not owned by its run");
  process.send({ ready: true, pid });
  await new Promise<void>((resolve) => process.once("message", (message) => { assert.equal(message, "go"); resolve(); }));
  let result: WorkerResult;
  try {
    const receipt = await createDemandArticleShare(principal, input.articleId, { confirmPublic: true, idempotencyKey: input.key });
    result = { ok: true, pid, token: receipt.token, created: receipt.created };
  } catch (error) {
    const candidate = error as { code?: unknown };
    result = { ok: false, pid, code: typeof candidate.code === "string" ? candidate.code : "unexpected_error" };
  }
  await new Promise<void>((resolve, reject) => process.send!(result, (error) => error ? reject(error) : resolve()));
  process.exit(0);
}
async function race(inputs: WorkerInput[], releaseTogether: (pids: number[], go: () => void) => Promise<void>) {
  // The application has a max:1 pool. Separate OS processes are required to
  // prove database contention rather than Promise.all serializing in one pool.
  const workers = inputs.map((input) => {
    const child = fork(fileURLToPath(import.meta.url), ["--worker", JSON.stringify(input)], {
      execArgv: ["--import", "tsx"], cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { PATH: process.env.PATH, NODE_ENV: "test" }, silent: true,
    });
    let readyResolve!: (pid: number) => void; let resolveResult!: (value: WorkerResult) => void; let rejectResult!: (error: Error) => void;
    const ready = new Promise<number>((resolve) => { readyResolve = resolve; });
    const result = new Promise<WorkerResult>((resolve, reject) => { resolveResult = resolve; rejectResult = reject; });
    let output = ""; let done = false;
    const timer = setTimeout(() => { child.kill("SIGTERM"); rejectResult(new Error("Disposable sharing race timed out")); }, 30000);
    for (const stream of [child.stdout, child.stderr]) stream?.on("data", (bytes: Buffer) => { output = (output + bytes.toString()).slice(-12000); });
    child.on("message", (message: unknown) => {
      if (message && typeof message === "object" && "ready" in message && "pid" in message) readyResolve(Number(message.pid));
      else { done = true; clearTimeout(timer); resolveResult(message as WorkerResult); }
    });
    child.on("error", (error) => { clearTimeout(timer); rejectResult(error); });
    child.on("exit", (code) => { clearTimeout(timer); if (!done) rejectResult(new Error(`Disposable sharing worker exited ${code}: ${output}`)); });
    return { child, ready, result };
  });
  try {
    const pids = await Promise.race([Promise.all(workers.map((item) => item.ready)),
      Promise.all(workers.map((item) => item.result)).then((): never => { throw new Error("Workers ended before the race barrier"); })]);
    assert.equal(new Set(pids).size, inputs.length); assert.ok(pids.every((pid) => Number.isSafeInteger(pid) && pid > 0));
    await releaseTogether(pids, () => workers.forEach((item) => item.child.send("go")));
    return await Promise.all(workers.map((item) => item.result));
  } finally { for (const item of workers) if (item.child.exitCode === null) item.child.kill("SIGTERM"); }
}

async function integrationChecks() {
  const { database, demandPrincipals, demandLoops, demandRequests, demandIdeas, demandEvents, demandStages, demandUsage,
    createDemandArticleShare, getDemandArticleShare } = await runtime();
  const { createEmptyLoopPrincipleState } = await import("../packages/domain/src/index");
  const { demandArticleResult, demandConversation, encodeDemandConversationCursor } = await import("../apps/api/src/services/demand-conversation");
  const { editDemandLoop, archiveDemandLoop } = await import("../apps/api/src/services/demand-loop-management");
  const { createDemandLoop, demandWorkspace } = await import("../apps/api/src/services/demand-reading");
  const { HttpError } = await import("../apps/api/src/http/errors");
  const runId = randomUUID(); const prefix = `v10:${runId}:`; const ownerIds: string[] = [];
  const code = (expected: string) => (error: unknown) => error instanceof HttpError && error.code === expected;
  async function owner() {
    const id = randomUUID();
    const [principal] = await database.insert(demandPrincipals).values({ id,
      guestTokenHash: createHash("sha256").update(`${runId}:${id}`).digest("hex"), expiresAt: new Date(Date.now() + 3600000) }).returning();
    ownerIds.push(id); return principal;
  }
  async function fixture(principalId: string, sourced = false) {
    const loopId = randomUUID(), batchId = randomUUID(), ideaId = randomUUID(), articleId = randomUUID(), sourceId = randomUUID();
    const curiosity = "How does a constructed feedback controller work?";
    await database.insert(demandLoops).values({ id: loopId, principalId, title: "Synthetic control loop", originalCuriosity: curiosity,
      principles: { ...createEmptyLoopPrincipleState({ loopId, originalCuriosity: curiosity }) } });
    await database.insert(demandRequests).values({ id: batchId, principalId, loopId, kind: "ideas", status: "succeeded", stage: "ready",
      idempotencyKey: `${prefix}${batchId}`, requestFingerprint: "a".repeat(64), snapshot: { version: 2, requestedCount: 6 }, reservedMicrousd: 0 });
    await database.insert(demandIdeas).values({ id: ideaId, principalId, loopId, batchRequestId: batchId, batchRevision: 0, rank: 1,
      title: "A constructed feedback comparison", deck: "Understand a measurement and target through a simple example.",
      brief: {}, evidence: { sources: [], passages: [] }, saved: true });
    const publishedAt = new Date(Date.now() - 300000).toISOString();
    const article = { id: articleId, slug: "constructed-feedback", category: "tech-science", kicker: "Feedback", topic: "Constructed examples",
      title: "A constructed feedback comparison", deck: "Understand a measurement and target through a simple example.",
      body: [{ type: "paragraph", text: "A controller compares its reading with a target. They are different quantities.",
        citations: sourced ? [{ sourceId, label: "1" }] : [] }],
      sources: sourced ? [{ id: sourceId, title: "Constructed source", publisher: "Example", url: "https://example.org/constructed",
        publishedAt: null, accessedAt: publishedAt }] : [],
      sourceCount: sourced ? 1 : 0, researchedAt: sourced ? publishedAt : null, basis: sourced ? "mixed" : "general_knowledge",
      readingMinutes: 1, reason: "PRIVATE WHY WRITTEN", summary: ["Measure", "Compare", "Respond"], saved: true, completed: false,
      writtenFor: "PRIVATE PERSONALIZATION", shareId: null };
    await database.insert(demandRequests).values({ id: articleId, principalId, loopId, ideaId, kind: "article", status: "succeeded", stage: "ready",
      idempotencyKey: `${prefix}${articleId}`, requestFingerprint: "b".repeat(64), snapshot: { version: 2, private: "PRIVATE SNAPSHOT" },
      result: { article, evidence: { private: "PRIVATE EVIDENCE" }, draft: { whyWritten: "PRIVATE DRAFT" } }, reservedMicrousd: 0,
      createdAt: new Date(publishedAt), updatedAt: new Date(publishedAt) });
    await database.update(demandIdeas).set({ articleRequestId: articleId }).where(eq(demandIdeas.id, ideaId));
    return { loopId, ideaId, articleId, article };
  }
  async function retained(principalId: string) {
    return {
      requests: await database.select().from(demandRequests).where(eq(demandRequests.principalId, principalId)).orderBy(demandRequests.id),
      ideas: await database.select().from(demandIdeas).where(eq(demandIdeas.principalId, principalId)).orderBy(demandIdeas.id),
      events: await database.select().from(demandEvents).where(eq(demandEvents.principalId, principalId)),
      stages: await database.select().from(demandStages).where(eq(demandStages.principalId, principalId)),
      usage: await database.select().from(demandUsage).where(eq(demandUsage.principalId, principalId)),
    };
  }
  try {
    const principal = await owner(), foreign = await owner();
    const first = await fixture(principal.id), second = await fixture(principal.id, true), third = await fixture(foreign.id);
    // 121 real persisted turns exceed the workspace's120-request cap. Include
    // ready/failed/pending receipts; never invent answers for unfinished turns.
    const questionIds: string[] = [];
    const conversationSecond = new Date(Date.now() - 10000).toISOString().slice(0, 19);
    for (let index = 0; index < 121; index++) {
      const id = randomUUID(); questionIds.push(id);
      const status = index === 120 ? "queued" as const : index === 119 ? "failed" as const : "succeeded" as const;
      // All121 anchors occupy the same JS millisecond but distinct PostgreSQL
      // microseconds. A Date-rounded pagination cursor would lose/skip turns.
      const createdAt = `${conversationSecond}.${String(index + 1).padStart(6, "0")}Z`;
      await database.insert(demandRequests).values({ id, principalId: principal.id, loopId: first.loopId, ideaId: first.ideaId, kind: "question", status,
        stage: status === "succeeded" ? "ready" : status === "queued" ? "queued" : "failed",
        idempotencyKey: `${prefix}${id}`, requestFingerprint: "c".repeat(64),
        snapshot: { version: 2, question: { articleVersion: first.articleId, question: `Constructed question ${index}?`, private: "PRIVATE QUESTION CONTEXT" } },
        result: status === "succeeded" ? { answer: { version: 2, body: [{ type: "paragraph", text: `Constructed answer ${index}.`, citations: [] }],
          sources: [], basis: "general_knowledge", researchedAt: null }, private: "PRIVATE RESULT" } : null,
        failureCode: status === "failed" ? "worker_interrupted" : null, reservedMicrousd: 0,
        createdAt: sql`${createdAt}::timestamptz`, updatedAt: sql`${createdAt}::timestamptz` });
    }
    const before = await retained(principal.id);
    const firstRead = await demandArticleResult(principal, first.articleId);
    assert.equal(firstRead.article.id, first.articleId);
    const workspace = await demandWorkspace(principal);
    assert.equal(workspace.requests.length, 120);
    assert.equal(workspace.requests.some((request) => request.id === first.articleId), false);
    async function conversation() {
      let cursor: string | undefined; const pages = [];
      do {
        const page = await demandConversation(principal, first.articleId, cursor ? { cursor } : {});
        pages.push(page); cursor = page.nextCursor ?? undefined;
      } while (cursor && pages.length < 10);
      assert.equal(cursor, undefined); return pages;
    }
    const pages = await conversation();
    assert.deepEqual(pages.map((page) => page.turns.length), [60, 60, 1]);
    const turns = [...pages].reverse().flatMap((page) => page.turns);
    assert.deepEqual(turns.map((turn) => turn.request.id), questionIds);
    assert.equal(turns[120].answer, null); assert.equal(turns[119].answer, null);
    assert.equal(turns[119].request.failure?.retryable, true);
    assert.doesNotMatch(JSON.stringify(pages), /PRIVATE|evidence|principles|draft/);
    await assert.rejects(demandArticleResult(foreign, first.articleId), code("article_not_found"));
    await assert.rejects(demandConversation(foreign, first.articleId), code("article_not_found"));
    for (const cursor of [encodeDemandConversationCursor(foreign.id, first.articleId, questionIds[0]),
      encodeDemandConversationCursor(principal.id, second.articleId, questionIds[0]),
      encodeDemandConversationCursor(principal.id, first.articleId, third.articleId)]) {
      await assert.rejects(demandConversation(principal, first.articleId, { cursor }), code("invalid_conversation_cursor"));
    }

    async function contended(articleId: string, keys: [string, string]) {
      return race(keys.map((key) => ({ runId, principalId: principal.id, articleId, key })), async (pids, go) => {
        await database.transaction(async (tx) => {
          await tx.select().from(demandPrincipals).where(eq(demandPrincipals.id, principal.id)).for("update");
          go();
          let blocked = false;
          for (let count = 0; count < 100; count++) {
            const [{ waiting }] = await tx.execute<{ waiting: number }>(sql`
              select count(*)::integer as waiting from pg_stat_activity
              where pid in (${sql.join(pids.map((pid) => sql`${pid}`), sql`, `)}) and wait_event_type='Lock'
            `);
            if (waiting === pids.length) { blocked = true; break; }
            await new Promise((resolve) => setTimeout(resolve, 50));
          }
          assert.ok(blocked, "Both independent DB sessions must contend before the owner lock is released");
        });
      });
    }
    const sameKey = `${prefix}same-operation`;
    const firstRace = await contended(first.articleId, [sameKey, sameKey]);
    assert.ok(firstRace.every((result) => result.ok));
    assert.equal(new Set(firstRace.map((result) => result.token)).size, 1);
    assert.equal(firstRace.filter((result) => result.created).length, 1);
    const firstToken = firstRace[0].token!;
    const secondKeys: [string, string] = [`${prefix}reuse-one`, `${prefix}reuse-two`];
    const secondRace = await contended(second.articleId, secondKeys);
    assert.ok(secondRace.every((result) => result.ok));
    assert.equal(new Set(secondRace.map((result) => result.token)).size, 1);
    assert.equal(secondRace.filter((result) => result.created).length, 1);
    const secondToken = secondRace[0].token!;
    const [publicationCounts] = await database.execute<{ shares: number; operations: number }>(sql`
      select (select count(*)::integer from private.demand_public_shares where principal_id=${principal.id}::uuid) as shares,
        (select count(*)::integer from private.demand_share_operations where principal_id=${principal.id}::uuid) as operations
    `);
    assert.deepEqual(publicationCounts, { shares: 2, operations: 3 });
    // Simulate a committed response lost at the network boundary: simply do not
    // consume it, then recover the exact operation, without generating any work.
    const recovered = await createDemandArticleShare(principal, first.articleId, { confirmPublic: true, idempotencyKey: sameKey });
    assert.equal(recovered.token, firstToken); assert.equal(recovered.created, false);
    await assert.rejects(createDemandArticleShare(principal, first.articleId, { confirmPublic: true, idempotencyKey: secondKeys[1] }), code("idempotency_key_reused"));
    await assert.rejects(createDemandArticleShare(foreign, first.articleId, { confirmPublic: true, idempotencyKey: `${prefix}foreign` }), code("article_not_found"));
    const publicFirst = await getDemandArticleShare(firstToken), publicSecond = await getDemandArticleShare(secondToken);
    assert.ok(publicFirst && publicSecond);
    assert.equal(publicFirst.article.basis, "general_knowledge"); assert.equal(publicFirst.article.researchedAt, null);
    assert.equal(publicSecond.article.sources.length, 1);
    assert.deepEqual(publicFirst.article.body, first.article.body); assert.deepEqual(publicSecond.article.sources, second.article.sources);
    assert.doesNotMatch(JSON.stringify([publicFirst, publicSecond]), /PRIVATE|principalId|articleId|whyWritten|writtenFor|reason|history|chat/);

    const edit = { name: "<b>Edited loop</b>", instructions: "Use a different future direction.", baseRevision: 0, idempotencyKey: `${prefix}edit` };
    const edited = await editDemandLoop(principal, first.loopId, edit);
    assert.equal(edited.loop.title, edit.name); assert.equal(edited.loop.instructions, edit.instructions); assert.equal(edited.loop.revision, 1);
    const removal = await editDemandLoop(principal, first.loopId, { ...edit, instructions: "", baseRevision: 1, idempotencyKey: `${prefix}remove` });
    assert.equal(removal.loop.instructions, ""); assert.equal(removal.loop.revision, 2);
    const archive = { confirmed: true as const, baseRevision: 2, idempotencyKey: `${prefix}archive` };
    const archived = await archiveDemandLoop(principal, first.loopId, archive);
    assert.ok(archived.loop.archivedAt); assert.equal(archived.loop.revision, 2);
    const editReplay = await editDemandLoop(principal, first.loopId, edit);
    assert.equal(editReplay.operationId, edited.operationId); assert.equal(editReplay.replayed, true);
    assert.deepEqual(editReplay.loop, edited.loop, "A lost old edit response returns its original receipt, not changed content");
    assert.equal((await archiveDemandLoop(principal, first.loopId, archive)).operationId, archived.operationId);
    await assert.rejects(editDemandLoop(principal, first.loopId, { ...edit, instructions: "Different key payload" }), code("idempotency_key_reused"));
    await assert.rejects(editDemandLoop(foreign, first.loopId, { ...edit, idempotencyKey: `${prefix}foreign-edit` }), code("loop_not_found"));
    const retainedLoop = (await demandWorkspace(principal)).loops.find((loop) => loop.id === first.loopId);
    assert.ok(retainedLoop?.archivedAt, "Owner metadata is retained; the UI excludes archived loops from navigation");
    assert.equal(retainedLoop.originalCuriosity, "How does a constructed feedback controller work?");
    const reopened = await demandArticleResult(principal, first.articleId);
    assert.deepEqual(reopened.article, firstRead.article);
    assert.deepEqual(reopened.idea, firstRead.idea); assert.deepEqual(reopened.request, firstRead.request);
    assert.equal(reopened.loop.id, first.loopId); assert.ok(reopened.loop.archivedAt);
    assert.deepEqual(await conversation(), pages);
    assert.deepEqual(await getDemandArticleShare(firstToken), publicFirst);
    assert.equal((await createDemandArticleShare(principal, first.articleId, { confirmPublic: true, idempotencyKey: `${prefix}after-archive` })).token, firstToken);
    assert.deepEqual(await retained(principal.id), before, "Management/sharing must not rewrite articles/questions/history or spend");
    const newerArchives = Array.from({ length: 30 }, (_, index) => {
      const id = randomUUID(), originalCuriosity = `Newer archived fixture ${index}`;
      return { id, principalId: principal.id, title: originalCuriosity, originalCuriosity,
        principles: { ...createEmptyLoopPrincipleState({ loopId: id, originalCuriosity }) }, archivedAt: new Date() };
    });
    await database.insert(demandLoops).values(newerArchives);
    assert.equal((await demandWorkspace(principal)).loops.some((loop) => loop.id === first.loopId), false,
      "The older archive is outside the bounded workspace projection");
    const outsideWindow = await demandArticleResult(principal, first.articleId);
    assert.deepEqual(outsideWindow.article, firstRead.article);
    assert.equal(outsideWindow.loop.id, first.loopId); assert.ok(outsideWindow.loop.archivedAt);
    assert.deepEqual(await conversation(), pages); assert.deepEqual(await getDemandArticleShare(firstToken), publicFirst);

    // A separate owner exercises actual free-slot admission without dispatch.
    // Retained archives must not become a lifetime30-loop cap or erase history.
    const boundaryOwner = await owner();
    async function insertLoops(count: number, archived: boolean) {
      const entries = Array.from({ length: count }, (_, index) => {
        const id = randomUUID(), originalCuriosity = `Constructed ${archived ? "archived" : "active"} loop ${index}`;
        return { id, principalId: boundaryOwner.id, title: originalCuriosity, originalCuriosity,
          principles: { ...createEmptyLoopPrincipleState({ loopId: id, originalCuriosity }) },
          ...(archived ? { archivedAt: new Date() } : {}) };
      });
      await database.insert(demandLoops).values(entries);
    }
    await insertLoops(30, true);
    const admitted = await createDemandLoop(boundaryOwner, { curiosity: "A first active constructed loop", idempotencyKey: `${prefix}active-first` });
    assert.equal(admitted.status, "queued"); assert.equal(admitted.kind, "ideas");
    assert.equal(admitted.snapshot.requestedCount, 6); assert.equal(admitted.reservedMicrousd, 600000);
    const firstBoundary = await retained(boundaryOwner.id);
    assert.equal(firstBoundary.requests.length, 1); assert.equal(firstBoundary.stages.length, 0); assert.equal(firstBoundary.usage.length, 0);
    await insertLoops(29, false);
    await assert.rejects(createDemandLoop(boundaryOwner, { curiosity: "A blocked thirty-first active loop", idempotencyKey: `${prefix}active-limit` }), code("loop_limit"));
    assert.deepEqual(await retained(boundaryOwner.id), firstBoundary, "Rejected active-limit admission cannot create work or usage");
    await archiveDemandLoop(boundaryOwner, admitted.loopId, { confirmed: true, baseRevision: 0, idempotencyKey: `${prefix}archive-active` });
    const replacement = await createDemandLoop(boundaryOwner, { curiosity: "A replacement active constructed loop", idempotencyKey: `${prefix}active-replacement` });
    assert.equal(replacement.status, "queued"); assert.notEqual(replacement.loopId, admitted.loopId);
    const [loopCounts] = await database.execute<{ active: number; archived: number }>(sql`
      select count(*) filter (where archived_at is null)::integer as active,
        count(*) filter (where archived_at is not null)::integer as archived
      from private.demand_loops where principal_id=${boundaryOwner.id}::uuid
    `);
    assert.deepEqual(loopCounts, { active: 30, archived: 31 });
    const finalBoundary = await retained(boundaryOwner.id);
    assert.equal(finalBoundary.requests.length, 2);
    assert.equal(finalBoundary.requests.find((request) => request.id === admitted.id)?.status, "queued", "Archive cannot pretend already-admitted work was cancelled");
    assert.equal(finalBoundary.requests.reduce((sum, request) => sum + request.reservedMicrousd, 0), 1200000);
    assert.equal(finalBoundary.stages.length, 0); assert.equal(finalBoundary.usage.length, 0); assert.equal(finalBoundary.events.length, 0);
    const boundedWorkspace = await demandWorkspace(boundaryOwner);
    assert.equal(boundedWorkspace.loops.length, 60);
    assert.equal(boundedWorkspace.loops.filter((loop) => !loop.archivedAt).length, 30);
    assert.equal(boundedWorkspace.loops.filter((loop) => loop.archivedAt).length, 30);
    console.log("Disposable v10 integration passed: actual same/different-key concurrent sharing, lost-response recovery, private/public isolation,121-turn cursor history, exact article access, edit/remove/archive retention and unchanged request/history/provider ledgers. No provider or workflow calls.");
  } finally {
    if (ownerIds.length) await database.transaction(async (tx) => {
      // Privileged cleanup ONLY after the localhost/container guard, for this
      // run's random principals. Exact immutability triggers are restored in the
      // same transaction; rollback restores them too if any cleanup step fails.
      await tx.execute(sql`alter table private.demand_share_operations disable trigger demand_share_operations_immutable`);
      await tx.execute(sql`alter table private.demand_public_shares disable trigger demand_public_shares_immutable`);
      const owners = sql.join(ownerIds.map((id) => sql`${id}::uuid`), sql`, `);
      await tx.execute(sql`delete from private.demand_share_operations where principal_id in (${owners})`);
      await tx.execute(sql`delete from private.demand_public_shares where principal_id in (${owners})`);
      await tx.execute(sql`delete from private.demand_loop_edits where principal_id in (${owners})`);
      await tx.delete(demandPrincipals).where(inArray(demandPrincipals.id, ownerIds));
      await tx.execute(sql`alter table private.demand_share_operations enable trigger demand_share_operations_immutable`);
      await tx.execute(sql`alter table private.demand_public_shares enable trigger demand_public_shares_immutable`);
    });
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--check-safety") { safetyChecks(); return; }
  if (args.length === 2 && args[0] === "--worker") { await worker(JSON.parse(args[1])); return; }
  if (args.length) throw new Error("Only --check-safety is accepted; no URL, credentials or provider override is allowed");
  await integrationChecks();
}
await main();
