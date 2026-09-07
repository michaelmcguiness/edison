"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import type { DemandLoop } from "@edison/contracts";
import { loopDraftChanged, readScopedDraft, resolvedLoopEditDraft, saveScopedDraft, type LoopEditDraft } from "./reader-state";
import { useReaderViewport } from "./use-reader-viewport";

type EditAttempt = { fingerprint: string; id: string; baseRevision: number; deleting: boolean; draft: LoopEditDraft };
function validAttempt(value: unknown): value is EditAttempt | null {
  if (value === null) return true;
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<EditAttempt>;
  return typeof item.id === "string" && /^loop-edit:[0-9a-f-]{36}$/.test(item.id) && typeof item.fingerprint === "string" &&
    typeof item.baseRevision === "number" && Number.isSafeInteger(item.baseRevision) && item.baseRevision >= 0 && typeof item.deleting === "boolean" &&
    Boolean(item.draft && typeof item.draft.name === "string" && item.draft.name.length <= 120 && typeof item.draft.instructions === "string" && item.draft.instructions.length <= 500);
}
function validDraft(value: unknown): value is LoopEditDraft {
  return Boolean(value && typeof value === "object" && "name" in value && typeof value.name === "string" && value.name.length <= 120 &&
    "instructions" in value && typeof value.instructions === "string" && value.instructions.length <= 500);
}

