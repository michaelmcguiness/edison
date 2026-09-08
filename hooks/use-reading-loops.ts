"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  learningLoopsResponseSchema,
  learningLoopMutationResponseSchema,
  learningLoopResponseSchema,
  learningLoopArticlesResponseSchema,
  type ArticleCard,
  type LearningLoop,
} from "@edison/contracts";
import { edisonApi } from "@/lib/api-client";
import { changeLocalDirection, createLocalLoop, parsePulseWorkspace, pulseWorkspaceKey, type LocalLoop } from "@/lib/pulse-workspace";
import { usePulseWorkspace } from "@/hooks/use-pulse-workspace";

export type ReaderLoop = Pick<LocalLoop, "id" | "title" | "originalCuriosity" | "direction" | "revision" | "paused" | "articleIds" | "publicArticleIds" | "lastMutationId"> & {
  history: { id: string; previousDirection: string; direction: string; createdAt?: string }[];
};

function presentLoop(loop: LearningLoop): ReaderLoop {
  return {
    ...loop,
    history: loop.directionHistory.map((entry) => ({ id: entry.id, previousDirection: entry.previousDirection, direction: entry.resultingDirection, createdAt: entry.createdAt })),
  };
}

export function useReadingLoops(mode: "prototype" | "guest" | "live", identity?: string) {
  const device = usePulseWorkspace(mode === "prototype" ? "demo" : mode === "live" ? identity : null);
  const [accountLoops, setAccountLoops] = useState<ReaderLoop[]>([]);
  const [articles, setArticles] = useState<(ArticleCard & { visibility: "private" | "public" })[]>([]);
  const [loading, setLoading] = useState(mode === "live");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [guestLoops, setGuestLoops] = useState<LocalLoop[]>([]);
  const mutationLock = useRef(false);
  const requests = useRef(new Map<string, string>());
  const readSequence = useRef(0);
  const reload = useCallback(async () => {
    if (mode !== "live" || !identity) return;
    const sequence = ++readSequence.current;
    const response = learningLoopsResponseSchema.parse(await edisonApi("/loops"));
    const listed = await Promise.allSettled(response.loops.filter((loop) => !loop.paused).map((loop) =>
      edisonApi(`/loops/${encodeURIComponent(loop.id)}/articles?limit=30`).then((value) => learningLoopArticlesResponseSchema.parse(value)),
    ));
    if (sequence !== readSequence.current) return;
    setAccountLoops(response.loops.map(presentLoop));
    setArticles(listed.flatMap((result) => result.status === "fulfilled" ? result.value.items.map((item) => ({ ...item, slug: item.slug ?? item.id })) : []));
    setError(listed.some((result) => result.status === "rejected") ? "Some loop reading could not be loaded. Retry to open the full collection." : "");
  }, [identity, mode]);

  useEffect(() => {
    let active = true;
    void reload().catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : "Your loops could not be opened.");
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; readSequence.current += 1; };
  }, [reload]);

  useEffect(() => {
    if (mode !== "live") return;
    try {
      const guest = parsePulseWorkspace(localStorage.getItem(pulseWorkspaceKey()));
      queueMicrotask(() => setGuestLoops(guest.loops));
    } catch { /* Guest corruption cannot replace account state. */ }
  }, [mode]);

  const loops: ReaderLoop[] = mode === "live" ? accountLoops : device.workspace.loops;
  const requestKey = (body: unknown) => {
    const fingerprint = JSON.stringify(body);
    const existing = requests.current.get(fingerprint);
    if (existing) return existing;
    const id = `loop-${crypto.randomUUID()}`;
    requests.current.set(fingerprint, id);
    return id;
  };

  async function create(input: { title: string; originalCuriosity: string; publicArticleIds: string[] }): Promise<string> {
    if (mutationLock.current) throw new Error("Please wait for the current loop change.");
    mutationLock.current = true;
    setPending(true);
    setError("");
    try {
      if (mode === "live") {
        const response = learningLoopResponseSchema.parse(await edisonApi("/loops", { method: "POST", body: JSON.stringify({ ...input, idempotencyKey: requestKey(input) }) }));
        await reload();
        return response.loop.id;
      }
      let loopId = "";
      await device.update((workspace) => {
        const result = createLocalLoop(workspace, input, crypto.randomUUID(), new Date().toISOString());
        loopId = result.loop.id;
        return result.workspace;
      });
      return loopId;
    } finally { mutationLock.current = false; setPending(false); }
  }

  async function changeDirection(loopId: string, direction: string, undoId?: string) {
    if (mutationLock.current) return;
    const loop = loops.find((entry) => entry.id === loopId);
    if (!loop) throw new Error("Choose a loop before applying direction.");
    mutationLock.current = true;
    setPending(true);
    try {
      if (mode === "live") {
        const body = undoId
          ? { operation: "undo", mutationId: undoId, baseRevision: loop.revision }
          : { operation: "set", direction, baseRevision: loop.revision };
        const response = learningLoopMutationResponseSchema.parse(await edisonApi(`/loops/${encodeURIComponent(loopId)}/direction`, {
          method: "PATCH", body: JSON.stringify({ ...body, idempotencyKey: requestKey({ loopId, ...body }) }),
        }));
        setAccountLoops((current) => current.map((entry) => entry.id === loopId ? presentLoop(response.loop) : entry));
      } else {
        await device.update((workspace) => changeLocalDirection(workspace, loopId, loop.revision, direction, crypto.randomUUID(), new Date().toISOString(), undoId));
      }
      setError("");
    } catch (cause) {
      if (mode === "live") await reload().catch(() => undefined);
      throw cause;
    } finally { mutationLock.current = false; setPending(false); }
  }

  async function importGuestLoops(): Promise<{ imported: number; skipped: number }> {
    if (mode !== "live" || mutationLock.current) return { imported: 0, skipped: 0 };
    mutationLock.current = true;
    setPending(true);
    let imported = 0;
    let skipped = 0;
    try {
      const existing = learningLoopsResponseSchema.parse(await edisonApi("/loops")).loops;
      for (const guest of guestLoops) {
        // Never overwrite an existing account loop or direction with a device note.
        if (existing.some((loop) => loop.title.toLocaleLowerCase("en-US") === guest.title.toLocaleLowerCase("en-US"))) { skipped += 1; continue; }
        const response = learningLoopResponseSchema.parse(await edisonApi("/loops", {
          method: "POST",
          body: JSON.stringify({ title: guest.title, originalCuriosity: guest.originalCuriosity, publicArticleIds: guest.publicArticleIds, idempotencyKey: `guest-loop-${guest.id}` }),
        }));
        if (guest.direction && response.loop.revision === 0 && !response.loop.direction) {
          await edisonApi(`/loops/${encodeURIComponent(response.loop.id)}/direction`, {
            method: "PATCH",
            body: JSON.stringify({ operation: "set", direction: guest.direction, baseRevision: 0, idempotencyKey: `guest-loop-direction-${guest.id}-r${guest.revision}` }),
          });
        }
        existing.push(response.loop);
        imported += 1;
      }
      await reload();
      return { imported, skipped };
    } finally { mutationLock.current = false; setPending(false); }
  }

  const patchArticle = (id: string, patch: Partial<ArticleCard>) => setArticles((current) => current.map((article) => article.id === id ? { ...article, ...patch } : article));
  return { loops, articles, loading, error, pending, reload, create, changeDirection, device, patchArticle, guestLoops, importGuestLoops };
}
