"use client";

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
} from "react";
import type {
  ArticleBlock,
  ArticleSource,
  DemandAnswer,
  DemandArticle,
  DemandIdea,
  DemandLoop,
  DemandRequest,
  DemandWorkspace,
  DemandIdeaResult,
  DemandLoops,
} from "@edison/contracts";
import {
  ArrowRight,
  Bookmark,
  ChevronLeft,
  MessageCircle,
  X,
  Share2,
} from "lucide-react";
import { ReaderShell } from "@/components/edison/demand-v10/reader-shell";
import { LoopEditor } from "@/components/edison/demand-v10/loop-editor";
import { ArticleConversation } from "@/components/edison/demand-v10/article-conversation";
import { SharePanel } from "@/components/edison/demand-v10/share-panel";
import { acceptedIdeaArrival, articlePreparationLabel, type LoopEditDraft } from "@/components/edison/demand-v10/reader-state";
import { ArticleCard, ArticleFeedToolbar } from "@/components/edison/demand-v11/feed";
import { ReaderAccount } from "@/components/edison/demand-v11/account";
import { AllowanceWall } from "@/components/edison/demand-v11/allowance-wall";
import { closeDemandActionOverlay, consumeDemandActionOverlayPop, initialDemandActionOverlay, openDemandActionOverlay } from "@/components/edison/demand-v11/action-overlay";
import { articleBalance, currentReadingArticles, nextArticleCount } from "@/components/edison/demand-v11/state";
import { readReadingSet, readingSetMatches, sameReadingSet, storeReadingSet, type ReadingSet } from "@/components/edison/demand-v11/reading-origin";
import { loopProjection, mergeLoopPage, offWindowPendingLoops, recoverCreatedLoop } from "@/components/edison/demand-v11/loop-pages";
import { validResetAttempt } from "@/components/edison/demand-v11/reset-state";
import { availableDemandOrigin, demandRouteHref, navigationForSelection, parseDemandNavigation, parseDemandRoute, readDemandRouteSelection, readyRouteHistoryMode, resolveDemandOrigin,
  type DemandNavigation, type DemandOrigin, type DemandRouteSelection } from "@/components/edison/demand-v10/route-continuity";
import { EdisonMark } from "@/components/edison/brand";
import { useEditorialDialogViewport } from "@/components/edison/editorial-composer";
import {
  PULSE_FOR_YOU_ID,
} from "@/components/edison/pulse-shell";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  applyDemandFeedback,
  askDemandQuestion,
  editDemandLoop,
  deleteDemandLoop,
  createDemandShare,
  getDemandArticle,
  getDemandConversation,
  createDemandLoop,
  getDemandResult,
  getDemandWorkspace,
  getDemandHistory,
  getDemandIdea,
  requestDemandArticle,
  requestDemandIdeas,
  retryDemandRequest,
  startDemandSession,
  startDemandAccountSession,
  DemandClientError,
  updateDemandIdeaEvent,
  getDemandAccountIdentity,
  signOutDemandAccount,
  resetDemandAllowance,
  getDemandLoops,
  getDemandLoop,
  getDemandInvitations,
  sendDemandInvitation,
  resendDemandInvitation,
  revokeDemandInvitation,
} from "@/lib/demand-client";
import {
  clearsSubmittedDemandFeedback, demandReadingPositionForIdea, DemandWorkspaceResponses,
  rememberDemandReadingPosition, restoreCurrentDemandContinuity, restoreDemandReadingPositions, restoredDemandArticlePosition,
  runScopedDemandRequest, type DemandContinuity, type DemandReadingPositions, type SubmittedDemandFeedback,
} from "@/lib/demand-reader-state";
import { demandHistoryRecords, demandHistoryScopeKey, DemandReaderHistory, type HistoryScope } from "@/lib/demand-reader-history";

export const browserDemandReaderClient = {
  applyDemandFeedback,
  askDemandQuestion,
  editDemandLoop,
  deleteDemandLoop,
  createDemandShare,
  getDemandArticle,
  getDemandConversation,
  createDemandLoop,
  getDemandResult,
  getDemandWorkspace,
  getDemandHistory,
  getDemandIdea,
  requestDemandArticle,
  requestDemandIdeas,
  retryDemandRequest,
  startDemandSession,
  startDemandAccountSession,
  updateDemandIdeaEvent,
  getDemandAccountIdentity,
  signOutDemandAccount,
  resetDemandAllowance,
  getDemandLoops,
  getDemandLoop,
  getDemandInvitations,
  sendDemandInvitation,
  resendDemandInvitation,
  revokeDemandInvitation,
};

export type DemandReaderClient = typeof browserDemandReaderClient;

const suggestions = [
  "Health",
  "History",
  "Technology",
  "Science",
  "Sports",
  "Culture",
  "Cryptocurrency",
  "Startups",
  "Design",
  "Architecture",
  "Writing",
  "Art",
] as const;

type DemandView = "home" | "loop" | "library" | "profile" | "request" | "article";
type ReturnTarget = NonNullable<DemandContinuity["origin"]>;
type ClientAttempt = {
  fingerprint: string;
  idempotencyKey: string;
  inFlight: boolean;
};

function idempotencyKey(prefix: string) {
  return `${prefix}:${crypto.randomUUID()}`;
}

function readRouteNavigation(workspaceId: string, selection?: DemandRouteSelection | null): DemandNavigation | null {
  const matches = (record: DemandNavigation | null) => record && (!selection || record.selection?.kind === selection.kind && record.selection.id === selection.id);
  const fromHistory = parseDemandNavigation(window.history.state?.demandNavigation, workspaceId);
  if (matches(fromHistory)) return fromHistory;
  try {
    const raw = localStorage.getItem("edison:demand:navigation:v1");
    const saved = raw && raw.length <= 4096 ? parseDemandNavigation(JSON.parse(raw), workspaceId) : null;
    return matches(saved) ? saved : null;
  } catch { return null; }
}

function writeRouteNavigation(record: DemandNavigation, mode: "push" | "replace", path: string) {
  const state = { ...window.history.state, demandNavigation: record };
  if (mode === "push") window.history.pushState(state, "", path);
  else window.history.replaceState(state, "", path);
  try { localStorage.setItem("edison:demand:navigation:v1", JSON.stringify(record)); } catch { /* Browser history remains usable without device storage. */ }
}

function beginAttempt(
  reference: MutableRefObject<ClientAttempt | null>,
  fingerprint: string,
  prefix: string,
) {
  const previous = reference.current;
  if (previous?.inFlight) return null;
  if (previous?.fingerprint === fingerprint) {
    previous.inFlight = true;
    return previous;
  }
  const attempt = { fingerprint, idempotencyKey: idempotencyKey(prefix), inFlight: true };
  reference.current = attempt;
  return attempt;
}

function finishAttempt(
  reference: MutableRefObject<ClientAttempt | null>,
  attempt: ClientAttempt,
  succeeded: boolean,
) {
  attempt.inFlight = false;
  if (succeeded && reference.current === attempt) reference.current = null;
}

function beginScopedAttempt(
  reference: MutableRefObject<Map<string, ClientAttempt>>,
  scope: string,
  fingerprint: string,
  prefix: string,
) {
  const previous = reference.current.get(scope);
  if (previous?.inFlight) return null;
  if (previous?.fingerprint === fingerprint) {
    previous.inFlight = true;
    return previous;
  }
  const attempt = { fingerprint, idempotencyKey: idempotencyKey(prefix), inFlight: true };
  reference.current.set(scope, attempt);
  return attempt;
}

function finishScopedAttempt(
  reference: MutableRefObject<Map<string, ClientAttempt>>,
  scope: string,
  attempt: ClientAttempt,
  succeeded: boolean,
) {
  attempt.inFlight = false;
  if (succeeded && reference.current.get(scope) === attempt) {
    reference.current.delete(scope);
  }
}

function readDraft(kind: "feedback" | "question" | "article" | "create", ownerId: string, maxLength: number) {
  try {
    return (localStorage.getItem(`edison:demand:${kind}:${ownerId}`) ?? "").slice(0, maxLength);
  } catch {
    return "";
  }
}

function writeDraft(kind: "feedback" | "question" | "article" | "create", ownerId: string, draft: string) {
  try {
    const key = `edison:demand:${kind}:${ownerId}`;
    if (draft) localStorage.setItem(key, draft);
    else localStorage.removeItem(key);
  } catch {
    // Draft persistence is optional; server ownership and request recovery are not.
  }
}

function readPendingRequest(kind: "feedback" | "question" | "article", ownerId: string) {
  try {
    const value = localStorage.getItem(`edison:demand:${kind}-request:${ownerId}`);
    return value && /^[0-9a-f-]{36}$/.test(value) ? value : null;
  } catch {
    return null;
  }
}

function writePendingRequest(
  kind: "feedback" | "question" | "article",
  ownerId: string,
  requestId: string | null,
) {
  try {
    const key = `edison:demand:${kind}-request:${ownerId}`;
    if (requestId) localStorage.setItem(key, requestId);
    else localStorage.removeItem(key);
  } catch {
    // Request identity also remains durable in the server workspace.
  }
}

function readSubmittedFeedback(loopId: string): SubmittedDemandFeedback | null {
  try {
    const raw = localStorage.getItem(`edison:demand:feedback-submitted:${loopId}`);
    if (!raw || raw.length > 2000) return null;
    const value = JSON.parse(raw) as Partial<SubmittedDemandFeedback>;
    return (value.operation === "apply" || value.operation === "undo") && typeof value.text === "string" && value.text.length <= 500 &&
      (value.requestId === null || typeof value.requestId === "string" && /^[0-9a-f-]{36}$/.test(value.requestId))
      ? value as SubmittedDemandFeedback : null;
  } catch { return null; }
}

function writeSubmittedFeedback(loopId: string, value: SubmittedDemandFeedback) {
  try { localStorage.setItem(`edison:demand:feedback-submitted:${loopId}`, JSON.stringify(value)); } catch { /* Optional local recovery. */ }
}

function readStoredAttempt(kind: "feedback" | "question" | "article" | "ideas" | "create", ownerId: string) {
  try {
    const raw = localStorage.getItem(`edison:demand:${kind}-attempt:${ownerId}`);
    if (!raw || raw.length > 2_000) return null;
    const value = JSON.parse(raw) as Partial<ClientAttempt>;
    if (typeof value.fingerprint !== "string" || value.fingerprint.length > 1_600 ||
        typeof value.idempotencyKey !== "string" ||
        !/^[A-Za-z0-9._:-]{8,128}$/.test(value.idempotencyKey)) return null;
    return { fingerprint: value.fingerprint, idempotencyKey: value.idempotencyKey, inFlight: false };
  } catch {
    return null;
  }
}

function writeStoredAttempt(
  kind: "feedback" | "question" | "article" | "ideas" | "create",
  ownerId: string,
  attempt: ClientAttempt | null,
) {
  try {
    const key = `edison:demand:${kind}-attempt:${ownerId}`;
    if (attempt) {
      localStorage.setItem(key, JSON.stringify({
        fingerprint: attempt.fingerprint,
        idempotencyKey: attempt.idempotencyKey,
      }));
    } else {
      localStorage.removeItem(key);
    }
  } catch {
    // The in-memory attempt still prevents duplicate submits in this session.
  }
}

function readableError(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Edison could not complete that request. Please try again.";
}

export function canContinueDemandAccount(error: unknown) {
  return error instanceof DemandClientError && ["guest_session_invalid", "reading_session_expired", "guest_already_claimed"].includes(error.code);
}

export async function runDemandAccountRecovery(lock: MutableRefObject<boolean>, start: () => Promise<DemandWorkspace>, restore: (workspace: DemandWorkspace) => Promise<void>) {
  if (lock.current) return;
  lock.current = true;
  try { await restore(await start()); }
  finally { lock.current = false; }
}