export function LoopEditor({ loop, workspaceId, instructions, onSave, onDelete, onClose, onUndo, pendingUndo, status, error: undoError }: {
  loop: DemandLoop; workspaceId: string; instructions: string;
  onSave: (draft: LoopEditDraft, idempotencyKey: string, baseRevision: number) => Promise<void>;
  onDelete: (idempotencyKey: string, baseRevision: number) => Promise<void>;
  onClose: () => void;
  onUndo?: () => Promise<void>; pendingUndo?: boolean; status?: string; error?: string;
}) {
  const key = `edison:demand:loop-editor:${workspaceId}:${loop.id}`;
  const saved = { name: loop.title, instructions };
  const [draft, setDraft] = useState(() => readScopedDraft(key, saved, validDraft));
  const draftRef = useRef(draft);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [uncertain, setUncertain] = useState(() => readScopedDraft<EditAttempt | null>(`${key}:attempt`, null, validAttempt));
  const attempt = useRef<EditAttempt | null>(uncertain);
  const lock = useRef(false);
  const mounted = useRef(true);
  const name = useRef<HTMLInputElement>(null);
  const keep = useRef<HTMLButtonElement>(null);
  const id = useId();
  const panel = useReaderViewport<HTMLElement>(true, "panel");
  const changed = loopDraftChanged(draft, saved);
  useEffect(() => { mounted.current = true; name.current?.focus({ preventScroll: true }); return () => { mounted.current = false; }; }, []);
  useEffect(() => { if (confirmDelete) keep.current?.focus({ preventScroll: true }); }, [confirmDelete]);
  function update(next: LoopEditDraft) { draftRef.current = next; setDraft(next); saveScopedDraft(key, next); }
  async function submit(deleting: boolean, recover = false) {
    if (lock.current || pendingUndo) return;
    if (attempt.current && !recover) return;
    if (!recover && !deleting && draft.name !== loop.title && draft.name.trim().length > 80) { setError("Choose a loop name of 80 characters or fewer."); return; }
    lock.current = true; setPending(true); setError("");
    if (!attempt.current) attempt.current = { fingerprint: JSON.stringify([loop.id, loop.revision, deleting ? "delete" : draft]), id: `loop-edit:${crypto.randomUUID()}`, baseRevision: loop.revision, deleting, draft: { ...draft } };
    const currentAttempt = attempt.current;
    saveScopedDraft(`${key}:attempt`, currentAttempt);
    try {
      if (currentAttempt.deleting) await onDelete(currentAttempt.id, currentAttempt.baseRevision);
      else await onSave(currentAttempt.draft, currentAttempt.id, currentAttempt.baseRevision);
      // An earlier request can finish after close/reopen and newer draft edits.
      // Confirm that request without replacing or closing the later draft.
      const latest = readScopedDraft(key, draftRef.current, validDraft);
      const resolved = resolvedLoopEditDraft(latest, currentAttempt.draft);
      if (!currentAttempt.deleting) saveScopedDraft(key, resolved.draft);
      attempt.current = null;
      saveScopedDraft(`${key}:attempt`, null);
      setUncertain(null);
      if (mounted.current) {
        draftRef.current = resolved.draft; setDraft(resolved.draft);
        if (currentAttempt.deleting || resolved.close) onClose();
      }
    } catch (failure) {
      const status = failure && typeof failure === "object" && "status" in failure ? failure.status : null;
      const rejected = typeof status === "number" && status >= 400 && status < 500 && status !== 408;
      if (rejected) { attempt.current = null; saveScopedDraft(`${key}:attempt`, null); setUncertain(null); }
      else setUncertain(currentAttempt);
      setError(`${rejected ? "The change was not accepted. Your edits are still here." : "We couldn’t confirm the change. Check its status before making another change."} ${failure instanceof Error ? failure.message : ""}`);
    } finally { lock.current = false; setPending(false); }
  }
  return <section ref={panel} className="demand-floating-panel demand-loop-editor" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="demand-mini-head"><h2 id={`${id}-title`}>{confirmDelete ? "Delete this loop?" : "Edit loop"}</h2><button type="button" onClick={onClose} aria-label="Close loop editor"><X aria-hidden="true" /></button></header>
    {confirmDelete ? <><p><strong>{loop.title}</strong> will disappear from your loops. Saved reading stays in Library. Existing articles and conversations remain available through reading history and their article links.</p><p className="demand-scope-note">Already-started generation is not cancelled by deleting this loop.</p>
      <div className="demand-editor-actions"><button ref={keep} type="button" disabled={pending} onClick={() => setConfirmDelete(false)}>Keep loop</button><button type="button" className="demand-danger" disabled={pending} onClick={() => void submit(true)}>{pending ? "Deleting…" : "Delete loop"}</button></div></>
      : <><form onSubmit={(event) => { event.preventDefault(); if (draft.name.trim() && changed) void submit(false); }} aria-busy={pending}>
        <label htmlFor={`${id}-name`}>Name</label><input id={`${id}-name`} ref={name} value={draft.name} maxLength={Math.max(80, loop.title.length)} required readOnly={pending} onChange={(event) => update({ ...draft, name: event.target.value })} />
        <label htmlFor={`${id}-instructions`}>Instructions for this loop</label><textarea id={`${id}-instructions`} value={draft.instructions} maxLength={500} rows={4} readOnly={pending}
          placeholder="What should Edison focus on, explain or avoid?" onChange={(event) => update({ ...draft, instructions: event.target.value })} />
        <details><summary>What’s shaping this loop now</summary>{instructions ? <p className="demand-saved-instructions">{instructions}</p> : <p>No added instructions. Edison’s defaults apply.</p>}
          {loop.principles.length ? <ul>{loop.principles.map((principle) => <li key={principle.id}>{principle.instruction} <span>— {principle.kind === "knowledge" ? "your declared knowledge" : principle.kind === "preference" ? "your preference" : "your direction"}</span></li>)}</ul> : null}
          <p>Explanations are checked for accuracy and useful detail — Edison default.</p>
          {onUndo ? <button type="button" className="demand-text-action" disabled={pendingUndo || pending || Boolean(uncertain)} onClick={() => void onUndo()}>Undo latest direction update</button> : null}
        </details>
        <p className="demand-scope-note">Changes apply to future ideas and articles in this loop. Existing reading stays as it is.{onUndo ? " Saving changes replaces the previous undo checkpoint." : ""}</p>
        <div className="demand-editor-actions"><button type="button" onClick={onClose}>Cancel</button><button type="submit" className="demand-primary" disabled={!changed || !draft.name.trim() || pending || pendingUndo || Boolean(uncertain)}>{pending ? "Saving…" : "Save changes"}</button></div>
        {changed ? <p className="demand-scope-note">Unsaved changes</p> : null}
      </form><footer><button type="button" className="demand-delete-loop" onClick={() => setConfirmDelete(true)} disabled={pending || pendingUndo || Boolean(uncertain)}>Delete loop</button></footer></>}
    {uncertain ? <p className="demand-scope-note">A previous change still needs confirmation. <button type="button" className="demand-text-action" disabled={pending} onClick={() => void submit(uncertain.deleting, true)}>Check change status</button></p> : null}
    {error ? <p role="alert" className="demand-dialog-error">{error}</p> : null}
    {undoError ? <p role="alert" className="demand-dialog-error">{undoError}</p> : null}
    {status || pendingUndo ? <p role="status">{pendingUndo ? "Updating this loop…" : status}</p> : null}
  </section>;
}
