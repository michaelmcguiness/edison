"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X } from "lucide-react";
import { readScopedDraft, saveScopedDraft } from "./reader-state";
import { useReaderViewport } from "./use-reader-viewport";

export type ReaderShareLink = { url: string };

export async function copyReaderShare(url: string, clipboard: Pick<Clipboard, "writeText"> | undefined) {
  if (!clipboard) throw new Error("Clipboard access is unavailable. Select and copy the link below.");
  await clipboard.writeText(url);
}

export function SharePanel({ articleId, workspaceId, title, createLink, onClose }: {
  articleId: string; workspaceId: string; title: string;
  createLink: (key: string) => Promise<ReaderShareLink>; onClose: () => void;
}) {
  const key = `edison:demand:share-attempt:${workspaceId}:${articleId}`;
  const attempt = useRef<string | null>(null);
  const lock = useRef(false);
  const close = useRef<HTMLButtonElement>(null);
  const [link, setLink] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [native, setNative] = useState(false);
  const id = useId();
  const panel = useReaderViewport<HTMLElement>(true, "panel");
  useEffect(() => { close.current?.focus({ preventScroll: true }); queueMicrotask(() => setNative(typeof navigator.share === "function")); }, []);
  async function create() {
    if (lock.current) return;
    lock.current = true; setPending(true); setError(""); setMessage("");
    if (!attempt.current) attempt.current = readScopedDraft(key, `share:${crypto.randomUUID()}`,
      (value): value is string => typeof value === "string" && /^share:[0-9a-f-]{36}$/.test(value));
    saveScopedDraft(key, attempt.current);
    try { const result = await createLink(attempt.current); setLink(result.url); }
    catch (failure) { setError(`We couldn’t confirm your share link. Try again to recover the same link. ${failure instanceof Error ? failure.message : ""}`); }
    finally { lock.current = false; setPending(false); }
  }
  async function copy() {
    if (!link || lock.current) return;
    lock.current = true; setPending(true); setError(""); setMessage("");
    try { await copyReaderShare(link, navigator.clipboard); setMessage("Link copied."); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "The link wasn’t copied. Try Copy link again."); }
    finally { lock.current = false; setPending(false); }
  }
  async function share() {
    if (!link || !navigator.share || lock.current) return;
    lock.current = true; setPending(true); setError(""); setMessage("");
    try { await navigator.share({ title, url: link }); setMessage("Share action completed."); }
    catch (failure) {
      if (failure instanceof Error && failure.name === "AbortError") setMessage("Sharing cancelled.");
      else setError("The share action didn’t complete. You can copy the link instead.");
    } finally { lock.current = false; setPending(false); }
  }
  return <section ref={panel} className="demand-floating-panel demand-share-panel" role="dialog" aria-modal="false" aria-labelledby={`${id}-title`}
    onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header className="demand-mini-head"><h2 id={`${id}-title`}>Share article</h2><button ref={close} type="button" onClick={onClose} aria-label="Close sharing"><X aria-hidden="true" /></button></header>
    <p>{link ? "Edison members with this link can read this article. Your loop instructions and conversations are not included." : "Create a read-only article link for Edison members. Your loop instructions and conversations won’t be included."}</p>
    {link ? <><label className="demand-visually-hidden" htmlFor={`${id}-link`}>Article link for Edison members</label><input id={`${id}-link`} className="demand-share-link" value={link} readOnly onFocus={(event) => event.currentTarget.select()} />
      <div className="demand-editor-actions">{native ? <button type="button" disabled={pending} onClick={() => void share()}>Share…</button> : null}<button type="button" className="demand-primary" disabled={pending} onClick={() => void copy()}>Copy link</button></div></>
      : <button type="button" className="demand-primary" disabled={pending} onClick={() => void create()}>{pending ? "Creating your share link…" : "Create article link"}</button>}
    {message ? <p role="status">{message}</p> : null}{error ? <p role="alert" className="demand-dialog-error">{error}</p> : null}
  </section>;
}