export function DemandStartupFailure({ error, canContinueAccount, pending, onContinueAccount, onRetry }: {
  error: string; canContinueAccount: boolean; pending: boolean; onContinueAccount: () => void; onRetry: () => void;
}) {
  return <><h1>We couldn’t open your reading.</h1>
    {canContinueAccount ? <p>This browser’s earlier reading couldn’t be attached. Your account’s reading is still available.</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    {canContinueAccount ? <button type="button" className="demand-primary" disabled={pending} onClick={onContinueAccount}>{pending ? "Opening your account…" : "Continue with my account"}</button> : null}
    <button type="button" className={canContinueAccount ? "demand-text-action" : "demand-primary"} disabled={pending} onClick={onRetry}>Try again</button>
  </>;
}

function requestStage(stage: DemandRequest["stage"]) {
  const labels: Record<DemandRequest["stage"], string> = {
    queued: "Queued",
    researching: "Researching sources",
    "checking-ideas": "Checking the article ideas",
    writing: "Preparing your explanation",
    checking: "Checking your explanation",
    repairing: "Rechecking a revision",
    updating: "Updating this loop",
    answering: "Preparing your answer",
    ready: "Ready",
    failed: "Couldn’t finish",
  };
  return labels[stage];
}

function canRequestFreshIdeasAfter(code: string | undefined) {
  return code === "evidence_unavailable" ||
    code === "provider_invalid" ||
    code === "loop_changed";
}

function latestRequest(
  workspace: DemandWorkspace,
  loopId: string,
  kind: DemandRequest["kind"],
) {
  return workspace.requests
    .filter((request) => request.loopId === loopId && request.kind === kind)
    .toSorted((left, right) => right.createdAt.localeCompare(left.createdAt))[0];
}

export function demandIdeasPendingLabel(request: DemandRequest | undefined, submitting: boolean) {
  if (request?.status === "queued" || request?.status === "running") return requestStage(request.stage);
  // A new submission can precede its workspace response. Do not borrow a
  // previous request's terminal label for the new request's pending panel.
  return submitting ? "Starting your ideas" : null;
}

export function demandIdeaAction(idea: DemandIdea, request?: DemandRequest) {
  if (!idea.articleRequestId || request?.status === "succeeded") return "Read article";
  if (request?.status === "failed") return "View status";
  if (!request) return "Open article";
  return request.stage === "checking" || request.stage === "repairing"
    ? "Checking explanation…" : request.stage === "researching" ? "Researching…" : "Preparing…";
}

export function restoreDemandDialogFocus(opener: HTMLElement | null, fallback: HTMLElement | null) {
  const target = [opener, fallback].find((element) => element?.isConnected &&
    !element.hasAttribute("disabled") && element.getAttribute("aria-disabled") !== "true");
  if (!target) return false;
  target.focus({ preventScroll: true });
  return true;
}

function dialogOpener(event?: { currentTarget: EventTarget | null }) {
  const element = event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
  return element instanceof HTMLElement && element !== document.body ? element : null;
}

function useDemandGrowingTextarea(value: string, open: boolean, minimum: number) {
  const textarea = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    if (!open) return;
    const resize = () => {
      const element = textarea.current;
      if (!element) return;
      const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
      const maximum = Math.max(minimum, Math.min(240, viewportHeight * 0.4));
      element.style.height = "auto";
      element.style.height = `${Math.max(minimum, Math.min(element.scrollHeight, maximum))}px`;
      element.style.overflowY = element.scrollHeight > maximum ? "auto" : "hidden";
    };
    resize();
    window.addEventListener("resize", resize);
    window.visualViewport?.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      window.visualViewport?.removeEventListener("resize", resize);
    };
  }, [value, open, minimum]);
  return textarea;
}

type DialogFocusProps = {
  openerRef: MutableRefObject<HTMLElement | null>;
  fallbackRef: MutableRefObject<HTMLElement | null>;
};

function IdeaCard({
  idea,
  request,
  saving,
  onOpen,
  onSave,
}: {
  idea: DemandIdea;
  request?: DemandRequest;
  saving: boolean;
  onOpen: () => void;
  onSave: () => void;
}) {
  const action = demandIdeaAction(idea, request);
  return <ArticleCard idea={idea} action={action} saving={saving} onOpen={onOpen} onSave={onSave} />;
}

