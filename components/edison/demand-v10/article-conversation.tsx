"use client";

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { ArrowUp, ChevronLeft, Library, X } from "lucide-react";
import type { DemandAnswer, DemandArticle, DemandRequest } from "@edison/contracts";
import { EdisonLogo, EdisonMark } from "@/components/edison/brand";
import { readScopedDraft, saveScopedDraft } from "./reader-state";
import { useReaderViewport } from "./use-reader-viewport";

export type ReaderConversationTurn = { request: DemandRequest; question: string; answer: DemandAnswer | null };
export type ReaderConversationPage = { workspaceId: string; articleId: string; turns: ReaderConversationTurn[]; nextCursor: string | null };
type PendingTurn = { key: string; question: string; requestId: string | null };
type LocalConversation = { draft: string; scroll: number; attempt: PendingTurn | null; anchor?: { requestId: string; offset: number }; rejected?: { key: string; question: string; message: string }[] };
const empty: LocalConversation = { draft: "", scroll: 0, attempt: null };

export function mergeConversationTurns(previous: readonly ReaderConversationTurn[], incoming: readonly ReaderConversationTurn[]) {
  const byId = new Map(previous.map((turn) => [turn.request.id, turn]));
  const statusRank = { queued: 0, running: 1, failed: 2, succeeded: 3 };
  for (const turn of incoming) {
    const previous = byId.get(turn.request.id);
    if (!previous || turn.request.updatedAt > previous.request.updatedAt ||
      turn.request.updatedAt === previous.request.updatedAt && statusRank[turn.request.status] >= statusRank[previous.request.status]) byId.set(turn.request.id, turn);
  }
  return [...byId.values()].sort((a, b) => a.request.createdAt.localeCompare(b.request.createdAt) || a.request.id.localeCompare(b.request.id));
}

function validLocal(value: unknown): value is LocalConversation {
  if (!value || typeof value !== "object" || !("draft" in value) || typeof value.draft !== "string" || value.draft.length > 1000 ||
    !("scroll" in value) || typeof value.scroll !== "number" || !Number.isFinite(value.scroll) || value.scroll < 0 || !("attempt" in value)) return false;
  const attempt = value.attempt;
  if ("rejected" in value && value.rejected !== undefined && (!Array.isArray(value.rejected) || value.rejected.length > 10 || value.rejected.some((item) =>
    !item || typeof item.key !== "string" || typeof item.question !== "string" || item.question.length > 1000 || typeof item.message !== "string" || item.message.length > 1000))) return false;
  if ("anchor" in value && value.anchor !== undefined) {
    const anchor = value.anchor as LocalConversation["anchor"];
    if (!anchor || typeof anchor.requestId !== "string" || !/^[0-9a-f-]{36}$/.test(anchor.requestId) || typeof anchor.offset !== "number" || !Number.isFinite(anchor.offset)) return false;
  }
  return attempt === null || Boolean(attempt && typeof attempt === "object" && "key" in attempt && typeof attempt.key === "string" &&
    /^question:[0-9a-f-]{36}$/.test(attempt.key) && "question" in attempt && typeof attempt.question === "string" && attempt.question.length <= 1000 &&
    "requestId" in attempt && (attempt.requestId === null || typeof attempt.requestId === "string" && /^[0-9a-f-]{36}$/.test(attempt.requestId)));
}

