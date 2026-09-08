"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { emptyPulseWorkspace, parsePulseWorkspace, pulseWorkspaceKey, pulseWorkspaceSchema, type PulseWorkspace } from "@/lib/pulse-workspace";

/** Device-local UI/guest state. Account loop truth is always read from the API. */
export function usePulseWorkspace(identity?: string | null) {
  const [workspace, setWorkspace] = useState(emptyPulseWorkspace);
  const [hydrated, setHydrated] = useState(false);
  const [error, setError] = useState("");
  const key = pulseWorkspaceKey(identity);
  const current = useRef(workspace);
  const queue = useRef(Promise.resolve());
  useEffect(() => {
    const read = () => {
      try {
        const value = parsePulseWorkspace(localStorage.getItem(key));
        current.current = value;
        setWorkspace(value);
        setError("");
      } catch {
        setError("Device storage is unavailable or needs review. Changes will not be claimed as saved.");
      }
      setHydrated(true);
    };
    read();
    const changed = (event: StorageEvent) => { if (event.key === key || event.key === null) read(); };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [key]);

  const update = useCallback((operation: (value: PulseWorkspace) => PulseWorkspace): Promise<PulseWorkspace> => {
    const run = async () => {
      if (!navigator.locks) throw new Error("This browser cannot safely save changes across tabs. Your current reading remains available.");
      return navigator.locks.request(key, () => {
        const latest = parsePulseWorkspace(localStorage.getItem(key));
        const next = pulseWorkspaceSchema.parse(operation(latest));
        localStorage.setItem(key, JSON.stringify(next));
        current.current = next;
        setWorkspace(next);
        setError("");
        return next;
      });
    };
    const result = queue.current.then(run);
    queue.current = result.then(() => undefined, () => undefined);
    return result.catch((cause: unknown) => {
      const message = cause instanceof Error ? cause.message : "That change could not be saved on this device.";
      setError(message);
      throw new Error(message);
    });
  }, [key]);

  return { workspace, hydrated, error, update };
}