function CreateLoopDialog({
  open,
  draft,
  pending,
  error,
  onOpenChange,
  onDraftChange,
  onSubmit,
  openerRef,
  fallbackRef,
}: DialogFocusProps & {
  open: boolean;
  draft: string;
  pending: boolean;
  error: string;
  onOpenChange: (open: boolean) => void;
  onDraftChange: (draft: string) => void;
  onSubmit: () => void;
}) {
  const id = useId();
  const textarea = useDemandGrowingTextarea(draft, open, 60);
  const content = useEditorialDialogViewport(open);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        ref={content}
        className="demand-dialog demand-create-dialog"
        showCloseButton={false}
        aria-describedby={`${id}-description${error ? ` ${id}-error` : ""}`}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          textarea.current?.focus({ preventScroll: true });
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          restoreDemandDialogFocus(openerRef.current, fallbackRef.current);
        }}
      >
        <DialogClose className="demand-dialog-close" aria-label="Close new loop">
          <X aria-hidden="true" />
        </DialogClose>
        <DialogTitle>What do you want to learn about?</DialogTitle>
        <DialogDescription id={`${id}-description`} className="demand-visually-hidden">
          Create a learning loop from any topic or question.
        </DialogDescription>
        <form
          aria-busy={pending}
          onSubmit={(event) => {
            event.preventDefault();
            if (draft.trim() && !pending) onSubmit();
          }}
        >
          <textarea
            ref={textarea}
            value={draft}
            rows={1}
            maxLength={500}
            required
            readOnly={pending}
            aria-label="What do you want to learn about?"
            aria-invalid={Boolean(error)}
            placeholder="e.g. art, history, synthetic biology, writing, etc."
            onChange={(event) => onDraftChange(event.target.value)}
          />
          <div className="demand-suggestions">
            <p>Suggested topics</p>
            <div>
              {suggestions.map((suggestion) => (
                <button
                  type="button"
                  key={suggestion}
                  disabled={pending}
                  onClick={() => {
                    onDraftChange(suggestion);
                    textarea.current?.focus({ preventScroll: true });
                  }}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
          {error ? <p id={`${id}-error`} className="demand-dialog-error" role="alert">{error}</p> : null}
          <div className="demand-dialog-footer">
            <button type="submit" className="demand-primary" disabled={!draft.trim() || pending}>
              {pending ? "Creating loop…" : "Create loop"}<ArrowRight aria-hidden="true" />
            </button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function CitationLinks({
  block,
  sources,
}: {
  block: Exclude<ArticleBlock, { type: "heading" }>;
  sources: ArticleSource[];
}) {
  const byId = new Map(sources.map((source) => [source.id, source]));
  return block.citations.length ? (
    <sup className="demand-citations">
      {block.citations.map((citation) => {
        const source = byId.get(citation.sourceId);
        return source ? (
          <a key={`${citation.sourceId}-${citation.label}`} href={source.url} target="_blank" rel="noreferrer" aria-label={`Source: ${source.title}`}>
            {citation.label}
          </a>
        ) : null;
      })}
    </sup>
  ) : null;
}

export function DemandSourceList({ sources }: { sources: ArticleSource[] }) {
  if (!sources.length) return null;
  return (
    <section className="demand-sources">
      <h2>Sources</h2>
      <ol>{sources.map((source, index) => <li key={source.id}><a href={source.url} target="_blank" rel="noreferrer"><span>{index + 1}</span><div><strong>{source.publisher}</strong><small>{source.title}</small></div></a></li>)}</ol>
    </section>
  );
}

export function DemandReadingMetadata({ article }: { article: Pick<DemandArticle, "readingMinutes" | "sources"> }) {
  return <small>{article.readingMinutes} min{article.sources.length ? ` · ${article.sources.length} ${article.sources.length === 1 ? "source" : "sources"}` : ""}</small>;
}

export function DemandAnswerContent({ answer, articleSources, pending = false }: {
  answer: DemandAnswer;
  articleSources: ArticleSource[];
  pending?: boolean;
}) {
  // Only historical answers borrow their saved article's aggregate references.
  // V2 resolves every inline citation against the answer's own validated sources.
  const legacy = "text" in answer;
  const sourceById = new Map(articleSources.map((source) => [source.id, source]));
  const sources = legacy
    ? [...new Set(answer.sourceIds)].flatMap((sourceId) => sourceById.has(sourceId) ? [sourceById.get(sourceId)!] : [])
    : answer.sources;
  const missingLegacySources = legacy && answer.sourceIds.some((sourceId) => !sourceById.has(sourceId));
  return (
    <div className="demand-answer" aria-live="polite">
      <strong>{pending ? "Previous answer" : "Edison"}</strong>
      {legacy ? <p>{answer.text}</p> : answer.body.map((block, index) => {
        if (block.type === "heading") return <h2 key={`${block.text}-${index}`}>{block.text}</h2>;
        if (block.type === "quote") return <blockquote key={`${block.text}-${index}`}>{block.text}{block.attribution ? <cite>— {block.attribution}</cite> : null}<CitationLinks block={block} sources={sources} /></blockquote>;
        return <p key={`${block.text}-${index}`}>{block.text}<CitationLinks block={block} sources={sources} /></p>;
      })}
      <DemandSourceList sources={sources} />
      {missingLegacySources ? <p className="demand-answer-sources">Some saved source references are unavailable.</p> : null}
    </div>
  );
}

export function DemandReader({
  client = browserDemandReaderClient,
  initialWorkspace = null,
  initialArticleId = null,
}: {
  client?: DemandReaderClient;
  initialWorkspace?: DemandWorkspace | null;
  initialArticleId?: string | null;
}) {
  const initialLoop = initialWorkspace?.loops.find((loop) => !loop.archivedAt);
  const [workspace, setWorkspace] = useState<DemandWorkspace | null>(initialWorkspace);
  const [loopPages, setLoopPages] = useState<DemandLoops | null>(null);
  const [loopsLoading, setLoopsLoading] = useState(false);
  const [loopsError, setLoopsError] = useState("");
  const [workspaceResponses] = useState(() => new DemandWorkspaceResponses(initialWorkspace));
  const [historyReader] = useState(() => { const reader = new DemandReaderHistory(); if (initialWorkspace) reader.reset(initialWorkspace.workspaceId); return reader; });
  const [history, setHistory] = useState(() => historyReader.snapshot());
  const [recoveringContinuity, setRecoveringContinuity] = useState(false);
  const [continuityFailure, setContinuityFailure] = useState("");
  const [continuityIntent, setContinuityIntent] = useState(0);
  const [ideaRecoveryErrors, setIdeaRecoveryErrors] = useState<Map<string, string>>(() => new Map());
  const [view, setView] = useState<DemandView>(initialLoop ? "loop" : "home");
  const [activeLoopId, setActiveLoopId] = useState(initialLoop?.id ?? PULSE_FOR_YOU_ID);
  const [createOpen, setCreateOpen] = useState(Boolean(initialWorkspace && !initialLoop));
  const [createDraft, setCreateDraft] = useState("");
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");
  const [curateOpen, setCurateOpen] = useState(false);
  const [curateLoopId, setCurateLoopId] = useState<string | null>(null);
  const [feedbackDraft, setFeedbackDraft] = useState("");
  const [feedbackRequestId, setFeedbackRequestId] = useState<string | null>(null);
  const [feedbackSubmittingLoopId, setFeedbackSubmittingLoopId] = useState<string | null>(null);
  const [feedbackError, setFeedbackError] = useState("");
  const [feedbackStatus, setFeedbackStatus] = useState("");
  const [selectedIdeaId, setSelectedIdeaId] = useState<string | null>(null);
  const [selectedRequestId, setSelectedRequestId] = useState<string | null>(null);
  const [selectedArticle, setSelectedArticle] = useState<DemandArticle | null>(null);
  const [recoveredLoop, setRecoveredLoop] = useState<DemandLoop | null>(null);
  const [askOpen, setAskOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const shareOpenerRef = useRef<HTMLElement | null>(null);
  const [readingSet, setReadingSet] = useState<ReadingSet | null>(null);
  const readingSetRef = useRef<ReadingSet | null>(null);
  const [retainedFeedSet, setRetainedFeedSet] = useState<ReadingSet | null>(null);
  const [allowanceOpen, setAllowanceOpen] = useState(false);
  const [allowanceStatus, setAllowanceStatus] = useState("");
  const [hasPendingReset, setHasPendingReset] = useState(false);
  const [accountSection, setAccountSection] = useState<"profile" | "usage">("profile");
  const actionOverlayRef = useRef(initialDemandActionOverlay());
  const allowanceOpenerRef = useRef<HTMLElement | null>(null);
  const accountReturn = useRef<{ view: DemandView; loopId: string; scrollY: number } | null>(null);
  const requestedBatches = useRef(new Map<string, { ids: Set<string>; previousRequestId: string | null; requestId?: string; previousFailureTime?: string }>());
  const [newIdeas, setNewIdeas] = useState(new Map<string, string[]>());
  const [savingIdeas, setSavingIdeas] = useState<Set<string>>(() => new Set());
  const [ideasSubmittingLoopId, setIdeasSubmittingLoopId] = useState<string | null>(null);
  const [retryingRequestId, setRetryingRequestId] = useState<string | null>(null);
  const [resultLoadNonce, setResultLoadNonce] = useState(0);
  const [resultLoadFailed, setResultLoadFailed] = useState(false);
  const [returnTarget, setReturnTarget] = useState<ReturnTarget | null>(null);
  const [pageError, setPageError] = useState("");
  const [canContinueAccount, setCanContinueAccount] = useState(false);
  const [accountRecoveryPending, setAccountRecoveryPending] = useState(false);
  const accountRecoveryAllowed = useRef(false);
  const accountRecoveryLock = useRef(false);
  const accountRecoveryAction = useRef<(() => Promise<void>) | null>(null);
  const [loading, setLoading] = useState(initialWorkspace === null);
  const openedIdeas = useRef(new Set<string>());
  const selectedIdeaRef = useRef<string | null>(null);
  const activeLoopRef = useRef(activeLoopId);
  const createAttemptRef = useRef<ClientAttempt | null>(null);
  const feedbackAttemptRefs = useRef(new Map<string, ClientAttempt>());
  const ideasAttemptRefs = useRef(new Map<string, ClientAttempt>());
  const articleAttemptRefs = useRef(new Map<string, ClientAttempt>());
  const retryingRequestIds = useRef(new Set<string>());
  const savingIdeaIds = useRef(new Set<string>());
  const readingSurfaceRef = useRef<HTMLElement | null>(null);
  const createOpenerRef = useRef<HTMLElement | null>(null);
  const curateOpenerRef = useRef<HTMLElement | null>(null);
  const askOpenerRef = useRef<HTMLElement | null>(null);
  const continuityRestored = useRef(false);
  const navigationIntentRef = useRef(0);
  const articlePositionRef = useRef(0);
  const readingPositionsRef = useRef<DemandReadingPositions | null>(null);
  const restoringArticleRef = useRef<string | null>(null);
  const pendingHistoryReturn = useRef<DemandOrigin | null>(null);
  const submittedFeedbackRefs = useRef(new Map<string, SubmittedDemandFeedback>());
  const workspaceIdentityRef = useRef(initialWorkspace?.workspaceId ?? null);
  const curateLoopRef = useRef<string | null>(null);
  const initialSelectionRef = useRef<DemandRouteSelection | null>(initialArticleId ? { kind: "article", id: initialArticleId } : null);
  const refreshedLoopRequests = useRef(new Set<string>());

  const publishWorkspace = useCallback((next: DemandWorkspace | null) => {
    if (!next) return false;
    const changed = Boolean(workspaceIdentityRef.current && workspaceIdentityRef.current !== next.workspaceId);
    if (changed) {
      // A principal change is a new workspace, never a union or a stale article.
      navigationIntentRef.current++;
      continuityRestored.current = true;
      setRecoveringContinuity(false);
      setContinuityFailure("");
      selectedIdeaRef.current = null;
      curateLoopRef.current = null;
      activeLoopRef.current = next.loops.find((loop) => !loop.archivedAt)?.id ?? PULSE_FOR_YOU_ID;
      setActiveLoopId(activeLoopRef.current);
      setView(next.loops.some((loop) => !loop.archivedAt) ? "loop" : "home");
      setSelectedIdeaId(null);
      setSelectedRequestId(null);
      setSelectedArticle(null);
      setRecoveredLoop(null);
      setReturnTarget(null);
      setLoopPages(null);
      setReadingSet(null); readingSetRef.current = null; setRetainedFeedSet(null); setAllowanceOpen(false);
      actionOverlayRef.current.kind = null;
      actionOverlayRef.current.entryId = null;
      actionOverlayRef.current.returnLocation = null;
      setFeedbackDraft("");
      setFeedbackRequestId(null);
      setCurateLoopId(null);
      setCurateOpen(false);
      setAskOpen(false);
      setShareOpen(false);
      setCreateOpen(false);
      setCreateDraft("");
      setPageError("");
      setIdeaRecoveryErrors(new Map());
      articlePositionRef.current = 0;
      readingPositionsRef.current = restoreDemandReadingPositions(null, next.workspaceId);
      restoringArticleRef.current = null;
      pendingHistoryReturn.current = null;
    }
    workspaceIdentityRef.current = next.workspaceId;
    historyReader.syncWorkspace(next);
    setHistory(historyReader.snapshot());
    setWorkspace(next);
    return !changed;
  }, [historyReader]);

  const loadHistoryPage = useCallback(async (query: HistoryScope, cursor: string | null, refresh = false) => {
    if (!historyReader.snapshot().workspaceId) return;
    const ticket = historyReader.beginPage(query, cursor, refresh);
    setHistory(historyReader.snapshot());
    try {
      const page = await client.getDemandHistory({ ...query, ...(cursor ? { cursor } : {}) });
      if (historyReader.acceptPage(ticket, page)) setHistory(historyReader.snapshot());
    } catch (error) {
      if (historyReader.failPage(ticket, readableError(error))) setHistory(historyReader.snapshot());
    }
  }, [client, historyReader]);

  const acceptLoopPage = useCallback((page: DemandLoops, preserveCursor = false) => {
    if (page.workspaceId !== workspaceIdentityRef.current) return false;
    setLoopPages((previous) => mergeLoopPage(previous, preserveCursor && previous ? { ...page, nextCursor: previous.nextCursor } : page));
    return true;
  }, []);
  const workspaceForOrigin = useCallback(async (next: DemandWorkspace, origin: DemandOrigin | undefined) => {
    if (origin?.view !== "loop" || !origin.loopId || next.loops.some((loop) => loop.id === origin.loopId)) return next;
    const page = await client.getDemandLoop(origin.loopId);
    if (!acceptLoopPage(page, true)) return next;
    return { ...next, loops: [...next.loops, ...page.loops] };
  }, [acceptLoopPage, client]);
  const loadMoreLoops = useCallback(async (cursor?: string) => {
    setLoopsLoading(true); setLoopsError("");
    try { acceptLoopPage(await client.getDemandLoops(cursor ? { cursor } : {})); }
    catch (error) { setLoopsError(readableError(error)); }
    finally { setLoopsLoading(false); }
  }, [acceptLoopPage, client]);
  useEffect(() => {
    if (!workspace?.workspaceId) return;
    void loadMoreLoops();
  }, [workspace?.workspaceId, loadMoreLoops]);
  useEffect(() => {
    if (!workspace) return;
    try { setHasPendingReset(validResetAttempt(JSON.parse(localStorage.getItem(`edison:demand:allowance-reset:${workspace.workspaceId}`) ?? "null"))); } catch { setHasPendingReset(false); }
    for (const request of workspace.requests) {
      if (request.kind !== "ideas" || request.status !== "succeeded" || workspace.loops.some((loop) => loop.id === request.loopId)) continue;
      const identity = `${workspace.workspaceId}:${request.id}:${request.updatedAt}`;
      if (refreshedLoopRequests.current.has(identity)) continue;
      refreshedLoopRequests.current.add(identity);
      void client.getDemandLoop(request.loopId).then((page) => acceptLoopPage(page, true)).catch(() => refreshedLoopRequests.current.delete(identity));
    }
  }, [workspace, client, acceptLoopPage]);

  const recoverIdea = useCallback(async (ideaId: string, mutation = false): Promise<DemandIdeaResult | null> => {
    const ticket = historyReader.beginExact(ideaId, mutation);
    if (!ticket) return null;
    try {
      const result = await client.getDemandIdea(ideaId);
      if (!historyReader.acceptExact(ticket, result)) return null;
      setHistory(historyReader.snapshot());
      setIdeaRecoveryErrors((current) => { const next = new Map(current); next.delete(ideaId); return next; });
      return result;
    } catch (error) {
      if (historyReader.exactIsCurrent(ticket)) throw error;
      return null;
    }
  }, [client, historyReader]);
  const returnToOrigin = useCallback((origin: DemandOrigin, intent: number) => {
    if (workspaceIdentityRef.current) setRetainedFeedSet(readingSetMatches(readingSetRef.current, workspaceIdentityRef.current, origin) ? readingSetRef.current : readReadingSet(workspaceIdentityRef.current, origin));
    const loop = origin.view === "loop" ? origin.loopId : PULSE_FOR_YOU_ID;
    activeLoopRef.current = loop ?? PULSE_FOR_YOU_ID;
    setActiveLoopId(activeLoopRef.current);
    setView(origin.view);
    if (origin.history) {
      pendingHistoryReturn.current = origin;
      const { cursor, ...query } = origin.history;
      void loadHistoryPage(query, cursor);
    } else {
      pendingHistoryReturn.current = null;
      historyReader.close(); setHistory(historyReader.snapshot());
      requestAnimationFrame(() => {
        if (navigationIntentRef.current !== intent) return;
        window.scrollTo(0, origin.scrollY);
        const card = origin.ideaId ? document.querySelector<HTMLButtonElement>(`[data-idea-id="${origin.ideaId}"] .demand-idea-open-target`) : null;
        (card ?? readingSurfaceRef.current)?.focus({ preventScroll: true });
      });
    }
  }, [historyReader, loadHistoryPage]);

  const restoreArticleRoute = useCallback(async (selection: DemandRouteSelection, next: DemandWorkspace, intent: number) => {
    setRecoveringContinuity(true);
    setContinuityFailure("");
    const isCurrent = () => navigationIntentRef.current === intent && workspaceIdentityRef.current === next.workspaceId;
    try {
      const result = await readDemandRouteSelection({ selection, workspaceId: next.workspaceId, getArticle: client.getDemandArticle, getIdea: client.getDemandIdea });
      if (!isCurrent()) return;
      const navigation = readRouteNavigation(next.workspaceId, selection);
      const originWorkspace = await workspaceForOrigin(next, navigation?.origin);
      const origin = await resolveDemandOrigin({ navigation, workspace: originWorkspace, selectedIdea: result.idea, getIdea: client.getDemandIdea });
      if (!isCurrent()) return;
      if (origin.recovered) historyReader.seed(origin.recovered);
      historyReader.seed({ workspaceId: result.workspaceId, idea: result.idea, request: result.request });
      setHistory(historyReader.snapshot());
      selectedIdeaRef.current = result.idea.id;
      activeLoopRef.current = result.idea.loopId;
      setSelectedIdeaId(result.idea.id);
      setSelectedRequestId(result.idea.articleRequestId);
      setActiveLoopId(result.idea.loopId);
      setSelectedArticle(result.article);
      setRecoveredLoop(result.loop);
      setCreateOpen(false); setAskOpen(false); setShareOpen(false);
      setResultLoadFailed(false);
      setPageError(result.idea.articleRequestId ? "" : "The article request hasn’t been confirmed. Check its status to recover it; no new article will be requested.");
      articlePositionRef.current = demandReadingPositionForIdea(readingPositionsRef.current, next.workspaceId, result.idea);
      restoringArticleRef.current = result.idea.id;
      setReturnTarget(origin.origin);
      readingSetRef.current = readingSetMatches(readingSetRef.current, next.workspaceId, origin.origin) ? readingSetRef.current : readReadingSet(next.workspaceId, origin.origin); setReadingSet(readingSetRef.current);
      if (origin.origin.history) {
        const { cursor, ...query } = origin.origin.history;
        void loadHistoryPage(query, cursor);
      }
      setView(result.article ? "article" : "request");
      continuityRestored.current = true;
      setRecoveringContinuity(false);
    } catch (error) {
      if (!isCurrent()) return;
      setContinuityFailure(readableError(error)); setRecoveringContinuity(false);
    }
  }, [client, historyReader, loadHistoryPage, workspaceForOrigin]);
  const readingRecords = useMemo(() => demandHistoryRecords(workspace, history), [workspace, history]);
  const historyQuery: HistoryScope | null = view === "library" ? { scope: "saved" }
    : view === "home" ? { scope: "all" } : view === "loop" ? { scope: "all", loopId: activeLoopId } : null;
  const visibleHistory = historyQuery && history.window && demandHistoryScopeKey(historyQuery) === demandHistoryScopeKey(history.window.query) ? history.window : null;
  useEffect(() => {
    const target = pendingHistoryReturn.current;
    if (!target?.history || !visibleHistory?.page || visibleHistory.cursor !== target.history.cursor ||
      demandHistoryScopeKey(visibleHistory.query) !== demandHistoryScopeKey(target.history)) return;
    pendingHistoryReturn.current = null;
    const intent = navigationIntentRef.current;
    const frame = requestAnimationFrame(() => {
      if (navigationIntentRef.current !== intent) return;
      window.scrollTo(0, target.scrollY);
      (target.ideaId ? document.querySelector<HTMLButtonElement>(`[data-idea-id="${target.ideaId}"] .demand-idea-open-target`) ?? readingSurfaceRef.current : readingSurfaceRef.current)?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [visibleHistory]);

  useEffect(() => {
    let current = true;
    // Captured by initial mount or an explicit Retry, before either network wait.
    // A newer destination never grants this old restoration a new intent.
    const isCurrentIntent = () => current && navigationIntentRef.current === continuityIntent;
    const failRestoration = (error: unknown) => {
      setContinuityFailure(readableError(error));
      setRecoveringContinuity(false);
    };
    const restore = async (next: DemandWorkspace) => {
      if (!current) return;
      publishWorkspace(workspaceResponses.hydrate(next));
      accountRecoveryAllowed.current = false;
      setCanContinueAccount(false);
      setLoading(false);
      if (!isCurrentIntent()) return;
      continuityRestored.current = false;
      let raw: string | null = null;
      let positions: string | null = null;
      try {
        raw = localStorage.getItem("edison:demand:continuity:v1");
        positions = localStorage.getItem("edison:demand:reading-positions:v1");
      } catch { /* A fresh session remains usable. */ }
      readingPositionsRef.current = restoreDemandReadingPositions(positions, next.workspaceId);
      setCreateDraft(readDraft("create", next.workspaceId, 500));
      createAttemptRef.current = readStoredAttempt("create", next.workspaceId);
      const selection = parseDemandRoute(window.location.pathname, window.location.search) ?? initialSelectionRef.current;
      if (selection) {
        initialSelectionRef.current = selection;
        await restoreArticleRoute(selection, next, continuityIntent);
        return;
      }
      const routeNavigation = readRouteNavigation(next.workspaceId);
      if (routeNavigation && routeNavigation.selection === null) {
        const originWorkspace = await workspaceForOrigin(next, routeNavigation.origin);
        if (!isCurrentIntent()) return;
        continuityRestored.current = true;
        returnToOrigin(availableDemandOrigin(routeNavigation.origin, originWorkspace), continuityIntent);
        return;
      }
      setContinuityFailure("");
      setRecoveringContinuity(true);
      await restoreCurrentDemandContinuity({ raw, workspace: next, getIdea: client.getDemandIdea,
        isCurrent: () => isCurrentIntent() && workspaceIdentityRef.current === next.workspaceId,
        onFailure: failRestoration,
        onRestored: (recovered) => {
          for (const result of recovered.recovered) historyReader.seed(result);
          setHistory(historyReader.snapshot());
          const saved = recovered.saved;
          setRecoveringContinuity(false);
          continuityRestored.current = true;
          if (saved) {
            activeLoopRef.current = saved.activeLoopId;
            setActiveLoopId(saved.activeLoopId);
            setView(saved.view === "article" ? "request" : saved.view);
            setReturnTarget(saved.origin);
            setSelectedIdeaId(saved.selectedIdeaId);
            selectedIdeaRef.current = saved.selectedIdeaId;
            const idea = next.ideas.find(({ id }) => id === saved.selectedIdeaId) ?? recovered.recovered.find(({ idea }) => idea.id === saved.selectedIdeaId)?.idea;
            setSelectedRequestId(idea?.articleRequestId ?? null);
            const restoredPosition = restoredDemandArticlePosition(saved);
            articlePositionRef.current = restoredPosition ?? 0;
            restoringArticleRef.current = restoredPosition !== null ? saved.selectedIdeaId : null;
            if (saved.history ?? saved.origin?.history) {
              const { cursor, ...query } = (saved.history ?? saved.origin!.history)!;
              void loadHistoryPage(query, cursor);
            } else if (saved.view === "library") void loadHistoryPage({ scope: "saved" }, null);
          } else if (next.loops.some((loop) => !loop.archivedAt)) {
            activeLoopRef.current = next.loops.find((loop) => !loop.archivedAt)!.id;
            setActiveLoopId(activeLoopRef.current);
            setView("loop");
          } else {
            setCreateOpen(true);
          }
        },
      });
    };
    const continueWithAccount = async () => {
      if (!current || !accountRecoveryAllowed.current || accountRecoveryLock.current) return;
      setAccountRecoveryPending(true); setPageError("");
      try { await runDemandAccountRecovery(accountRecoveryLock, client.startDemandAccountSession, restore); }
      catch {
        if (current) setPageError("We couldn’t confirm your account session. Try again when you’re ready. Your earlier reading hasn’t been changed.");
      } finally { if (current) setAccountRecoveryPending(false); }
    };
    accountRecoveryAction.current = continueWithAccount;
    if (initialWorkspace) {
      queueMicrotask(() => { void restore(initialWorkspace); });
      return () => { current = false; if (accountRecoveryAction.current === continueWithAccount) accountRecoveryAction.current = null; };
    }
    void client.startDemandSession().then(restore)
      .catch((error) => {
        if (!isCurrentIntent()) return;
        if (continuityIntent > 0) failRestoration(error);
        else {
          const recoverable = canContinueDemandAccount(error);
          accountRecoveryAllowed.current = recoverable; setCanContinueAccount(recoverable);
          setPageError(recoverable ? "" : readableError(error));
        }
      })
      .finally(() => current && setLoading(false));
    return () => {
      current = false;
      if (accountRecoveryAction.current === continueWithAccount) accountRecoveryAction.current = null;
    };
  }, [client, continuityIntent, historyReader, initialWorkspace, loadHistoryPage, publishWorkspace, restoreArticleRoute, returnToOrigin, workspaceResponses, workspaceForOrigin]);

  useEffect(() => {
    if (!workspace) return;
    const onPopState = () => {
      if (consumeDemandActionOverlayPop(actionOverlayRef.current, window.history, window.location.href, setAllowanceOpen)) return;
      const intent = ++navigationIntentRef.current;
      setAskOpen(false); setShareOpen(false); setCurateOpen(false);
      const selection = parseDemandRoute(window.location.pathname, window.location.search);
      initialSelectionRef.current = selection;
      if (selection) { void restoreArticleRoute(selection, workspace, intent); return; }
      continuityRestored.current = true; setRecoveringContinuity(false); setContinuityFailure("");
      selectedIdeaRef.current = null;
      setSelectedArticle(null); setSelectedIdeaId(null); setSelectedRequestId(null);
      const saved = parseDemandNavigation(window.history.state?.demandNavigation, workspace.workspaceId);
      const origin = saved?.selection === null ? saved.origin : { view: "home" as const, loopId: null, ideaId: null, scrollY: 0 };
      void workspaceForOrigin(workspace, origin).then((next) => { if (navigationIntentRef.current === intent) returnToOrigin(availableDemandOrigin(origin, next), intent); }).catch((error) => { if (navigationIntentRef.current === intent) setContinuityFailure(readableError(error)); });
    };
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, [restoreArticleRoute, returnToOrigin, workspace, workspaceForOrigin]);

  useEffect(() => {
    if (view !== "article" || !selectedArticle || !selectedIdeaId || !workspace || recoveringContinuity) return;
    const current = parseDemandRoute(window.location.pathname, window.location.search);
    const mode = readyRouteHistoryMode(current, selectedIdeaId, selectedArticle.id);
    const origin = returnTarget ?? { view: "home" as const, loopId: null, ideaId: selectedIdeaId, scrollY: 0 };
    const selection = { kind: "article" as const, id: selectedArticle.id };
    const record = navigationForSelection(workspace.workspaceId, origin, selection);
    if (mode !== "none" || JSON.stringify(window.history.state?.demandNavigation) !== JSON.stringify(record)) {
      writeRouteNavigation(record, mode === "none" ? "replace" : mode, demandRouteHref(selection));
    }
    initialSelectionRef.current = selection;
  }, [recoveringContinuity, returnTarget, selectedArticle, selectedIdeaId, view, workspace]);

  useEffect(() => {
    if (!workspace || !continuityRestored.current) return;
    const persist = () => {
      // A late scroll event from leaving an article must not record the feed's
      // position against the article. Navigation clears this scope synchronously.
      if (view === "article" && selectedIdeaRef.current === selectedIdeaId && restoringArticleRef.current !== selectedIdeaId) {
        articlePositionRef.current = window.scrollY;
        const idea = readingRecords.ideas.find(({ id }) => id === selectedIdeaId);
        if (idea) readingPositionsRef.current = rememberDemandReadingPosition(readingPositionsRef.current, workspace.workspaceId, idea, window.scrollY);
      }
      const reading = view === "article" || view === "request";
      const saved: DemandContinuity = { version: 1, workspaceId: workspace.workspaceId, view,
        activeLoopId: view === "home" ? PULSE_FOR_YOU_ID : activeLoopId,
        selectedIdeaId: reading ? selectedIdeaId : null,
        origin: reading ? returnTarget : null, articleScrollY: reading ? articlePositionRef.current : 0 };
      if (visibleHistory) saved.history = { ...visibleHistory.query, cursor: visibleHistory.cursor };
      try {
        localStorage.setItem("edison:demand:continuity:v1", JSON.stringify(saved));
        if (readingPositionsRef.current?.workspaceId === workspace.workspaceId) {
          localStorage.setItem("edison:demand:reading-positions:v1", JSON.stringify(readingPositionsRef.current));
        }
      } catch { /* Optional device continuity. */ }
    };
    persist();
    window.addEventListener("scroll", persist, { passive: true });
    window.addEventListener("pagehide", persist);
    return () => { window.removeEventListener("scroll", persist); window.removeEventListener("pagehide", persist); };
  }, [activeLoopId, readingRecords.ideas, returnTarget, selectedIdeaId, view, visibleHistory, workspace]);

  const hasRunningRequest = Boolean(
    workspace?.requests.some(({ status }) => status === "queued" || status === "running"),
  );
  useEffect(() => {
    if (!hasRunningRequest) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const ticket = workspaceResponses.beginPoll();
      try {
        const next = await client.getDemandWorkspace();
        if (!current) return;
        const accepted = workspaceResponses.acceptPoll(ticket, next);
        publishWorkspace(accepted);
      } catch (error) {
        if (current && workspaceResponses.isCurrentPoll(ticket)) setPageError(readableError(error));
      } finally {
        if (current) timer = setTimeout(refresh, 2_000);
      }
    };
    timer = setTimeout(refresh, 1_200);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [client, hasRunningRequest, publishWorkspace, workspaceResponses]);

  const selectedRequest = readingRecords.requests.find(({ id }) => id === selectedRequestId);
  const selectedRequestStatus = selectedRequest?.status;
  const selectedRequestIdeaId = selectedRequest?.ideaId;
  const historyPollKey = history.window ? `${demandHistoryScopeKey(history.window.query)}:${history.window.cursor ?? "latest"}` : null;
  const historicalPending = Boolean(history.window?.page?.requests.some(({ status }) => status === "queued" || status === "running"));
  useEffect(() => {
    if (!historyPollKey || !historicalPending) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      const window = historyReader.snapshot().window;
      if (!window || `${demandHistoryScopeKey(window.query)}:${window.cursor ?? "latest"}` !== historyPollKey) return;
      await loadHistoryPage(window.query, window.cursor, true);
      if (current) timer = setTimeout(refresh, 2_000);
    };
    timer = setTimeout(refresh, 2_000);
    return () => { current = false; clearTimeout(timer); };
  }, [historicalPending, historyPollKey, historyReader, loadHistoryPage]);

  const selectedPendingOutsidePage = Boolean(selectedIdeaId && (selectedRequestStatus === "queued" || selectedRequestStatus === "running") &&
    !history.window?.page?.requests.some(({ id }) => id === selectedRequestId));
  useEffect(() => {
    if (!selectedIdeaId || !selectedPendingOutsidePage || (view !== "request" && view !== "article")) return;
    const ideaId = selectedIdeaId;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      try { await recoverIdea(ideaId); }
      catch (error) { if (current && selectedIdeaRef.current === ideaId) setPageError(readableError(error)); }
      if (current) timer = setTimeout(refresh, 2_000);
    };
    timer = setTimeout(refresh, 2_000);
    return () => { current = false; clearTimeout(timer); };
  }, [recoverIdea, selectedIdeaId, selectedPendingOutsidePage, view]);
  useEffect(() => {
    if (
      view !== "request" ||
      !selectedRequestId ||
      !selectedIdeaId ||
      (selectedRequestStatus && (selectedRequestStatus !== "succeeded" || selectedRequestIdeaId !== selectedIdeaId))
    ) return;
    const resultIdeaId = selectedIdeaId;
    let current = true;
    void client.getDemandResult(selectedRequestId)
      .then((result) => {
        if (!current || selectedIdeaRef.current !== resultIdeaId) return;
        if (result.request.ideaId !== resultIdeaId) throw new Error("Edison returned a different article request.");
        publishWorkspace(workspaceResponses.recoverRequest(result.request));
        if (!result.article) {
          if (result.request.status === "succeeded") throw new Error("Edison returned a ready request without its article.");
          return;
        }
        setSelectedArticle(result.article);
        setResultLoadFailed(false);
        setPageError("");
        setView("article");
      })
      .catch((error) => {
        if (!current || selectedIdeaRef.current !== resultIdeaId) return;
        setResultLoadFailed(true);
        setPageError(readableError(error));
      });
    return () => {
      current = false;
    };
  }, [client, publishWorkspace, resultLoadNonce, selectedIdeaId, selectedRequestIdeaId, selectedRequestStatus, selectedRequestId, view, workspaceResponses]);

  const feedbackRequest = workspace?.requests.find(({ id }) => id === feedbackRequestId);
  useEffect(() => {
    if (
      !feedbackRequestId ||
      !feedbackRequest ||
      feedbackRequest.loopId !== curateLoopId ||
      (feedbackRequest.status !== "succeeded" && feedbackRequest.status !== "failed")
    ) return;
    let current = true;
    if (feedbackRequest.status === "failed") {
      queueMicrotask(() => {
        if (!current || curateLoopRef.current !== feedbackRequest.loopId) return;
        setFeedbackError(feedbackRequest.failure?.message ?? "Edison couldn’t update this loop. Your feedback is still here.");
        writePendingRequest("feedback", feedbackRequest.loopId, null);
        writeStoredAttempt("feedback", feedbackRequest.loopId, null);
        setFeedbackRequestId(null);
      });
      return () => {
        current = false;
      };
    }
    queueMicrotask(() => {
      if (!current || curateLoopRef.current !== feedbackRequest.loopId) return;
      const submission = submittedFeedbackRefs.current.get(feedbackRequest.loopId) ?? readSubmittedFeedback(feedbackRequest.loopId);
      setFeedbackDraft((draft) => clearsSubmittedDemandFeedback(submission, feedbackRequest.id, draft) ? "" : draft);
      if (clearsSubmittedDemandFeedback(submission, feedbackRequest.id, readDraft("feedback", feedbackRequest.loopId, 500))) writeDraft("feedback", feedbackRequest.loopId, "");
      writePendingRequest("feedback", feedbackRequest.loopId, null);
      writeStoredAttempt("feedback", feedbackRequest.loopId, null);
      setFeedbackStatus(submission?.operation === "undo" ? "Previous loop update undone." : "Loop updated.");
      setFeedbackRequestId(null);
    });
    return () => {
      current = false;
    };
  }, [curateLoopId, feedbackRequest, feedbackRequestId]);

  useEffect(() => {
    if (!workspace) return;
    for (const loop of workspace.loops) {
      const requestId = readPendingRequest("feedback", loop.id);
      if (!requestId) continue;
      const request = workspace.requests.find(({ id }) => id === requestId);
      if (!request || request.status === "queued" || request.status === "running") continue;
      const submission = submittedFeedbackRefs.current.get(loop.id) ?? readSubmittedFeedback(loop.id);
      if (request.status === "succeeded" && clearsSubmittedDemandFeedback(submission, request.id, readDraft("feedback", loop.id, 500))) writeDraft("feedback", loop.id, "");
      writePendingRequest("feedback", loop.id, null);
      writeStoredAttempt("feedback", loop.id, null);
    }
  }, [workspace]);

  useEffect(() => {
    if (view !== "article" || !selectedArticle || !selectedIdeaId) return;
    const restoredPosition = restoringArticleRef.current === selectedIdeaId ? articlePositionRef.current : 0;
    window.scrollTo(0, restoredPosition);
    articlePositionRef.current = restoredPosition;
    restoringArticleRef.current = null;
    if (!openedIdeas.current.has(selectedIdeaId)) {
      openedIdeas.current.add(selectedIdeaId);
      void client.updateDemandIdeaEvent(selectedIdeaId, {
        type: "opened",
        idempotencyKey: `opened:${selectedIdeaId}`,
      }).catch(() => openedIdeas.current.delete(selectedIdeaId));
    }

    const reported = new Set<number>();
    const reportProgress = () => {
      const available = document.documentElement.scrollHeight - window.innerHeight;
      if (available <= 0) return;
      const progress = Math.min(100, Math.max(0, Math.round((window.scrollY / available) * 100)));
      const bucket = [100, 75, 50, 25].find((value) => progress >= value);
      if (!bucket || reported.has(bucket)) return;
      reported.add(bucket);
      void client.updateDemandIdeaEvent(selectedIdeaId, {
        type: "progress",
        progress: bucket,
        idempotencyKey: `progress:${selectedIdeaId}:${bucket}`,
      }).catch(() => reported.delete(bucket));
    };
    window.addEventListener("scroll", reportProgress, { passive: true });
    reportProgress();
    return () => window.removeEventListener("scroll", reportProgress);
  }, [client, selectedArticle, selectedIdeaId, view]);

  const projection = useMemo(() => loopProjection(workspace, loopPages), [workspace, loopPages]);
  const activeLoop = projection.loops.find(({ id }) => id === activeLoopId) ?? (recoveredLoop?.id === activeLoopId ? recoveredLoop : null);
  const curateLoop = projection.loops.find(({ id }) => id === curateLoopId) ?? null;
  const combinedIdeas = useMemo(() => {
    if (!workspace) return [];
    return currentReadingArticles(projection.loops, projection.ideas, projection.requests).map((idea) => readingRecords.ideas.find(({ id }) => id === idea.id) ?? idea);
  }, [readingRecords.ideas, workspace, projection]);
  useEffect(() => {
    if (!workspace) return;
    for (const [loopId, previous] of requestedBatches.current) {
      if (!previous.requestId) continue; // Admission must identify this operation before an older completed batch can settle it.
      const request = previous.requestId ? projection.requests.find(({ id }) => id === previous.requestId) : latestRequest({ ...workspace, requests: projection.requests }, loopId, "ideas");
      if (previous.previousFailureTime && request?.status === "failed" && request.updatedAt === previous.previousFailureTime) continue;
      if (!request || request.id === previous.previousRequestId || request.status === "queued" || request.status === "running") continue;
      const added = acceptedIdeaArrival(projection.ideas, request, previous.ids);
      if (request.status === "succeeded") {
        setNewIdeas((current) => new Map(current).set(loopId, added));
        if (added.length && view === "loop" && activeLoopId === loopId) setRetainedFeedSet(null);
      }
      else setNewIdeas((current) => { const next = new Map(current); next.delete(loopId); return next; });
      requestedBatches.current.delete(loopId);
    }
  }, [combinedIdeas, workspace, view, activeLoopId, projection]);
  useEffect(() => {
    if (!workspace) return;
    const offWindow = offWindowPendingLoops(workspace, projection.requests, requestedBatches.current.keys());
    if (!offWindow.length) return;
    let current = true;
    let timer: ReturnType<typeof setTimeout>;
    const refresh = async () => {
      await Promise.all([...offWindow].map(async (loopId) => {
        try { const page = await client.getDemandLoop(loopId); if (current) acceptLoopPage(page, true); }
        catch (error) { if (current) setLoopsError(readableError(error)); }
      }));
      if (current) timer = setTimeout(() => void refresh(), 2000);
    };
    timer = setTimeout(() => void refresh(), 1500);
    return () => { current = false; clearTimeout(timer); };
  }, [workspace, projection, client, acceptLoopPage, ideasSubmittingLoopId]);
  const retainedIdeas = retainedFeedSet && retainedFeedSet.workspaceId === workspace?.workspaceId && retainedFeedSet.view === view && (view !== "loop" || retainedFeedSet.loopId === activeLoopId)
    ? retainedFeedSet.ideas.map((idea) => readingRecords.ideas.find(({ id }) => id === idea.id) ?? idea) : null;
  const feedIdeas = retainedIdeas ?? combinedIdeas;
  const activeIdeas = feedIdeas.filter(({ loopId: owner }) => owner === activeLoopId);
  const ideaById = new Map(readingRecords.ideas.map((idea) => [idea.id, idea]));
  const requestById = new Map([...projection.requests, ...readingRecords.requests].map((request) => [request.id, request]));
  const selectedIdea = selectedIdeaId ? ideaById.get(selectedIdeaId) ?? null : null;

  function openAllowance() {
    allowanceOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (workspace?.allowance?.remaining === 0 || hasPendingReset) showActionOverlay("allowance");
    else { openWorkspaceView("profile"); setAccountSection("usage"); }
  }
  function openAccountUsage() { openWorkspaceView("profile"); setAccountSection("usage"); }
  function showActionOverlay(kind: "allowance") {
    allowanceOpenerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    openDemandActionOverlay(actionOverlayRef.current, kind, window.history, window.location.href, setAllowanceOpen);
  }
  function closeActionOverlay() {
    closeDemandActionOverlay(actionOverlayRef.current, window.history, setAllowanceOpen);
  }

  function gateArticleAction() {
    if (workspace?.readerKind !== "account") { setPageError("Edison is invite-only. Sign in through your invitation to continue."); return false; }
    if (workspace?.allowance?.remaining === 0) { openAllowance(); return false; }
    if (workspace?.allowance && workspace.allowance.available === 0) { setPageError("Your remaining articles are already being prepared. They’ll appear when ready; your existing reading is still here."); return false; }
    return true;
  }

  function rememberCurrentReadingPosition() {
    if (view !== "article" || !workspace || !selectedIdea || selectedIdeaRef.current !== selectedIdea.id) return;
    readingPositionsRef.current = rememberDemandReadingPosition(readingPositionsRef.current, workspace.workspaceId, selectedIdea, window.scrollY);
    try { localStorage.setItem("edison:demand:reading-positions:v1", JSON.stringify(readingPositionsRef.current)); } catch { /* Keep in-memory continuity if storage is unavailable. */ }
  }

  function beginNavigation() {
    navigationIntentRef.current++;
    continuityRestored.current = true;
    setRecoveringContinuity(false);
    setContinuityFailure("");
    setPageError("");
    initialSelectionRef.current = null;
  }
  function showLatestArticles() {
    setRetainedFeedSet(null);
    if (workspace && (view === "loop" || view === "home")) writeRouteNavigation(navigationForSelection(workspace.workspaceId,
      { view, loopId: view === "loop" ? activeLoopId : null, ideaId: null, scrollY: window.scrollY }, null), "replace", "/");
  }

  function retryContinuityRestoration() {
    continuityRestored.current = false;
    setContinuityFailure("");
    setRecoveringContinuity(true);
    setContinuityIntent(++navigationIntentRef.current);
  }

  async function commissionIdeas(loop: DemandLoop) {
    const owner = `${workspace?.workspaceId}:${loop.id}`;
    const stored = readStoredAttempt("ideas", owner);
    if (!stored && !gateArticleAction()) return;
    const fingerprint = stored?.fingerprint ?? `${loop.id}:${loop.revision}`;
    let attempt = ideasAttemptRefs.current.get(loop.id) ?? stored;
    if (attempt?.inFlight) return;
    if (attempt?.fingerprint !== fingerprint) {
      attempt = {
        fingerprint,
        idempotencyKey: idempotencyKey("ideas"),
        inFlight: false,
      };
      ideasAttemptRefs.current.set(loop.id, attempt);
    }
    attempt.inFlight = true;
    ideasAttemptRefs.current.set(loop.id, attempt);
    writeStoredAttempt("ideas", owner, attempt);
    requestedBatches.current.set(loop.id, { ids: new Set(combinedIdeas.filter((idea) => idea.loopId === loop.id).map((idea) => idea.id)), previousRequestId: workspace ? latestRequest({ ...workspace, requests: projection.requests }, loop.id, "ideas")?.id ?? null : null });
    setNewIdeas((current) => { const next = new Map(current); next.delete(loop.id); return next; });
    setIdeasSubmittingLoopId(loop.id);
    setPageError("");
    const ticket = workspaceResponses.beginMutation();
    historyReader.invalidateMutation();
    setHistory(historyReader.snapshot());
    try {
      const response = await client.requestDemandIdeas(loop.id, {
        baseRevision: Number(attempt.fingerprint.split(":").at(-1)),
        idempotencyKey: attempt.idempotencyKey,
      });
      const tracked = requestedBatches.current.get(loop.id);
      if (tracked && response.requestId) tracked.requestId = response.requestId;
      if (stored && tracked?.previousRequestId === response.requestId) { requestedBatches.current.delete(loop.id); setAllowanceStatus("Refresh confirmed. Your current articles are unchanged."); }
      publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace));
      if (readStoredAttempt("ideas", owner)?.idempotencyKey === attempt.idempotencyKey) writeStoredAttempt("ideas", owner, null);
      if (ideasAttemptRefs.current.get(loop.id) === attempt) {
        ideasAttemptRefs.current.delete(loop.id);
      }
    } catch (error) {
      const rejected = error && typeof error === "object" && "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 408;
      if (rejected) { if (readStoredAttempt("ideas", owner)?.idempotencyKey === attempt.idempotencyKey) writeStoredAttempt("ideas", owner, null); ideasAttemptRefs.current.delete(loop.id); requestedBatches.current.delete(loop.id); }
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      if (code === "account_required") setPageError("Your sign-in needs to be verified. Edison is invite-only; your reading is still saved.");
      else if (code === "allowance_exhausted") { void client.getDemandWorkspace().then((next) => { publishWorkspace(workspaceResponses.hydrate(next)); if (next.allowance?.remaining === 0) showActionOverlay("allowance"); }).catch((error) => setPageError(readableError(error))); }
      if (activeLoopRef.current === loop.id) setPageError(rejected ? readableError(error) : `We couldn’t confirm the refresh. Use Refresh articles to check the same request. ${readableError(error)}`);
    } finally {
      workspaceResponses.finishMutation(ticket);
      attempt.inFlight = false;
      setIdeasSubmittingLoopId((current) => current === loop.id ? null : current);
    }
  }

  async function createLoopAndIdeas() {
    if (!createDraft.trim()) return;
    if (workspace && !createAttemptRef.current) createAttemptRef.current = readStoredAttempt("create", workspace.workspaceId);
    if (!createAttemptRef.current && !gateArticleAction()) return;
    const submittedDraft = createDraft;
    const curiosity = createAttemptRef.current?.fingerprint ?? createDraft.trim();
    const attempt = beginAttempt(createAttemptRef, curiosity, "create-loop");
    if (!attempt) return;
    if (workspace) writeStoredAttempt("create", workspace.workspaceId, attempt);
    setCreatePending(true);
    setCreateError("");
    let createdLoop = false;
    const ticket = workspaceResponses.beginMutation();
    try {
      const created = await client.createDemandLoop({
        curiosity,
        idempotencyKey: attempt.idempotencyKey,
      });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, created.workspace))) return;
      let loop = created.workspace.loops.find(
        ({ id }) => !workspace?.loops.some((existing) => existing.id === id),
      ) ?? created.workspace.loops.find(
        ({ originalCuriosity }) =>
          originalCuriosity.trim().toLocaleLowerCase() === curiosity.toLocaleLowerCase(),
      );
      if (!loop && created.requestId) {
        const recovered = await recoverCreatedLoop(created.requestId, created.workspace.workspaceId, client.getDemandResult, client.getDemandLoop);
        const page = recovered.page;
        if (!acceptLoopPage(page, true)) throw new Error("Your reading workspace changed.");
        loop = recovered.loop;
      }
      if (!loop) throw new Error("Edison did not return the new loop.");
      createdLoop = true;
      if (workspace && readStoredAttempt("create", workspace.workspaceId)?.idempotencyKey === attempt.idempotencyKey) writeStoredAttempt("create", workspace.workspaceId, null);
      activeLoopRef.current = loop.id;
      setActiveLoopId(loop.id);
      setView("loop");
      setRetainedFeedSet(null);
      writeRouteNavigation(navigationForSelection(created.workspace.workspaceId, { view: "loop", loopId: loop.id, ideaId: null, scrollY: 0 }, null), "push", "/");
      if (submittedDraft.trim() === curiosity) { setCreateDraft(""); if (workspace) writeDraft("create", workspace.workspaceId, ""); }
      setCreateOpen(false);
      const existingIdeas = created.workspace.ideas.some(({ loopId }) => loopId === loop.id);
      const existingIdeasRequest = created.workspace.requests.some(
        ({ loopId, kind }) => loopId === loop.id && kind === "ideas",
      );
      if (!created.requestId && !existingIdeas && !existingIdeasRequest) {
        await commissionIdeas(loop);
      }
    } catch (error) {
      const code = error && typeof error === "object" && "code" in error ? error.code : null;
      const rejected = error && typeof error === "object" && "status" in error && typeof error.status === "number" && error.status >= 400 && error.status < 500 && error.status !== 408;
      if (rejected) { if (workspace && readStoredAttempt("create", workspace.workspaceId)?.idempotencyKey === attempt.idempotencyKey) writeStoredAttempt("create", workspace.workspaceId, null); if (createAttemptRef.current === attempt) createAttemptRef.current = null; }
      if (code === "account_required") setPageError("Your sign-in needs to be verified. Edison is invite-only; your draft is still here.");
      if (code === "allowance_exhausted") void client.getDemandWorkspace().then((next) => { publishWorkspace(workspaceResponses.hydrate(next)); if (next.allowance?.remaining === 0) showActionOverlay("allowance"); }).catch((error) => setPageError(readableError(error)));
      setCreateError(readableError(error));
    } finally {
      workspaceResponses.finishMutation(ticket);
      finishAttempt(createAttemptRef, attempt, createdLoop);
      setCreatePending(false);
    }
  }

  async function askForIdeas(loop: DemandLoop) {
    await commissionIdeas(loop);
  }

  async function openIdea(inputIdea: DemandIdea) {
    const idea = demandHistoryRecords(workspace, historyReader.snapshot()).ideas.find(({ id }) => id === inputIdea.id) ?? inputIdea;
    rememberCurrentReadingPosition();
    beginNavigation();
    setAskOpen(false);
    setShareOpen(false);
    const fromFeed = view === "loop" || view === "library" || view === "home";
    const origin: ReturnTarget = fromFeed
      ? { view, loopId: view === "loop" ? activeLoopId : null, scrollY: window.scrollY, ideaId: idea.id,
          ...(visibleHistory ? { history: { ...visibleHistory.query, cursor: visibleHistory.cursor } } : {}) }
      : returnTarget ?? { view: "home", loopId: null, scrollY: 0, ideaId: idea.id };
    setReturnTarget(origin);
    if (workspace && fromFeed && !visibleHistory && (view === "home" || view === "loop")) {
      const snapshot: ReadingSet = { workspaceId: workspace.workspaceId, originIdeaId: idea.id, view, loopId: origin.loopId, ideas: view === "loop" ? activeIdeas : feedIdeas };
      readingSetRef.current = snapshot; setReadingSet(snapshot); storeReadingSet(snapshot);
    }
    if (workspace) {
      if (fromFeed) writeRouteNavigation(navigationForSelection(workspace.workspaceId, origin, null), "replace", window.location.pathname + window.location.search);
      const selection = { kind: "idea" as const, id: idea.id };
      writeRouteNavigation(navigationForSelection(workspace.workspaceId, origin, selection), "push", demandRouteHref(selection));
    }
    articlePositionRef.current = demandReadingPositionForIdea(readingPositionsRef.current, workspace?.workspaceId ?? "", idea);
    restoringArticleRef.current = idea.articleRequestId ? idea.id : null;
    selectedIdeaRef.current = idea.id;
    if (workspace) {
      historyReader.seed({ workspaceId: workspace.workspaceId, idea, request: idea.articleRequestId ? requestById.get(idea.articleRequestId) ?? null : null });
      setHistory(historyReader.snapshot());
    }
    activeLoopRef.current = idea.loopId;
    setSelectedIdeaId(idea.id);
    setSelectedRequestId(idea.articleRequestId);
    setSelectedArticle(null);
    setResultLoadFailed(false);
    setPageError("");
    setActiveLoopId(idea.loopId);
    window.scrollTo(0, 0);
    if (idea.articleRequestId) {
      // The selected-request effect recovers this exact retained ID even when
      // it is outside the bounded workspace. Opening never recommissions it.
      setView("request");
      return;
    }
    setView("request");
    let attempt = articleAttemptRefs.current.get(idea.id);
    if (!attempt && workspace) {
      const stored = readStoredAttempt("article", `${workspace.workspaceId}:${idea.id}`);
      if (stored?.fingerprint === idea.id) attempt = stored;
    }
    if (!attempt) {
      attempt = {
        fingerprint: idea.id,
        idempotencyKey: idempotencyKey("article"),
        inFlight: false,
      };
      articleAttemptRefs.current.set(idea.id, attempt);
    }
    if (attempt.inFlight) return;
    attempt.inFlight = true;
    articleAttemptRefs.current.set(idea.id, attempt);
    if (workspace) writeStoredAttempt("article", `${workspace.workspaceId}:${idea.id}`, attempt);
    let commissioned = false;
    const ticket = workspaceResponses.beginMutation();
    historyReader.invalidateMutation(idea.id);
    setHistory(historyReader.snapshot());
    try {
      const response = await client.requestDemandArticle(idea.id, {
        idempotencyKey: attempt.idempotencyKey,
      });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) return;
      if (!response.requestId) throw new Error("Edison did not return the article request.");
      commissioned = true;
      if (workspace) writeStoredAttempt("article", `${workspace.workspaceId}:${idea.id}`, null);
      historyReader.seed({ workspaceId: response.workspace.workspaceId, idea: { ...idea, articleRequestId: response.requestId },
        request: response.workspace.requests.find(({ id }) => id === response.requestId) ?? null }, true);
      setHistory(historyReader.snapshot());
      if (selectedIdeaRef.current === idea.id) setSelectedRequestId(response.requestId);
      const exact = await recoverIdea(idea.id, true);
      if (exact && selectedIdeaRef.current === idea.id) {
        if (!exact.idea.articleRequestId) throw new Error("The article request is saved. Reload this idea to recover its status.");
        setSelectedRequestId(exact.idea.articleRequestId);
      }
    } catch (error) {
      if (selectedIdeaRef.current === idea.id) setPageError(readableError(error));
      if (commissioned && workspaceIdentityRef.current === workspace?.workspaceId) setIdeaRecoveryErrors((current) => new Map([...current, [idea.id, readableError(error)] as const].slice(-24)));
    } finally {
      workspaceResponses.finishMutation(ticket);
      historyReader.finishMutation(idea.id);
      setHistory(historyReader.snapshot());
      attempt.inFlight = false;
      if (commissioned && articleAttemptRefs.current.get(idea.id) === attempt) {
        articleAttemptRefs.current.delete(idea.id);
      }
    }
  }

  async function toggleIdeaSave(idea: DemandIdea) {
    if (savingIdeaIds.current.has(idea.id)) return;
    savingIdeaIds.current.add(idea.id);
    setSavingIdeas((current) => new Set(current).add(idea.id));
    setPageError("");
    const ticket = workspaceResponses.beginMutation({ savedIdeaId: idea.id });
    historyReader.invalidateMutation(idea.id);
    setHistory(historyReader.snapshot());
    try {
      const response = await client.updateDemandIdeaEvent(idea.id, {
        type: "saved",
        saved: !idea.saved,
        idempotencyKey: idempotencyKey("save-idea"),
      });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) return;
      await recoverIdea(idea.id, true);
    } catch (error) {
      if (workspaceIdentityRef.current === workspace?.workspaceId) setIdeaRecoveryErrors((current) => new Map([...current, [idea.id, readableError(error)] as const].slice(-24)));
    } finally {
      workspaceResponses.finishMutation(ticket);
      historyReader.finishMutation(idea.id);
      setHistory(historyReader.snapshot());
      savingIdeaIds.current.delete(idea.id);
      setSavingIdeas((current) => { const next = new Set(current); next.delete(idea.id); return next; });
    }
  }

  async function submitFeedback(operation: "apply" | "undo") {
    const activeLoop = curateLoop;
    if (!activeLoop || feedbackSubmittingLoopId === activeLoop.id ||
        (feedbackRequestId && feedbackRequest?.loopId === activeLoop.id)) return;
    const fingerprint = JSON.stringify(operation === "apply"
      ? [activeLoop.id, operation, activeLoop.revision, feedbackDraft.trim()]
      : [activeLoop.id, operation, activeLoop.revision, activeLoop.lastMutationId]);
    if (!feedbackAttemptRefs.current.has(activeLoop.id)) {
      const stored = readStoredAttempt("feedback", activeLoop.id);
      if (stored) feedbackAttemptRefs.current.set(activeLoop.id, stored);
    }
    const attempt = beginScopedAttempt(feedbackAttemptRefs, activeLoop.id, fingerprint, "feedback");
    if (!attempt) return;
    writeStoredAttempt("feedback", activeLoop.id, attempt);
    setFeedbackSubmittingLoopId(activeLoop.id);
    setFeedbackError("");
    setFeedbackStatus("");
    let accepted = false;
    const submission: SubmittedDemandFeedback = { operation, text: feedbackDraft, requestId: null };
    submittedFeedbackRefs.current.set(activeLoop.id, submission);
    writeSubmittedFeedback(activeLoop.id, submission);
    const ticket = workspaceResponses.beginMutation();
    try {
      const response = await client.applyDemandFeedback(
        activeLoop.id,
        operation === "apply"
          ? {
              operation,
              text: feedbackDraft,
              baseRevision: activeLoop.revision,
              idempotencyKey: attempt.idempotencyKey,
            }
          : {
              operation,
              mutationId: activeLoop.lastMutationId!,
              baseRevision: activeLoop.revision,
              idempotencyKey: attempt.idempotencyKey,
            },
      );
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) return;
      accepted = true;
      submission.requestId = response.requestId ?? null;
      writeSubmittedFeedback(activeLoop.id, submission);
      if (response.requestId) {
        writePendingRequest("feedback", activeLoop.id, response.requestId);
      }
      if (response.requestId) {
        if (curateLoopRef.current === activeLoop.id) setFeedbackRequestId(response.requestId);
      } else {
        if (operation === "apply" && readDraft("feedback", activeLoop.id, 500) === submission.text) writeDraft("feedback", activeLoop.id, "");
        if (curateLoopRef.current === activeLoop.id) {
          if (operation === "apply") setFeedbackDraft((draft) => draft === submission.text ? "" : draft);
          setFeedbackStatus(operation === "undo" ? "Previous loop update undone." : "Loop updated.");
        }
      }
    } catch (error) {
      if (curateLoopRef.current === activeLoop.id) setFeedbackError(readableError(error));
    } finally {
      workspaceResponses.finishMutation(ticket);
      finishScopedAttempt(feedbackAttemptRefs, activeLoop.id, attempt, accepted);
      setFeedbackSubmittingLoopId((current) => current === activeLoop.id ? null : current);
    }
  }

  async function retryRequest(request: DemandRequest) {
    if (retryingRequestIds.current.has(request.id)) return;
    retryingRequestIds.current.add(request.id);
    if (request.kind === "ideas") {
      requestedBatches.current.set(request.loopId, { ids: new Set(combinedIdeas.map(({ id }) => id)), previousRequestId: null, requestId: request.id, previousFailureTime: request.updatedAt });
      setNewIdeas((current) => { const next = new Map(current); next.delete(request.loopId); return next; });
    }
    setRetryingRequestId(request.id);
    setPageError("");
    const ticket = workspaceResponses.beginMutation();
    if (request.ideaId) historyReader.invalidateMutation(request.ideaId);
    setHistory(historyReader.snapshot());
    const retryWorkspaceId = workspace?.workspaceId;
    const isCurrent = () => workspaceIdentityRef.current === retryWorkspaceId && (request.kind === "article"
      ? selectedIdeaRef.current === request.ideaId
      : activeLoopRef.current === request.loopId && selectedIdeaRef.current === null);
    try {
      await runScopedDemandRequest({
        run: () => client.retryDemandRequest(request.id),
        isCurrent,
        onSharedResult: (response) => { publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace)); },
        onCurrentResult: (response) => {
          if (response.requestId && request.kind === "article") setSelectedRequestId(response.requestId);
        },
        onCurrentError: (error) => setPageError(readableError(error)),
      });
      if (request.ideaId && workspaceIdentityRef.current === retryWorkspaceId) {
        try { await recoverIdea(request.ideaId, true); }
        catch (error) { if (isCurrent()) setPageError(readableError(error)); }
      }
    } finally {
      workspaceResponses.finishMutation(ticket);
      if (request.ideaId) historyReader.finishMutation(request.ideaId);
      setHistory(historyReader.snapshot());
      retryingRequestIds.current.delete(request.id);
      setRetryingRequestId((current) => current === request.id ? null : current);
    }
  }

  function openLoop(loopId: string) {
    if (!projection.loops.some(({ id }) => id === loopId)) return;
    rememberCurrentReadingPosition();
    beginNavigation();
    setRetainedFeedSet(null);
    pendingHistoryReturn.current = null;
    historyReader.close();
    setHistory(historyReader.snapshot());
    setAskOpen(false);
    setShareOpen(false);
    selectedIdeaRef.current = null;
    activeLoopRef.current = loopId;
    setActiveLoopId(loopId);
    setSelectedArticle(null);
    setSelectedIdeaId(null);
    setSelectedRequestId(null);
    setView("loop");
    void client.getDemandLoop(loopId).then((page) => acceptLoopPage(page, true)).catch((error) => setLoopsError(readableError(error)));
    if (workspace) writeRouteNavigation(navigationForSelection(workspace.workspaceId, { view: "loop", loopId, ideaId: null, scrollY: 0 }, null), "push", "/");
  }

  function returnFromReading() {
    rememberCurrentReadingPosition();
    const target: DemandOrigin = returnTarget ?? { view: "home", loopId: null, ideaId: selectedIdeaId, scrollY: 0 };
    beginNavigation();
    setAskOpen(false); setShareOpen(false);
    selectedIdeaRef.current = null;
    setSelectedArticle(null); setSelectedIdeaId(null); setSelectedRequestId(null);
    const origin = workspace ? availableDemandOrigin(target, { ...workspace, loops: projection.loops }) : { view: "home" as const, loopId: null, ideaId: null, scrollY: 0 };
    if (workspace) writeRouteNavigation(navigationForSelection(workspace.workspaceId, origin, null), "push", "/");
    returnToOrigin(origin, navigationIntentRef.current);
  }

  function openWorkspaceView(next: "home" | "library" | "profile") {
    if (next === "profile" && view !== "profile") {
      setAccountSection("profile"); accountReturn.current = { view, loopId: activeLoopId, scrollY: window.scrollY };
      if (workspace && (view === "home" || view === "loop" || view === "library")) writeRouteNavigation(navigationForSelection(workspace.workspaceId, { view, loopId: view === "loop" ? activeLoopId : null, ideaId: null, scrollY: window.scrollY, ...(visibleHistory ? { history: { ...visibleHistory.query, cursor: visibleHistory.cursor } } : {}) }, null), "replace", window.location.pathname + window.location.search);
    }
    rememberCurrentReadingPosition();
    beginNavigation();
    if (next !== "profile") setRetainedFeedSet(null);
    pendingHistoryReturn.current = null;
    if (next === "library") void loadHistoryPage({ scope: "saved" }, null);
    else { historyReader.close(); setHistory(historyReader.snapshot()); }
    setAskOpen(false);
    setShareOpen(false);
    selectedIdeaRef.current = null;
    if (next === "home") {
      activeLoopRef.current = PULSE_FOR_YOU_ID;
      setActiveLoopId(PULSE_FOR_YOU_ID);
    }
    setView(next);
    if (workspace) writeRouteNavigation(navigationForSelection(workspace.workspaceId, { view: next === "library" ? "library" : "home", loopId: null, ideaId: null, scrollY: 0,
      ...(next === "library" ? { history: { scope: "saved" as const, cursor: null } } : {}) }, null), "push", "/");
  }

  function openCreate(event?: { currentTarget: EventTarget | null }) {
    createOpenerRef.current = dialogOpener(event);
    if (!gateArticleAction()) return;
    beginNavigation();
    setCreateOpen(true);
  }

  function openAsk(event?: { currentTarget: EventTarget | null }) {
    if (!selectedIdea || !selectedArticle) return;
    askOpenerRef.current = dialogOpener(event);
    setShareOpen(false);
    setAskOpen(true);
  }

  function chooseFeedbackLoop(loopId: string) {
    const loop = projection.loops.find(({ id }) => id === loopId);
    if (!loop) return;
    setCurateLoopId(loop.id);
    curateLoopRef.current = loop.id;
    setFeedbackDraft(readDraft("feedback", loop.id, 500));
    const markedFeedbackId = readPendingRequest("feedback", loop.id);
    const feedback = workspace?.requests.find(({ id }) => id === markedFeedbackId) ??
      (workspace ? latestRequest(workspace, loop.id, "feedback") : undefined);
    if (feedback && (feedback.status === "queued" || feedback.status === "running")) {
      writePendingRequest("feedback", loop.id, feedback.id);
    }
    setFeedbackRequestId(
      feedback && feedback.status !== "succeeded" ? feedback.id : null,
    );
    setFeedbackError("");
    setFeedbackStatus("");
  }

  function openCurate(event?: { currentTarget: EventTarget | null }) {
    if (!workspace?.loops.length) { openCreate(event); return; }
    curateOpenerRef.current = dialogOpener(event);
    if (!activeLoop || activeLoop.archivedAt) return;
    chooseFeedbackLoop(activeLoop.id);
    setCurateOpen(true);
  }

  async function editLoop(draft: LoopEditDraft, key: string, baseRevision: number) {
    if (!curateLoop) throw new Error("This loop is no longer available.");
    const ticket = workspaceResponses.beginMutation();
    try {
      const response = await client.editDemandLoop(curateLoop.id, { name: draft.name, instructions: draft.instructions, baseRevision, idempotencyKey: key });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) throw new Error("Your reading workspace changed. Please reopen the editor.");
      if (!response.workspace.loops.some((loop) => loop.id === curateLoop.id)) acceptLoopPage(await client.getDemandLoop(curateLoop.id), true);
    } finally { workspaceResponses.finishMutation(ticket); }
  }

  async function deleteLoop(key: string, baseRevision: number) {
    if (!curateLoop) throw new Error("This loop is no longer available.");
    const ticket = workspaceResponses.beginMutation();
    try {
      const response = await client.deleteDemandLoop(curateLoop.id, { baseRevision, idempotencyKey: key, confirmed: true });
      if (!publishWorkspace(workspaceResponses.acceptMutation(ticket, response.workspace))) throw new Error("Your reading workspace changed.");
      acceptLoopPage(await client.getDemandLoop(curateLoop.id), true);
      openWorkspaceView("home");
    } finally { workspaceResponses.finishMutation(ticket); }
  }

  function ideaSaveBlocked(ideaId: string) {
    return savingIdeas.has(ideaId) || ideaRecoveryErrors.has(ideaId);
  }

  function renderIdeaRecoveryErrors(ideas: DemandIdea[]) {
    return ideas.filter(({ id }) => ideaRecoveryErrors.has(id)).map((idea) => (
      <div key={idea.id} className="demand-page-error" role="alert">
        <p>{idea.title}: {ideaRecoveryErrors.get(idea.id)}</p>
        <button type="button" className="demand-text-action" onClick={() => {
          void recoverIdea(idea.id).catch((error) => setIdeaRecoveryErrors((current) => new Map([...current, [idea.id, readableError(error)] as const].slice(-24))));
        }}>Reload saved status</button>
      </div>
    ));
  }

  function renderHistoryPage() {
    if (!visibleHistory) return null;
    const window = visibleHistory;
    const ideas = window.page?.ideas ?? [];
    return <section className="demand-history" aria-label={window.query.scope === "saved" ? "Saved reading history" : "Reading history"} aria-busy={window.loading}>
      {window.loading ? <p role="status">Loading {window.query.scope === "saved" ? "saved reading" : "reading history"}…</p> : null}
      {window.error ? <div className="demand-page-error" role="alert"><p>{window.error}</p><button type="button" className="demand-text-action" onClick={() => void loadHistoryPage(window.query, window.cursor)}>Try loading again</button></div> : null}
      {renderIdeaRecoveryErrors(ideas)}
      {ideas.length ? <div className="demand-idea-grid">{ideas.map((idea) => <IdeaCard key={idea.id} idea={ideaById.get(idea.id) ?? idea}
        request={idea.articleRequestId ? requestById.get(idea.articleRequestId) : undefined} saving={ideaSaveBlocked(idea.id)}
        onOpen={() => void openIdea(ideaById.get(idea.id) ?? idea)} onSave={() => void toggleIdeaSave(ideaById.get(idea.id) ?? idea)} />)}</div>
        : window.page && !window.loading ? <p>No {window.query.scope === "saved" ? "saved reading" : "articles"} on this page.</p> : null}
      <nav className="demand-history-controls" aria-label="Reading history pages">
        <button type="button" disabled={window.loading || window.cursor === null} onClick={() => void loadHistoryPage(window.query, null)}>Latest reading</button>
        <button type="button" disabled={window.loading || !window.page?.nextCursor} onClick={() => window.page?.nextCursor && void loadHistoryPage(window.query, window.page.nextCursor)}>Older reading<ArrowRight aria-hidden="true" /></button>
        {window.query.scope !== "saved" ? <button type="button" onClick={() => { historyReader.close(); setHistory(historyReader.snapshot()); showLatestArticles(); }}>Back to latest articles</button> : null}
      </nav>
    </section>;
  }

  function historyEntry(query: HistoryScope) {
    return <div className="demand-history-controls"><button type="button" onClick={() => void loadHistoryPage(query, null)}>Browse reading history<ArrowRight aria-hidden="true" /></button></div>;
  }

  function renderLoop() {
    if (!workspace || !activeLoop) return null;
    if (visibleHistory) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed"><h1>{activeLoop.title}</h1><p className="demand-intro">Your reading history.</p>{renderHistoryPage()}</main>;
    const ideasRequest = latestRequest({ ...workspace, requests: projection.requests }, activeLoop.id, "ideas");
    const ideasPendingLabel = demandIdeasPendingLabel(ideasRequest, ideasSubmittingLoopId === activeLoop.id);
    const ideasPending = ideasPendingLabel !== null || Boolean(requestedBatches.current.get(activeLoop.id)?.requestId);
    const canRetryIdeas = Boolean(ideasRequest?.failure?.retryable);
    const canRequestFreshIdeas = canRequestFreshIdeasAfter(ideasRequest?.failure?.code);
    return (
      <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed" aria-labelledby="demand-loop-heading">
        <div className="demand-feed-heading"><h1 id="demand-loop-heading">{activeLoop.title}</h1><p className="demand-article-count">{activeIdeas.length} {activeIdeas.length === 1 ? "article" : "articles"}</p></div>
        <ArticleFeedToolbar balance={articleBalance(workspace.allowance)} count={nextArticleCount(workspace.allowance)} pending={ideasPending} disabled={false} onRefresh={() => void askForIdeas(activeLoop)} onAllowance={openAccountUsage} />
        {workspace.allowance?.reserved ? <p className="demand-scope-note">{workspace.allowance.reserved} articles being prepared; only accepted articles use your allowance.</p> : null}
        {allowanceStatus ? <p className="demand-batch-arrival" role="status">{allowanceStatus}</p> : null}
        {retainedIdeas && !sameReadingSet(activeIdeas, combinedIdeas.filter((idea) => idea.loopId === activeLoop.id)) ? <p className="demand-batch-arrival" role="status">You’re back at the articles you were reading. <button type="button" onClick={showLatestArticles}>Latest articles</button></p>
          : newIdeas.has(activeLoop.id) ? <p className="demand-batch-arrival" role="status">{newIdeas.get(activeLoop.id)!.length ? `${newIdeas.get(activeLoop.id)!.length} new ${newIdeas.get(activeLoop.id)!.length === 1 ? "article" : "articles"} ready.` : "No new articles were accepted. Your current articles are unchanged."}</p> : null}
        {ideasPending ? (
          <section className="demand-request-state" role="status" aria-live="polite">
            <EdisonMark />
            <div><h2>{activeIdeas.length ? "Refreshing your articles…" : "Finding your first articles…"}</h2><p>{activeIdeas.length ? "Keep reading. Your current articles stay here until the new set is ready." : "Your articles will appear here when they’re ready."}</p></div>
          </section>
        ) : null}
        {ideasRequest?.status === "failed" && !ideasPending ? (
          <section className="demand-request-state demand-request-failed" role="alert">
            <div><h2>We couldn’t refresh your articles.</h2><p>{activeIdeas.length ? "Your current articles are unchanged. " : "Your loop is saved. "}{ideasRequest.failure?.message ?? "Try again when you’re ready."}</p></div>
            {canRetryIdeas || canRequestFreshIdeas ? (
              <button
                type="button"
                disabled={retryingRequestId === ideasRequest.id || ideasSubmittingLoopId === activeLoop.id}
                onClick={() => void (canRetryIdeas
                  ? retryRequest(ideasRequest)
                  : askForIdeas(activeLoop))}
              >
                {canRetryIdeas ? "Try again" : "Refresh articles"}
              </button>
            ) : null}
          </section>
        ) : null}
        {pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}
        {renderIdeaRecoveryErrors(activeIdeas)}
        {activeIdeas.length ? <div className="demand-idea-grid">
          {activeIdeas.map((idea) => <IdeaCard key={idea.id} idea={idea} request={idea.articleRequestId ? requestById.get(idea.articleRequestId) : undefined}
            saving={ideaSaveBlocked(idea.id)} onOpen={() => void openIdea(idea)} onSave={() => void toggleIdeaSave(idea)} />)}
        </div> : !ideasPending && ideasRequest?.status !== "failed" ? <section className="demand-empty"><h2>Find something worth reading next.</h2><p>Refresh this loop to find articles shaped by your Direction.</p></section> : null}
        {historyEntry({ scope: "all", loopId: activeLoop.id })}
      </main>
    );
  }

  function renderRequest() {
    const request = selectedRequest;
    const idea = selectedIdea;
    if (!idea) return renderLoop();
    return (
      <main ref={readingSurfaceRef} tabIndex={-1} className="demand-preparation">
        <button type="button" className="demand-text-action" onClick={returnFromReading}>
          <ChevronLeft />Back to your loops
        </button>
        <h1>{idea.title}</h1>
        <p className="demand-intro">{idea.deck}</p>
        <section className={`demand-request-state${request?.status === "failed" ? " demand-request-failed" : ""}`} role={request?.status === "failed" ? "alert" : "status"}>
          {request?.status !== "failed" ? <EdisonMark /> : null}
          <div>
            <h2>{request?.status === "failed" ? "We couldn’t finish this article." : articlePreparationLabel(request)}</h2>
            <p>{request?.status === "failed"
              ? "Nothing was published."
              : "You can keep browsing. This article will be here when it’s ready."}</p>
          </div>
          {request?.status === "failed" ? (
            <button
              type="button"
              disabled={retryingRequestId === request.id}
              onClick={() => void (request.failure?.retryable ? retryRequest(request) : returnFromReading())}
            >
              {request.failure?.retryable ? "Try again" : "Back to your loops"}
            </button>
          ) : null}
          {(!request || request.status === "succeeded") && !selectedArticle && resultLoadFailed ? (
            <button type="button" onClick={() => { setResultLoadFailed(false); setResultLoadNonce((value) => value + 1); }}>
              Load article again
            </button>
          ) : null}
        </section>
        {pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}
        {renderIdeaRecoveryErrors([idea])}
        {!idea.articleRequestId && workspace ? <button type="button" className="demand-text-action" onClick={() => {
          void restoreArticleRoute({ kind: "idea", id: idea.id }, workspace, navigationIntentRef.current);
        }}>Check article status</button> : null}
        {request?.status !== "failed" && !resultLoadFailed ? <div className="demand-article-skeleton" aria-hidden="true">{[0, 1, 2].map((group) => <div key={group}><span /><span /><span /><span /></div>)}</div> : null}
      </main>
    );
  }

  function renderArticle() {
    if (!selectedArticle || !selectedIdea) return renderRequest();
    const originSet = workspace && returnTarget && readingSetMatches(readingSet, workspace.workspaceId, returnTarget) ? readingSet?.ideas : null;
    const readingIdeas = originSet ?? (returnTarget?.history && history.window?.page ? history.window.page.ideas : returnTarget?.view === "home" ? combinedIdeas
      : returnTarget?.view === "library" ? combinedIdeas.filter(({ saved }) => saved) : activeIdeas);
    const currentIndex = readingIdeas.findIndex(({ id }) => id === selectedIdea.id);
    const nextIdea = currentIndex >= 0 ? readingIdeas[currentIndex + 1] ?? null : null;
    const nextRequest = nextIdea?.articleRequestId ? requestById.get(nextIdea.articleRequestId) : undefined;
    const backLabel = returnTarget?.view === "home" ? "For You" : returnTarget?.view === "library" ? "Library" : activeLoop?.title ?? "your loops";
    return (
      <main ref={readingSurfaceRef} tabIndex={-1} className="demand-article">
        <div className="demand-article-toolbar">
          <button type="button" onClick={returnFromReading}><ChevronLeft />Back to your loops</button>
          <div>
            <button type="button" aria-haspopup="dialog" aria-expanded={shareOpen} onClick={(event) => { shareOpenerRef.current = event.currentTarget; setAskOpen(false); setShareOpen(true); }}><Share2 aria-hidden="true" />Share</button>
            <button type="button" aria-label={selectedIdea.saved ? "Remove from saved reading" : "Save article"} aria-pressed={selectedIdea.saved} disabled={ideaSaveBlocked(selectedIdea.id)} onClick={() => void toggleIdeaSave(selectedIdea)}>
              <Bookmark fill={selectedIdea.saved ? "currentColor" : "none"} />
            </button>
          </div>
        </div>
        {pageError && !askOpen ? <p className="demand-page-error" role="alert">{pageError}</p> : null}
        {renderIdeaRecoveryErrors([selectedIdea])}
        <header className="demand-article-head">
          <p className="demand-kicker">{selectedArticle.kicker}</p>
          <h1>{selectedArticle.title}</h1>
          <p className="demand-article-deck">{selectedArticle.deck}</p>
          <div className="demand-byline"><EdisonMark /><span><strong>Written by Edison for this loop</strong><DemandReadingMetadata article={selectedArticle} /></span></div>
        </header>
        <aside className="demand-why"><EdisonMark /><div><strong>Why Edison wrote this</strong><p>{selectedArticle.reason}</p></div></aside>
        <div className="demand-article-body">
          {selectedArticle.body.map((block, index) => {
            if (block.type === "heading") return <h2 key={`${block.text}-${index}`}>{block.text}</h2>;
            if (block.type === "quote") return <blockquote key={`${block.text}-${index}`}>{block.text}{block.attribution ? <cite>— {block.attribution}</cite> : null}<CitationLinks block={block} sources={selectedArticle.sources} /></blockquote>;
            return <p key={`${block.text}-${index}`}>{block.text}<CitationLinks block={block} sources={selectedArticle.sources} /></p>;
          })}
        </div>
        <DemandSourceList sources={selectedArticle.sources} />
        <nav className="demand-next" aria-label="Continue reading">
          {nextIdea ? <><p>Up next · {backLabel}</p><button type="button" onClick={() => void openIdea(nextIdea)}><span>{!nextIdea.articleRequestId || nextRequest?.status === "succeeded" ? "Next article" : "View next article"}: {nextIdea.title}</span><ArrowRight /></button></> : null}
          <button type="button" className="demand-end-back" onClick={returnFromReading}><ChevronLeft aria-hidden="true" />Back to your loops</button>
        </nav>
        <button type="button" className="pulse-curate-fab demand-ask-fab" aria-haspopup="dialog" aria-expanded={askOpen} onClick={openAsk}><MessageCircle aria-hidden="true" />Ask</button>
      </main>
    );
  }

  function content() {
    if (loading) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-loading" role="status"><EdisonMark /><p>Opening your reading workspace…</p></main>;
    if (recoveringContinuity || continuityFailure) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-loading"><h1>{continuityFailure ? "We couldn’t restore your reading yet." : "Restoring your article…"}</h1>{continuityFailure ? <><p role="alert">{continuityFailure}</p><button type="button" className="demand-primary" onClick={retryContinuityRestoration}>Try restoring again</button><button type="button" className="demand-text-action" onClick={() => openWorkspaceView("library")}>Back to Library</button></> : <p role="status">Recovering the saved article and its original reading page.</p>}</main>;
    if (!workspace) return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-loading" aria-busy={accountRecoveryPending}><DemandStartupFailure error={pageError} canContinueAccount={canContinueAccount} pending={accountRecoveryPending} onContinueAccount={() => { void accountRecoveryAction.current?.(); }} onRetry={() => window.location.reload()} /></main>;
    if (view === "loop") return renderLoop();
    if (view === "request") return renderRequest();
    if (view === "article") return renderArticle();
    if (view === "library") {
      return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed"><h1>Library</h1><p className="demand-intro">Articles you save stay with your reading workspace.</p>{pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}{visibleHistory ? renderHistoryPage() : <button type="button" className="demand-text-action" onClick={() => void loadHistoryPage({ scope: "saved" }, null)}>Load saved reading</button>}</main>;
    }
    if (view === "profile") return <ReaderAccount initialSection={accountSection} hasPendingReset={hasPendingReset} workspace={workspace} invitationsClient={client} getIdentity={client.getDemandAccountIdentity} signOut={async () => { await client.signOutDemandAccount(); window.history.replaceState({}, "", "/"); window.location.reload(); }} onAllowance={openAllowance} onReading={() => openWorkspaceView("home")} onBack={() => {
      const target = accountReturn.current; if (!target) { openWorkspaceView("home"); return; }
      window.history.back();
    }} />;
    return <main ref={readingSurfaceRef} tabIndex={-1} className="demand-feed"><h1>For You</h1><p className="demand-intro">The latest from your loops.</p>{pageError ? <p className="demand-page-error" role="alert">{pageError}</p> : null}{visibleHistory ? renderHistoryPage() : <>{retainedIdeas && !sameReadingSet(retainedIdeas, combinedIdeas) ? <p className="demand-batch-arrival">You’re back at the articles you were reading. <button type="button" onClick={showLatestArticles}>Latest articles</button></p> : null}{renderIdeaRecoveryErrors(feedIdeas)}{feedIdeas.length ? <div className="demand-idea-grid">{feedIdeas.map((idea) => <IdeaCard key={idea.id} idea={idea} request={idea.articleRequestId ? requestById.get(idea.articleRequestId) : undefined} saving={ideaSaveBlocked(idea.id)} onOpen={() => void openIdea(idea)} onSave={() => void toggleIdeaSave(idea)} />)}</div> : <section className="demand-empty"><h2>What do you want to learn about?</h2><p>Your loops’ articles will appear together here.</p><button type="button" className="demand-primary" onClick={openCreate}>Create loop<ArrowRight /></button></section>}{historyEntry({ scope: "all" })}</>}</main>;
  }

  return (
    <>
      <ReaderShell
        loops={projection.loops.filter((loop) => !loop.archivedAt)}
        onMoreLoops={loopPages?.nextCursor || loopsError ? () => void loadMoreLoops(loopPages?.nextCursor ?? undefined) : undefined}
        loadingMoreLoops={loopsLoading}
        activeLoopId={view === "home" ? PULSE_FOR_YOU_ID : activeLoopId}
        onSelectLoop={(loop) => loop === PULSE_FOR_YOU_ID ? openWorkspaceView("home") : openLoop(loop)}
        onAddLoop={openCreate}
        onOpenHome={() => openWorkspaceView("home")}
        onOpenLibrary={() => openWorkspaceView("library")}
        onOpenProfile={() => openWorkspaceView("profile")}
        onEditLoop={openCurate}
        showLoopNavigation={view !== "article" && view !== "request" && view !== "profile"}
        showEditLoop={view === "loop" && Boolean(activeLoop && !activeLoop.archivedAt)}
      >
        {loopsError ? <p role="alert" className="demand-page-error">{loopsError}</p> : null}{content()}
      </ReaderShell>
      <CreateLoopDialog openerRef={createOpenerRef} fallbackRef={readingSurfaceRef} open={createOpen} draft={createDraft} pending={createPending} error={createError || (!createPending && createAttemptRef.current ? "A previous request needs confirmation. Create loop will check that same request; your newer draft is retained." : "")} onOpenChange={setCreateOpen} onDraftChange={(draft) => { setCreateDraft(draft); setCreateError(""); if (workspace) writeDraft("create", workspace.workspaceId, draft); }} onSubmit={() => void createLoopAndIdeas()} />
      {allowanceOpen && workspace?.allowance ? <AllowanceWall workspaceId={workspace.workspaceId} allowance={workspace.allowance} onClose={closeActionOverlay}
        onRestoreFocus={() => { restoreDemandDialogFocus(allowanceOpenerRef.current, readingSurfaceRef.current); }} onReset={async (input) => {
        const ticket = workspaceResponses.beginMutation();
        try { const result = await client.resetDemandAllowance(input); if (publishWorkspace(workspaceResponses.acceptMutation(ticket, result.workspace))) { setHasPendingReset(false); setAllowanceStatus(`Allowance reset. ${result.workspace.allowance?.remaining ?? "Your"} articles available. Choose Refresh articles or New loop when you’re ready.`); } }
        finally { workspaceResponses.finishMutation(ticket); }
      }} /> : null}
      {curateOpen && curateLoop && workspace ? <LoopEditor key={`${workspace.workspaceId}:${curateLoop.id}`} loop={curateLoop} workspaceId={workspace.workspaceId}
        instructions={curateLoop.instructions ?? curateLoop.originalCuriosity}
        onSave={(draft, key, revision) => editLoop(draft, key, revision)} onDelete={(key, revision) => deleteLoop(key, revision)}
        onUndo={curateLoop.canUndo && curateLoop.lastMutationId ? () => submitFeedback("undo") : undefined}
        pendingUndo={feedbackSubmittingLoopId === curateLoop.id || Boolean(feedbackRequestId)} status={feedbackStatus} error={feedbackError}
        onClose={() => { setCurateOpen(false); }}
        onRestoreFocus={() => { restoreDemandDialogFocus(curateOpenerRef.current, readingSurfaceRef.current); }} /> : null}
      {selectedArticle && selectedIdea && workspace && view === "article" ? <ArticleConversation key={`${workspace.workspaceId}:${selectedArticle.id}`} article={selectedArticle}
        workspaceId={workspace.workspaceId} ideaId={selectedIdea.id} loopId={selectedIdea.loopId} open={askOpen} getResult={client.getDemandResult}
        getConversation={(cursor) => client.getDemandConversation(selectedArticle.id, cursor ? { cursor } : {})}
        ask={async (question, key) => {
          const ticket = workspaceResponses.beginMutation();
          try { const result = await client.askDemandQuestion(selectedIdea.id, { question, idempotencyKey: key }); publishWorkspace(workspaceResponses.acceptMutation(ticket, result.workspace)); return result; }
          finally { workspaceResponses.finishMutation(ticket); }
        }}
        retry={async (requestId) => {
          const ticket = workspaceResponses.beginMutation();
          try { const result = await client.retryDemandRequest(requestId); publishWorkspace(workspaceResponses.acceptMutation(ticket, result.workspace)); return result; }
          finally { workspaceResponses.finishMutation(ticket); }
        }}
        renderAnswer={(answer) => <DemandAnswerContent answer={answer} articleSources={selectedArticle.sources} />}
        onClose={() => { setAskOpen(false); requestAnimationFrame(() => restoreDemandDialogFocus(askOpenerRef.current, readingSurfaceRef.current)); }}
        onLibrary={() => openWorkspaceView("library")} /> : null}
      {shareOpen && selectedArticle && workspace && view === "article" ? <SharePanel key={`${workspace.workspaceId}:${selectedArticle.id}`} articleId={selectedArticle.id}
        workspaceId={workspace.workspaceId} title={selectedArticle.title}
        createLink={(key) => client.createDemandShare(selectedArticle.id, { idempotencyKey: key, confirmPublic: true })}
        onClose={() => { setShareOpen(false); restoreDemandDialogFocus(shareOpenerRef.current, readingSurfaceRef.current); }} /> : null}
    </>
  );
}
