"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { boundedRecord, continuityStorageKey, emptyReaderContinuity, readReaderContinuity, type ReadingJourney, type ReaderContinuity } from "@/lib/reader-continuity";

/** Per-tab recovery avoids one tab overwriting another tab's reading journey. */
export function useReaderContinuity(identity?: string | null) {
  const record = useRef<ReaderContinuity>(emptyReaderContinuity());
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const key = continuityStorageKey(identity);
  useEffect(() => {
    try { record.current = readReaderContinuity(sessionStorage.getItem(key)); }
    catch { /* Continue in memory; a later attempted write reports its boundary. */ }
    queueMicrotask(() => setHydrated(true));
  }, [key]);

  const persist = useCallback(() => {
    try { sessionStorage.setItem(key, JSON.stringify(record.current)); }
    catch { setError("Your reading and drafts remain in this tab, but this browser could not save them for reload."); }
  }, [key]);

  const capture = useCallback((routeKey: string) => {
    const blocks = Array.from(document.querySelectorAll<HTMLElement>("[data-reader-block]"));
    const block = blocks.find((item) => item.getBoundingClientRect().bottom > 90);
    record.current.positions = boundedRecord(record.current.positions, routeKey, {
      blockId: block?.id ?? null,
      offset: block?.getBoundingClientRect().top ?? 0,
      scrollY: Math.max(0, window.scrollY),
    }, 100);
    persist();
  }, [persist]);

  const restore = useCallback((routeKey: string, fallbackY = 0) => {
    const position = record.current.positions[routeKey];
    const block = position?.blockId ? document.getElementById(position.blockId) : null;
    const top = block && position
      ? window.scrollY + block.getBoundingClientRect().top - position.offset
      : position?.scrollY ?? fallbackY;
    window.scrollTo({ top: Math.max(0, top), behavior: "instant" });
  }, []);

  const rememberJourney = useCallback((articleId: string, journey: ReadingJourney) => {
    record.current.journeys = boundedRecord(record.current.journeys, articleId, journey, 60);
    persist();
  }, [persist]);

  const rememberDraft = useCallback((articleId: string, value: string) => {
    record.current.questionDrafts = boundedRecord(record.current.questionDrafts, articleId, value.slice(0, 4000), 60);
    persist();
  }, [persist]);

  const clear = useCallback(() => {
    // A failed removal must not be reported as a successful device-data clear.
    sessionStorage.removeItem(key);
    record.current = emptyReaderContinuity();
    setError("");
  }, [key]);

  return { hydrated, error, capture, restore, rememberJourney, rememberDraft, record, clear };
}
