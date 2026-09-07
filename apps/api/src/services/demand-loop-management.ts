import { createHash, randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { demandLoops, demandPrincipals, withDemandWorkerDb, type DemandTransaction } from "@edison/db";
import { assembleLoopPrincipleContext, type LoopPrincipleState } from "@edison/domain";
import {
  archiveDemandLoopSchema, editDemandLoopSchema, demandLoopManagementResultSchema,
  managedDemandLoopSchema, DEMAND_LOOP_NAME_LIMIT,
  type ArchiveDemandLoop, type EditDemandLoop, type DemandLoopManagementResult,
} from "@edison/contracts";
import { assertDemandPrincipalActive, type DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";

type LoopRow = typeof demandLoops.$inferSelect;
type EditableLoop = Pick<LoopRow, "id" | "principalId" | "title" | "originalCuriosity" | "revision" | "principles" | "createdAt" | "updatedAt"> & {
  editorInstructions: string | null; archivedAt: Date | null;
};
type Operation = { kind: "edit"; input: EditDemandLoop } | { kind: "archive"; input: ArchiveDemandLoop };
export type DemandLoopEditReceipt = {
  version: 1; operation: Operation; before: EditableLoop; after: EditableLoop;
  result: DemandLoopManagementResult;
};
type SavedEdit = { id: string; request_fingerprint: string; receipt: DemandLoopEditReceipt };

/** The full original request remains available separately, even after removal. */
export function effectiveDemandLoopInstructions(loop: { editorInstructions?: string | null; originalCuriosity: string }) {
  return loop.editorInstructions ?? loop.originalCuriosity;
}

/** Removed instructions fall back to the topic, never the removed old prompt. */
export function contextDemandLoopCuriosity(loop: { editorInstructions?: string | null; originalCuriosity: string; title: string }) {
  const instructions = effectiveDemandLoopInstructions(loop);
  return instructions.trim() ? instructions : loop.title;
}

/** Display-only shortening; never replaces the stored learning request. */
export function conciseDemandLoopName(curiosity: string) {
  const original = curiosity.trim();
  const text = original.replace(/\s+/g, " ");
  if (text.length <= 48 && !/[\n\r]/.test(original)) return text;
  // A newline explicitly separates a topic from instructions. For longer prose,
  // do not mistake an initial's period or a decimal/version separator for a stop.
  const firstPhrase = original.split(/(?<!\b[A-Za-z])\.(?=\s)|[!?\n\r]/, 1)[0].replace(/\s+/g, " ").trim();
  if (firstPhrase && firstPhrase.length <= 40 && firstPhrase.length < original.length) return firstPhrase;
  if (text.length <= 48) return text;
  const prefix = text.slice(0, 48);
  const wordEnd = prefix.lastIndexOf(" ");
  return (wordEnd > 0 ? prefix.slice(0, wordEnd) : prefix).trim();
}

function fingerprint(value: unknown): string {
  const stable = (input: unknown): unknown => Array.isArray(input) ? input.map(stable)
    : input && typeof input === "object" ? Object.fromEntries(Object.entries(input)
      .sort(([a], [b]) => a.localeCompare(b)).map(([key, child]) => [key, stable(child)])) : input;
  return createHash("sha256").update(JSON.stringify(stable(value))).digest("hex");
}

function principleState(loop: EditableLoop) {
  const state = loop.principles as unknown as LoopPrincipleState;
  const context = assembleLoopPrincipleContext(state);
  if (!context.ok || state.loopId !== loop.id || state.revision !== loop.revision || state.originalCuriosity !== loop.originalCuriosity) {
    throw new Error("demand_loop_state_invalid");
  }
  return state;
}

export function managedDemandLoopDto(loop: EditableLoop) {
  const state = principleState(loop);
  return managedDemandLoopSchema.parse({
    id: loop.id, title: loop.title, originalCuriosity: loop.originalCuriosity,
    instructions: effectiveDemandLoopInstructions(loop), archivedAt: loop.archivedAt?.toISOString() ?? null,
    revision: loop.revision,
    principles: state.principles.filter((item) => item.status === "active").map((item) => ({
      id: item.id, kind: item.kind, instruction: item.instruction, source: "reader",
    })),
    lastMutationId: state.lastMutation?.mutationId ?? null, canUndo: Boolean(state.lastMutation),
    createdAt: loop.createdAt.toISOString(), updatedAt: loop.updatedAt.toISOString(),
  });
}

/** Pure transition. Persistence must retain its exact before/after receipt in
 * the same transaction. No request, article, usage, or provider state changes. */
export function transitionDemandLoop(loop: EditableLoop, operation: Operation, now = new Date()): EditableLoop {
  const state = principleState(loop);
  if (loop.archivedAt) throw new HttpError(409, "loop_archived", "This loop has been deleted. Its existing reading remains available.");
  if (loop.revision !== operation.input.baseRevision) {
    throw new HttpError(409, "loop_changed", "The loop changed. Reload its current settings before saving.");
  }
  if (operation.kind === "archive") {
    archiveDemandLoopSchema.parse(operation.input);
    // Do not stale or cancel an already-admitted generation by changing its
    // revision. Fresh admission separately rejects archived loops.
    return { ...loop, archivedAt: now, updatedAt: now };
  }
  const input = editDemandLoopSchema.parse(operation.input);
  const changedName = input.name !== loop.title;
  const changedInstructions = input.instructions !== effectiveDemandLoopInstructions(loop);
  if (changedName && input.name.length > DEMAND_LOOP_NAME_LIMIT) {
    throw new HttpError(400, "loop_name_too_long", "Use a loop name of 80 characters or fewer.");
  }
  if (!changedName && !changedInstructions) return loop;
  if (loop.revision >= 2_147_483_647) throw new HttpError(409, "loop_revision_limit", "This loop cannot accept another edit.");
  const revision = loop.revision + 1;
  const nextState: LoopPrincipleState = {
    ...state, revision,
    // Arbitrary edited prose is explicit reader direction, not automatically
    // inferred knowledge/preferences. Earlier categorized state stays audited.
    principles: changedInstructions ? [] : state.principles,
    // An explicit editor save supersedes the old feedback undo checkpoint. Its
    // original revision must not be rewritten to pretend the edit never happened.
    lastMutation: null,
  };
  const next = { ...loop, title: input.name,
    editorInstructions: changedInstructions ? input.instructions : loop.editorInstructions,
    revision, principles: { ...nextState }, updatedAt: now };
  principleState(next);
  return next;
}

/** The transaction seam supports isolated tests without dispatching workflows. */
export async function manageDemandLoopInTransaction(tx: DemandTransaction, principalId: string, loopId: string, operation: Operation) {
  // Same principal→loop order used by workers; no admission/budget lock needed
  // because this operation never admits work or changes a reservation.
  const [principal] = await tx.select().from(demandPrincipals).where(eq(demandPrincipals.id, principalId)).for("update").limit(1);
  if (!principal) throw new HttpError(401, "reading_session_required", "That reading session is unavailable.");
  assertDemandPrincipalActive(principal);
  const [active] = await tx.execute<{ active: boolean }>(sql`select private.demand_principal_is_active(${principalId}::uuid) as active`);
  if (active?.active !== true) throw new HttpError(401, "reading_session_required", "That reading session is unavailable.");
  const requestFingerprint = fingerprint({ loopId, operation });
  const [saved] = await tx.execute<SavedEdit>(sql`select id, request_fingerprint, receipt from private.demand_loop_edits
    where principal_id=${principalId}::uuid and idempotency_key=${operation.input.idempotencyKey} limit 1`);
  if (saved) {
    if (saved.request_fingerprint !== requestFingerprint) {
      throw new HttpError(409, "idempotency_key_reused", "That save identity was already used for different input.");
    }
    const replay = demandLoopManagementResultSchema.parse({ ...saved.receipt.result, replayed: true });
    if (replay.workspaceId !== principalId || replay.loop.id !== loopId || replay.operationId !== saved.id) {
      throw new Error("demand_loop_receipt_invalid");
    }
    return replay;
  }
  const [row] = await tx.select().from(demandLoops).where(and(eq(demandLoops.id, loopId), eq(demandLoops.principalId, principalId))).for("update").limit(1);
  if (!row) throw new HttpError(404, "loop_not_found", "That learning loop was not found.");
  const loop: EditableLoop = { ...row, editorInstructions: row.editorInstructions ?? null, archivedAt: row.archivedAt ?? null };
  const next = transitionDemandLoop(loop, operation);
  let persisted = next;
  if (next !== loop) {
    const [updated] = await tx.update(demandLoops).set({ title: next.title, editorInstructions: next.editorInstructions,
      archivedAt: next.archivedAt, revision: next.revision, principles: next.principles, updatedAt: next.updatedAt })
      .where(and(eq(demandLoops.id, loopId), eq(demandLoops.principalId, principalId), eq(demandLoops.revision, loop.revision))).returning();
    if (!updated) throw new HttpError(409, "loop_changed", "The loop changed. Reload its current settings before saving.");
    persisted = { ...updated, editorInstructions: updated.editorInstructions ?? null, archivedAt: updated.archivedAt ?? null };
  }
  const operationId = randomUUID();
  const result = demandLoopManagementResultSchema.parse({ workspaceId: principalId, operationId, replayed: false, loop: managedDemandLoopDto(persisted) });
  const receipt: DemandLoopEditReceipt = { version: 1, operation, before: loop, after: persisted, result };
  if (Buffer.byteLength(JSON.stringify(receipt), "utf8") > 240_000) {
    throw new HttpError(409, "loop_context_full", "This loop's saved instructions are too large to edit safely.");
  }
  await tx.execute(sql`insert into private.demand_loop_edits
    (id,principal_id,loop_id,idempotency_key,request_fingerprint,operation,receipt)
    values (${operationId}::uuid,${principalId}::uuid,${loopId}::uuid,${operation.input.idempotencyKey},
      ${requestFingerprint},${operation.kind},${JSON.stringify(receipt)}::jsonb)`);
  return result;
}

export async function editDemandLoop(principal: DemandPrincipal, loopId: string, input: EditDemandLoop) {
  const operation: Operation = { kind: "edit", input: editDemandLoopSchema.parse(input) };
  return withDemandWorkerDb((tx) => manageDemandLoopInTransaction(tx, principal.id, loopId, operation));
}

export async function archiveDemandLoop(principal: DemandPrincipal, loopId: string, input: ArchiveDemandLoop) {
  const operation: Operation = { kind: "archive", input: archiveDemandLoopSchema.parse(input) };
  return withDemandWorkerDb((tx) => manageDemandLoopInTransaction(tx, principal.id, loopId, operation));
}