export function ArticleConversation({ article, workspaceId, open, getConversation, ask, retry, onClose, onLibrary, renderAnswer }: {
  article: DemandArticle; workspaceId: string; open: boolean;
  getConversation: (cursor?: string) => Promise<ReaderConversationPage>;
  ask: (question: string, idempotencyKey: string) => Promise<{ requestId?: string }>;
  retry: (requestId: string) => Promise<unknown>;
  onClose: () => void; onLibrary: () => void;
  renderAnswer: (answer: DemandAnswer) => ReactNode;
}) {
  const storageKey = `edison:demand:conversation:${workspaceId}:${article.id}`;
  const [local, setLocal] = useState(() => readScopedDraft(storageKey, empty, validLocal));
  const localRef = useRef(local);
  const [turns, setTurns] = useState<ReaderConversationTurn[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [full, setFull] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [retrying, setRetrying] = useState<string | null>(null);
  const mounted = useRef(true);
  const sendLock = useRef(false);
  const fetchSerial = useRef(0);
  const page = useReaderViewport<HTMLElement>(open && full, "page");
  const panel = useReaderViewport<HTMLElement>(open && !full, "panel");
  const dock = useReaderViewport<HTMLDivElement>(open && full, "dock");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const compactTextarea = useRef<HTMLTextAreaElement>(null);
  const getRef = useRef(getConversation);
  const loadedCursor = useRef<string | null>(null);
  const restoringScroll = useRef(true);
  const id = useId();
  useLayoutEffect(() => { getRef.current = getConversation; });
  const persist = useCallback((next: LocalConversation) => {
    localRef.current = next; setLocal(next); saveScopedDraft(storageKey, next);
  }, [storageKey]);
  const load = useCallback(async (before?: string) => {
    const serial = ++fetchSerial.current;
    const scroll = page.current;
    const oldHeight = before ? scroll?.scrollHeight ?? 0 : 0;
    const oldTop = scroll?.scrollTop ?? 0;
    setLoading(true);
    try {
      let result = await getRef.current(before);
      if (!mounted.current || serial !== fetchSerial.current) return;
      if (result.workspaceId !== workspaceId || result.articleId !== article.id) throw new Error("This conversation belongs to a different reading workspace.");
      // Reload/Library return can point before the latest page. Recover that
      // request anchor without inventing a transcript or overwriting its offset.
      const anchor = !loadedCursor.current && !before ? localRef.current.anchor : undefined;
      const seenCursors = new Set<string>();
      let pages = 0;
      while (anchor && !result.turns.some(({ request }) => request.id === anchor.requestId) && result.nextCursor && pages < 20) {
        if (seenCursors.has(result.nextCursor)) break;
        seenCursors.add(result.nextCursor); pages++;
        const older = await getRef.current(result.nextCursor);
        if (!mounted.current || serial !== fetchSerial.current) return;
        if (older.workspaceId !== workspaceId || older.articleId !== article.id) throw new Error("This conversation belongs to a different reading workspace.");
        result = { ...result, turns: mergeConversationTurns(result.turns, older.turns), nextCursor: older.nextCursor };
      }
      setTurns((current) => mergeConversationTurns(current, result.turns));
      if (before || !loadedCursor.current) { setCursor(result.nextCursor); loadedCursor.current = before ?? "latest"; }
      const attempt = localRef.current.attempt;
      if (attempt?.requestId && result.turns.some(({ request }) => request.id === attempt.requestId)) persist({ ...localRef.current, attempt: null });
      setError(""); setLoaded(true);
      if (before) requestAnimationFrame(() => { if (page.current) page.current.scrollTop = oldTop + page.current.scrollHeight - oldHeight; });
    } catch (failure) {
      if (mounted.current && serial === fetchSerial.current) setError(failure instanceof Error ? failure.message : "Your conversation could not be loaded.");
    } finally { if (mounted.current && serial === fetchSerial.current) setLoading(false); }
  }, [article.id, page, persist, workspaceId]);
  useEffect(() => {
    mounted.current = true;
    queueMicrotask(() => { if (mounted.current) void load(); });
    return () => { mounted.current = false; };
  }, [load]);
  const busy = sending || Boolean(local.attempt) || turns.some(({ request }) => request.status === "queued" || request.status === "running");
  useEffect(() => {
    if (!busy || sending || (local.attempt && !local.attempt.requestId)) return;
    const timer = setTimeout(() => void load(), 2000);
    return () => clearTimeout(timer);
  }, [busy, sending, turns, load, loading, local.attempt]);
  useEffect(() => {
    if (!open) { queueMicrotask(() => { if (mounted.current) setFull(false); }); return; }
    if (!full) compactTextarea.current?.focus({ preventScroll: true });
  }, [open, full]);
  useLayoutEffect(() => {
    if (!open || !full) return;
    if (restoringScroll.current && loaded && page.current) {
      const anchor = localRef.current.anchor;
      const target = anchor ? Array.from(page.current.querySelectorAll<HTMLElement>("[data-request-id]")).find((element) => element.dataset.requestId === anchor.requestId) : null;
      if (!anchor || target) {
        page.current.scrollTo({ top: target && anchor ? page.current.scrollTop + target.getBoundingClientRect().top - page.current.getBoundingClientRect().top - anchor.offset : localRef.current.scroll });
        restoringScroll.current = false;
      }
    }
  }, [open, full, loaded, turns, page]);
  useEffect(() => { if (open && full) textarea.current?.focus({ preventScroll: true }); }, [open, full]);
  useEffect(() => {
    if (!open || !full) return;
    const background = document.querySelector<HTMLElement>(".pulse-app");
    const wasInert = background?.inert ?? false;
    const overflow = document.body.style.overflow;
    if (background) background.inert = true;
    document.body.style.overflow = "hidden";
    return () => { if (background) background.inert = wasInert; document.body.style.overflow = overflow; };
  }, [open, full]);

  async function submit(recover = false) {
    const savedAttempt = localRef.current.attempt;
    if (sendLock.current || (!recover && (busy || !loaded || !localRef.current.draft.trim()))) return;
    if (recover && !savedAttempt) return;
    sendLock.current = true; setSending(true); setError(""); restoringScroll.current = false; setFull(true);
    const attempt = savedAttempt ?? { key: `question:${crypto.randomUUID()}`, question: localRef.current.draft.trim(), requestId: null };
    persist({ ...localRef.current, draft: recover ? localRef.current.draft : "", attempt });
    requestAnimationFrame(() => page.current?.scrollTo({ top: page.current.scrollHeight }));
    try {
      const result = await ask(attempt.question, attempt.key);
      if (!result.requestId) throw new Error("The answer request could not be confirmed.");
      if (!mounted.current) {
        saveScopedDraft(storageKey, { ...localRef.current, attempt: { ...attempt, requestId: result.requestId } });
        return;
      }
      persist({ ...localRef.current, attempt: { ...attempt, requestId: result.requestId } });
      await load();
    } catch (failure) {
      const message = failure instanceof Error ? failure.message : "We couldn’t confirm your question. Its text is retained.";
      const status = failure && typeof failure === "object" && "status" in failure ? failure.status : null;
      // An explicit admission rejection is not an uncertain provider request.
      // Keep its submitted text locally while allowing a different next draft.
      if (typeof status === "number" && status >= 400 && status < 500 && status !== 408) {
        const next = { ...localRef.current, attempt: null, rejected: [...(localRef.current.rejected ?? []), { key: attempt.key, question: attempt.question, message }].slice(-10) };
        if (mounted.current) persist(next); else saveScopedDraft(storageKey, next);
      }
      if (mounted.current) setError(message);
    } finally { sendLock.current = false; if (mounted.current) setSending(false); }
  }
  async function retryTurn(turn: ReaderConversationTurn) {
    if (sendLock.current || !turn.request.failure?.retryable) return;
    sendLock.current = true; setRetrying(turn.request.id); setError("");
    try { await retry(turn.request.id); await load(); }
    catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : "The answer could not be resumed."); }
    finally { sendLock.current = false; if (mounted.current) setRetrying(null); }
  }
  function rememberPlace() {
    if (!page.current || restoringScroll.current) return;
    const top = page.current.getBoundingClientRect().top;
    const elements = Array.from(page.current.querySelectorAll<HTMLElement>("[data-request-id]"));
    const anchor = elements.findLast((element) => element.getBoundingClientRect().top <= top + 160) ?? elements[0];
    const next = { ...localRef.current, scroll: page.current.scrollTop, ...(anchor?.dataset.requestId ? { anchor: { requestId: anchor.dataset.requestId, offset: anchor.getBoundingClientRect().top - top } } : {}) };
    localRef.current = next; saveScopedDraft(storageKey, next);
  }
  function close() {
    rememberPlace(); restoringScroll.current = true;
    setFull(false); onClose();
  }
  function composer(compact: boolean) {
    return <form className="demand-question-composer" onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <label className="demand-visually-hidden" htmlFor={`${id}-${compact ? "compact" : "followup"}`}>{compact ? "Ask about this article" : "Ask a follow-up"}</label>
      <textarea id={`${id}-${compact ? "compact" : "followup"}`} ref={compact ? compactTextarea : textarea} rows={compact ? 2 : 1} value={local.draft} maxLength={1000}
        placeholder={compact ? "Ask about this article…" : "Ask a follow-up…"} onChange={(event) => persist({ ...localRef.current, draft: event.target.value })} />
      <div className="demand-compose-actions"><small>{busy ? "You can draft your next question." : ""}</small><button type="submit" aria-label="Send question" disabled={busy || !loaded || !local.draft.trim()}><ArrowUp aria-hidden="true" /></button></div>
    </form>;
  }
  if (!open) return null;
  if (!full) return <section ref={panel} className="demand-floating-panel demand-ask-mini" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); close(); } }}>
    <header className="demand-mini-head"><h2 id={`${id}-title`}>Ask about this article</h2><button type="button" onClick={close} aria-label="Close question box"><X aria-hidden="true" /></button></header>
    <p className="demand-question-context">{article.title}</p>{composer(true)}
    {turns.length || local.attempt || local.rejected?.length ? <button type="button" className="demand-text-action" onClick={() => { restoringScroll.current = true; setFull(true); }}>Continue conversation</button> : null}
    {loading && !loaded ? <p role="status">Loading your conversation…</p> : null}
    {error ? <p role="alert" className="demand-dialog-error">{error}<button type="button" onClick={() => void load()}>Load conversation again</button></p> : null}
  </section>;
  return <section ref={page} className="demand-conversation-page" aria-label="Conversation about this article" onScroll={rememberPlace}
    onWheel={() => { restoringScroll.current = false; }} onTouchStart={() => { restoringScroll.current = false; }}>
    <div className="demand-chat-shell"><header className="pulse-masthead"><button type="button" className="pulse-logo" onClick={close} aria-label="Back to article"><EdisonLogo /></button><button type="button" className="pulse-icon-action" aria-label="Open Library" onClick={() => { rememberPlace(); onLibrary(); }}><Library aria-hidden="true" /></button></header>
      <main className="demand-chat-view"><header className="demand-chat-top"><button type="button" className="demand-text-action" onClick={close}><ChevronLeft aria-hidden="true" />Back to article</button><h1>Ask Edison</h1><button type="button" className="demand-chat-context" onClick={close}>{article.title}</button></header>
        {cursor ? <button type="button" className="demand-text-action" disabled={loading} onClick={() => void load(cursor)}>Load earlier conversation</button> : null}
        {local.anchor && loaded && !turns.some(({ request }) => request.id === local.anchor?.requestId) ? <p className="demand-scope-note" role="status">Your earlier reading place is outside this loaded conversation. Load earlier conversation to return to it.</p> : null}
        {turns.map((turn) => <section className="demand-conversation-turn" key={turn.request.id} data-request-id={turn.request.id} aria-label="Question and answer"><div className="demand-user-question"><p><span className="demand-visually-hidden">You: </span>{turn.question}</p></div>
          {turn.answer ? renderAnswer(turn.answer) : turn.request.status === "failed" ? <div className="demand-chat-error"><p>{turn.request.failure?.message ?? "Edison couldn’t answer this question."}</p>{turn.request.failure?.retryable ? <button type="button" className="demand-text-action" disabled={retrying !== null || busy} onClick={() => void retryTurn(turn)}>{retrying === turn.request.id ? "Resuming…" : "Try again"}</button> : null}</div>
            : <p className="demand-chat-pending" role="status"><EdisonMark />Preparing an answer…</p>}
        </section>)}
        {local.attempt && !turns.some(({ request }) => request.id === local.attempt?.requestId) ? <section className="demand-conversation-turn" aria-label="Submitted question"><div className="demand-user-question"><p><span className="demand-visually-hidden">You: </span>{local.attempt.question}</p></div><p role="status" className="demand-chat-pending"><EdisonMark />{sending ? "Sending your question…" : local.attempt.requestId ? "Preparing an answer…" : "Your question hasn’t been confirmed yet."}</p>{!sending && !local.attempt.requestId ? <button type="button" className="demand-text-action" onClick={() => void submit(true)}>Check question status</button> : null}</section> : null}
        {local.rejected?.map((item) => <section key={item.key} className="demand-conversation-turn" aria-label="Question not accepted"><div className="demand-user-question"><p>{item.question}</p></div><div className="demand-chat-error"><p>Question not accepted. {item.message}</p></div></section>)}
        {error ? <p role="alert" className="demand-dialog-error">{error}<button type="button" onClick={() => void load()}>Load conversation again</button></p> : null}
      </main></div>
    <div ref={dock} className="demand-chat-dock"><div>{composer(false)}</div></div>
  </section>;
}
