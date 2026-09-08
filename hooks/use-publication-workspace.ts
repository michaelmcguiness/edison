"use client";

import { useEffect, useMemo, useSyncExternalStore } from "react";
import { PublicationStorageError, PublicationWorkspaceStore, publicationStorageKey } from "@/lib/publication-state";

/** Device-local, identity-isolated workspace; signing in does not imply account sync. */
export function usePublicationWorkspace(identity?: string | null) {
  const store = useMemo(() => new PublicationWorkspaceStore({
    identity,
    storage: () => window.localStorage,
    withLock: async (operation) => {
      if (!navigator.locks) {
        throw new PublicationStorageError("locking-unavailable", "This browser cannot safely save editorial notes across tabs. Your draft is still here, but it has not been saved. Try a browser with Web Locks support.");
      }
      return navigator.locks.request(publicationStorageKey(identity), operation);
    },
  }), [identity]);
  const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);

  useEffect(() => {
    void store.reload();
    const changed = (event: StorageEvent) => {
      if (event.key === store.storageKey || event.key === null) void store.reload();
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, [store]);

  return {
    ...snapshot,
    updateDraft: store.updateDraft,
    updateScope: store.updateScope,
    saveDirection: store.saveDirection,
    editDirection: store.editDirection,
    removeDirection: store.removeDirection,
    undoDirection: store.undoDirection,
    reload: store.reload,
  };
}
