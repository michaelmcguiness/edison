/** A failed admission response is not evidence that no article was admitted. */
export function ambiguousArticleAdmission(error: unknown) {
  if (error && typeof error === "object" && "status" in error && typeof error.status === "number") {
    if ("code" in error && error.code === "session_unavailable") return false; // Before the POST.
    return error.status === 408 || error.status >= 500 || error.status === 0;
  }
  // Fetch/abort failures and malformed successful envelopes are inconclusive.
  return true;
}

export const ARTICLE_ADMISSION_BACKOFF = [0, 1_200, 2_500, 5_000, 10_000, 20_000] as const;

/** Read-only, finite bursts. Waking after a return/online event never sends a
 * mutation. Timed-out reads may finish later; their results cannot update UI. */
export function reconcileArticleAdmission<T>(options: {
  read: () => Promise<T | null>;
  found: (result: T) => boolean;
  accept: (result: T) => boolean;
  exhausted: (lastObserved: T | null) => void;
  eligible: () => boolean;
  schedule?: (callback: () => void, delay: number) => ReturnType<typeof setTimeout>;
  cancel?: (timer: ReturnType<typeof setTimeout>) => void;
}) {
  const schedule = options.schedule ?? setTimeout;
  const cancel = options.cancel ?? clearTimeout;
  let stopped = false; let running = false; let busy = false; let index = 0; let generation = 0;
  let lastObserved: T | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let deadline: ReturnType<typeof setTimeout> | undefined;
  const clear = () => { if (timer !== undefined) cancel(timer); if (deadline !== undefined) cancel(deadline); timer = deadline = undefined; };
  const queue = () => {
    if (stopped || !options.eligible()) { running = false; return; }
    if (index === ARTICLE_ADMISSION_BACKOFF.length) { running = false; options.exhausted(lastObserved); return; }
    timer = schedule(() => { timer = undefined; void read(); }, ARTICLE_ADMISSION_BACKOFF[index++]);
  };
  const read = async () => {
    if (stopped || !options.eligible()) { running = false; return; }
    busy = true;
    const ticket = ++generation;
    try {
      const timeout = new Promise<null>((resolve) => { deadline = schedule(() => resolve(null), 15_000); });
      const result = await Promise.race([options.read(), timeout]);
      if (stopped || ticket !== generation || !options.eligible()) return;
      if (result) lastObserved = result;
      if (result && options.found(result) && options.accept(result)) { stopped = true; return; }
    } catch { /* Unknown/no response preserves the original attempt for another read. */ }
    finally {
      if (deadline !== undefined) cancel(deadline); deadline = undefined;
      busy = false;
      if (!stopped && ticket === generation) queue();
    }
  };
  const wake = () => {
    if (stopped || running || busy || !options.eligible()) return;
    running = true; index = 0; lastObserved = null; queue();
  };
  wake();
  return { wake, stop() { stopped = true; generation++; clear(); } };
}
