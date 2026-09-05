"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type {
  Article,
  ArticleCard,
  ArticleCategory,
  ArticleConversationResponse,
  ContentCategory,
  ConversationMessage,
  ConversationResponse,
  CreateEditorialInstructionRequest,
  DeleteEditorialInstructionRequest,
  EditorialDirectionMutationResponse,
  EditorialDirectionResponse,
  EditorialInstruction,
  ExplicitInterest,
  ExplicitInterestStatus,
  FeedResponse,
  GenerationJob,
  LibraryResponse,
  Profile as ReaderProfile,
  PublicStarterArticle,
  PublicStarterEdition,
  UndoEditorialDirectionRequest,
  UpdateEditorialInstructionRequest,
} from "@edison/contracts";
import {
  articleConversationResponseSchema,
  conversationResponseSchema,
  editorialDirectionMutationResponseSchema,
  editorialDirectionResponseSchema,
  feedResponseSchema,
  libraryResponseSchema,
  publicStarterArticleSchema,
  publicStarterEditionSchema,
} from "@edison/contracts";
import {
  AlertCircle,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  GripVertical,
  Info,
  LoaderCircle,
  Send,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import { ArticleView } from "@/components/edison/article-view";
import {
  EditorialComposer,
  EditorialDirectionReview,
  GuestDirectionImportDialog,
  OneOffComposer,
} from "@/components/edison/editorial-composer";
import {
  DataStatus,
  LibraryView,
  ProfileView,
} from "@/components/edison/library-profile";
import { BooksHome, PodcastsHome } from "@/components/edison/publication-media";
import {
  PublicationFolio,
  PublicationShell,
} from "@/components/edison/publication-shell";
import { StoryCard, storyTones } from "@/components/edison/story-card";
import { EdisonMark } from "@/components/edison/brand";
import {
  edisonApi,
  edisonPublicApi,
  EdisonApiError,
} from "@/lib/api-client";
import { makeDemoArticle, makeDemoStories } from "@/lib/demo-content";
import type {
  DirectionScope,
  PublicationDirection,
  PublicationSection,
  PublicationWorkspace,
} from "@/lib/publication-state";
import { readPublicationWorkspace } from "@/lib/publication-state";
import { usePublicationWorkspace } from "@/hooks/use-publication-workspace";
import { useReadingLoops } from "@/hooks/use-reading-loops";
import { useReaderContinuity } from "@/hooks/use-reader-continuity";
import { createReadingJourney, nextReadableArticle, validReaderLoopId } from "@/lib/reader-continuity";
import { matchPreparedSubject, preparedArtworkByArticleId, preparedSuggestions } from "@/lib/prepared-catalog";
import { emptyPulseWorkspace } from "@/lib/pulse-workspace";
import { readerHistoryState } from "@/lib/reader-navigation-history";
import { clearPendingArticleQuestions } from "@/lib/device-reading-data";
import { PulseShell } from "@/components/edison/pulse-shell";
import { PulseFeed } from "@/components/edison/pulse-feed";
import { CurateDialog, NewLoopDialog } from "@/components/edison/pulse-controls";

type DataMode = "prototype" | "guest" | "live";
type ReaderView = "home" | "article" | "library" | "profile";

export type ReaderRoute = {
  section: PublicationSection;
  view: ReaderView;
  articleId: string | null;
  loopId?: string;
};

const defaultRoute: ReaderRoute = {
  section: "news",
  view: "home",
  articleId: null,
};

const sections = new Set<PublicationSection>(["news", "books", "podcasts"]);
const views = new Set<ReaderView>(["home", "article", "library", "profile"]);

export function parseReaderRoute(search: string): ReaderRoute {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const rawSection = params.get("section") as PublicationSection | null;
  const rawView = params.get("view") as ReaderView | null;
  const section = rawSection && sections.has(rawSection) ? rawSection : "news";
  const view = rawView && views.has(rawView) ? rawView : "home";
  const articleId = view === "article" ? params.get("article")?.trim() || null : null;
  const loopId = validReaderLoopId(params.get("loop"));
  const loop = loopId ? { loopId } : {};
  return view === "article" && !articleId
    ? { section, view: "home", articleId: null, ...loop }
    : { section, view, articleId, ...loop };
}

export function readerRouteHref(route: ReaderRoute): string {
  const params = new URLSearchParams();
  if (route.section !== "news") params.set("section", route.section);
  if (route.view !== "home") params.set("view", route.view);
  if (route.view === "article" && route.articleId) params.set("article", route.articleId);
  if (validReaderLoopId(route.loopId)) params.set("loop", route.loopId!);
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

/** Only explicit commissioning language is diverted away from editorial direction. */
export function detectOneOffSection(text: string): PublicationSection | null {
  if (!/^\s*(?:please\s+)?(?:write|create|make|compose|commission|generate|draft)\b/i.test(text)) return null;
  if (/\b(?:podcast|episode)\b/i.test(text)) return "podcasts";
  if (/\bbook\b/i.test(text)) return "books";
  if (/\b(?:article|story|piece|report)\b/i.test(text)) return "news";
  return null;
}

export function isAmbiguousCreationRequest(text: string): boolean {
  return /^\s*(?:please\s+)?(?:write|create|make|compose|commission|generate|draft)\b/i.test(text) &&
    detectOneOffSection(text) === null &&
    !/\b(?:more|less|fewer|future|edition|feed|direction|from now on)\b/i.test(text);
}

export function resolveLiveNewsEditionId(
  feedEditionId: string | null | undefined,
  directionEditionId: string | null | undefined,
): string {
  if (feedEditionId && directionEditionId && feedEditionId !== directionEditionId) {
    return "";
  }
  return feedEditionId ?? directionEditionId ?? "";
}

const categoryLabels: Record<ContentCategory, string> = {
  "for-you": "For you",
  "tech-science": "Tech & Science",
  business: "Business",
  "arts-culture": "Arts & Culture",
  sports: "Sports",
  entertainment: "Entertainment",
};
const categoryOrder = Object.keys(categoryLabels) as ContentCategory[];

type DirectionUi = {
  pending: boolean;
  status: string;
  error: string;
  mutationId: string | null;
  resultingRevision: number | null;
};
type PendingDirection = {
  text: string;
  scope: DirectionScope;
  editionId: string | null;
  expectedRevision: number;
  idempotencyKey: string;
};
type CreationState = {
  section: "news";
  request: string;
  idempotencyKey: string;
  jobId: string;
  status: GenerationJob["status"];
  outputArticleId: string | null;
};
type PendingCreation = { request: string; idempotencyKey: string };
type NoticeTone = "info" | "success" | "error";
type Notice = { message: string; tone: NoticeTone };

const blankDirectionUi = (): Record<PublicationSection, DirectionUi> => ({
  news: { pending: false, status: "", error: "", mutationId: null, resultingRevision: null },
  books: { pending: false, status: "", error: "", mutationId: null, resultingRevision: null },
  podcasts: { pending: false, status: "", error: "", mutationId: null, resultingRevision: null },
});

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Edison could not complete that request.";
}

function starterArticle(item: PublicStarterArticle): Article {
  return {
    ...item.article,
    id: item.id,
    slug: item.id,
    reason: item.reason,
    saved: false,
    completed: false,
    writtenFor: "the public edition",
    shareId: null,
  };
}

function toDirection(instruction: EditorialInstruction): PublicationDirection {
  return {
    id: instruction.id,
    section: instruction.section,
    scope: instruction.scope,
    editionId: instruction.editionId,
    text: instruction.text,
    revision: instruction.revision,
    activeForCurrentEdition: instruction.activeForCurrentEdition,
  };
}

function creationStorageKey(identity?: string) {
  return `edison:pending-creation:v1:${identity ? `account:${encodeURIComponent(identity)}` : "guest"}`;
}

function creationRequestStorageKey(identity?: string) {
  return `${creationStorageKey(identity)}:request`;
}

function directionRequestStorageKey(identity: string | undefined, section: PublicationSection) {
  return `edison:pending-direction:v1:${identity ? `account:${encodeURIComponent(identity)}` : "guest"}:${section}`;
}

function guestImportMarkerKey(identity: string) {
  return `edison:guest-direction-import:v1:${encodeURIComponent(identity)}`;
}

function questionRequestStorageKey(identity: string, articleId: string) {
  return `edison:pending-question:v1:account:${encodeURIComponent(identity)}:${encodeURIComponent(articleId)}`;
}

export function mergeConversationMessages(
  current: ConversationMessage[],
  incoming: ConversationMessage[],
) {
  const byId = new Map(current.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort((left, right) =>
    left.createdAt.localeCompare(right.createdAt) || left.id.localeCompare(right.id),
  );
}

export function guestDirectionImportKey(
  direction: Pick<PublicationDirection, "id" | "revision">,
) {
  return `guest-direction-${direction.id}-r${direction.revision}`;
}

type ReaderAppProps = {
  reader: { id?: string; name: string; email: string };
  dataMode?: DataMode;
  prototypeResearchedAt?: string;
};

export function ReaderApp(props: ReaderAppProps) {
  // Account transitions must not reuse the previous reader's in-memory drafts.
  return <ReaderSession key={`${props.dataMode ?? "prototype"}:${props.reader.id ?? "guest"}`} {...props} />;
}

function ReaderSession({
  reader,
  dataMode = "prototype",
  prototypeResearchedAt,
}: ReaderAppProps) {
  const prototypeStories = useMemo(
    () => makeDemoStories(prototypeResearchedAt ?? "1970-01-01T00:00:00.000Z"),
    [prototypeResearchedAt],
  );
  const workspace = usePublicationWorkspace(
    dataMode === "prototype" ? "demo" : dataMode === "live" ? reader.id ?? null : null,
  );
  const readingLoops = useReadingLoops(dataMode, reader.id);
  const continuity = useReaderContinuity(dataMode === "prototype" ? "demo" : reader.id);
  const { capture: capturePosition, restore: restorePosition, hydrated: continuityReady } = continuity;
  const restorePending = useRef(true);
  const [curateOpen, setCurateOpen] = useState(false);
  const [curateLoopId, setCurateLoopId] = useState("");
  const [curateDrafts, setCurateDrafts] = useState<Record<string, string>>({});
  const [curateError, setCurateError] = useState("");
  const [curateStatus, setCurateStatus] = useState("");
  const [newLoopOpen, setNewLoopOpen] = useState(false);
  const [newLoopDraft, setNewLoopDraft] = useState("");
  const [newLoopError, setNewLoopError] = useState("");
  const [askOpen, setAskOpen] = useState(false);
  const [clearDeviceOpen, setClearDeviceOpen] = useState(false);
  const [route, setRoute] = useState<ReaderRoute>(defaultRoute);
  const routeRef = useRef(route);
  const [stories, setStories] = useState<ArticleCard[]>(
    dataMode === "prototype" ? prototypeStories : [],
  );
  const [starterEdition, setStarterEdition] = useState<PublicStarterEdition | null>(null);
  const [personalEdition, setPersonalEdition] = useState<FeedResponse | null>(null);
  const [usingStarter, setUsingStarter] = useState(dataMode !== "live");
  const [article, setArticle] = useState<Article | null>(null);
  const articleCache = useRef(new Map<string, Article>());
  const [publicArticleIds, setPublicArticleIds] = useState<ReadonlySet<string>>(
    () => new Set(),
  );
  const articleRequest = useRef(0);
  const [summary, setSummary] = useState<ArticleCard | null>(null);
  const [profile, setProfile] = useState<ReaderProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(dataMode === "live");
  const [profileError, setProfileError] = useState("");
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [directionData, setDirectionData] = useState<EditorialDirectionResponse | null>(null);
  const [directionLoadError, setDirectionLoadError] = useState("");
  const [directionUi, setDirectionUi] = useState(blankDirectionUi);
  const pendingDirections = useRef(new Map<PublicationSection, PendingDirection>());
  const directionReadSequence = useRef(0);
  const [directionReviewOpen, setDirectionReviewOpen] = useState(false);
  const [guestWorkspace, setGuestWorkspace] = useState<PublicationWorkspace | null>(null);
  const [guestImportOpen, setGuestImportOpen] = useState(false);
  const [guestImportPending, setGuestImportPending] = useState(false);
  const [guestImportError, setGuestImportError] = useState("");
  const guestImportChecked = useRef(false);
  const [reviewSection, setReviewSection] = useState<PublicationSection>("news");
  const [oneOffOpen, setOneOffOpen] = useState(false);
  const [oneOffStatus, setOneOffStatus] = useState("");
  const [oneOffError, setOneOffError] = useState("");
  const [creation, setCreation] = useState<CreationState | null>(null);
  const pendingCreation = useRef<PendingCreation | null>(null);
  const [creationSubmitting, setCreationSubmitting] = useState(false);
  const [manage, setManage] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [feedError, setFeedError] = useState("");
  const [articleError, setArticleError] = useState("");
  const [libraryError, setLibraryError] = useState("");
  const [loading, setLoading] = useState(dataMode !== "prototype");
  const [libraryLoading, setLibraryLoading] = useState(false);
  const libraryReadSequence = useRef(0);
  const [updatingCategories, setUpdatingCategories] = useState(false);
  const [updatingPreference, setUpdatingPreference] = useState(false);
  const [interestAction, setInterestAction] = useState<string | null>(null);
  const [questionDrafts, setQuestionDrafts] = useState<Record<string, string>>({});
  const [questionPending, setQuestionPending] = useState<Record<string, boolean>>({});
  const questionRequests = useRef(new Map<string, { message: string; idempotencyKey: string }>());
  const [conversationMessages, setConversationMessages] = useState<Record<string, ConversationMessage[]>>({});
  const [conversationLoading, setConversationLoading] = useState<Record<string, boolean>>({});
  const [conversationErrors, setConversationErrors] = useState<Record<string, string>>({});
  const conversationReadSequence = useRef(0);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const section = route.section;
  const view = route.view;
  const name = profile?.displayName ?? reader.name;
  const email = profile?.email ?? reader.email;
  const streak = profile?.currentStreak ?? 0;
  const sectionWorkspace = workspace.workspace.sections[section];
  const pulseEnabled = dataMode !== "prototype" && section === "news";
  const activeLoopId = route.loopId ?? "for-you";
  const activeLoop = readingLoops.loops.find((loop) => loop.id === activeLoopId);
  const activeLoopLabel = activeLoopId === "collection" ? "the collection" : activeLoopId === "for-you" ? "For You" : activeLoop?.title ?? "your reading";
  const selectedCurateLoop = readingLoops.loops.find((loop) => loop.id === curateLoopId);
  const savedPublic = readingLoops.device.workspace.savedPublicArticles;
  const knownPublicArticleIds = useMemo(() => new Set([
    ...publicArticleIds,
    ...(starterEdition?.items.map((item) => item.id) ?? []),
    ...readingLoops.articles.filter((item) => item.visibility === "public").map((item) => item.id),
    ...savedPublic.map((item) => item.id),
  ]), [publicArticleIds, readingLoops.articles, savedPublic, starterEdition]);
  const allReadable = [...new Map([
    ...(starterEdition?.items.map((item) => starterArticle(item)) ?? []),
    ...readingLoops.articles,
    ...stories,
  ].map((item) => [item.id, item])).values()].map((item) => knownPublicArticleIds.has(item.id)
    ? { ...item, saved: savedPublic.some((saved) => saved.id === item.id) }
    : item);
  const selectedLoops = activeLoopId === "for-you"
    ? readingLoops.loops.filter((loop) => !loop.paused)
    : activeLoop ? [activeLoop] : [];
  const membership = new Set(selectedLoops.flatMap((loop) => [...loop.articleIds, ...loop.publicArticleIds]));
  const pulseArticles = (activeLoopId === "collection"
    ? allReadable.filter((item) => knownPublicArticleIds.has(item.id))
    : activeLoopId === "for-you" && readingLoops.loops.length === 0 ? allReadable
    : allReadable.filter((item) => membership.has(item.id))).slice(0, 30);
  const readingJourney = route.articleId ? continuity.record.current.journeys[route.articleId] ?? null : null;
  const nextArticle = article ? nextReadableArticle(article.id, readingJourney, allReadable) : null;

  const showNotice = useCallback((message: string, tone: NoticeTone = "info") => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice({ message, tone });
    noticeTimer.current = setTimeout(() => setNotice(null), 5_200);
  }, []);

  const rememberPublicArticles = useCallback((ids: Iterable<string>) => {
    const incoming = Array.from(ids);
    setPublicArticleIds((current) => {
      if (incoming.every((id) => current.has(id))) return current;
      const next = new Set(current);
      for (const id of incoming) next.add(id);
      return next;
    });
  }, []);

  const handleError = useCallback((error: unknown) => {
    if (error instanceof EdisonApiError && error.status === 401) {
      return "Your account session has expired. Public reading remains available; sign in again to make account changes.";
    }
    return messageFor(error);
  }, []);

  const patchDirectionUi = useCallback((owner: PublicationSection, patch: Partial<DirectionUi>) => {
    setDirectionUi((current) => ({
      ...current,
      [owner]: { ...current[owner], ...patch },
    }));
  }, []);

  const openDirectionReview = useCallback((owner: PublicationSection) => {
    setReviewSection(owner);
    setDirectionReviewOpen(true);
  }, []);

  const navigate = useCallback((next: ReaderRoute, replace = false, returnOverride?: ReaderRoute | null) => {
    articleRequest.current += 1;
    setSummary(null);
    setAskOpen(false);
    capturePosition(readerRouteHref(routeRef.current));
    restorePending.current = true;
    if (typeof window !== "undefined") {
      const state = window.history.state && typeof window.history.state === "object"
        ? window.history.state as Record<string, unknown>
        : {};
      window.history.replaceState(
        { ...state, __edisonScrollY: window.scrollY },
        "",
        window.location.href,
      );
      const nextState = readerHistoryState(routeRef.current, next, state, returnOverride);
      if (replace) window.history.replaceState(nextState, "", readerRouteHref(next));
      else window.history.pushState(nextState, "", readerRouteHref(next));
      window.scrollTo(0, 0);
    }
    routeRef.current = next;
    setRoute(next);
  }, [capturePosition]);

  const goHome = useCallback((target = section) => {
    navigate({ section: target, view: "home", articleId: null, ...(target === "news" ? { loopId: routeRef.current.loopId ?? "for-you" } : {}) });
  }, [navigate, section]);

  const backHome = useCallback(() => {
    if (dataMode !== "prototype" && section === "news") {
      const current = routeRef.current;
      if (current.view === "article" && window.history.state?.__edisonArticleReturnRoute) {
        navigate(window.history.state.__edisonArticleReturnRoute as ReaderRoute, true, window.history.state.__edisonArticleReturnParent as ReaderRoute | null);
        return;
      }
      if ((current.view === "library" || current.view === "profile") && window.history.state?.__edisonReturnRoute) {
        navigate(window.history.state.__edisonReturnRoute as ReaderRoute, true);
        return;
      }
      navigate({ section: "news", view: "home", articleId: null, loopId: current.loopId ?? "for-you" }, true);
      return;
    }
    if (typeof window !== "undefined" && window.history.state?.__edisonFromPublication) {
      window.history.back();
      return;
    }
    navigate({ section, view: "home", articleId: null }, true);
  }, [dataMode, navigate, section]);

  useEffect(() => {
    routeRef.current = route;
  }, [route]);

  useEffect(() => {
    const applyLocation = (state?: unknown) => {
      articleRequest.current += 1;
      const next = parseReaderRoute(window.location.search);
      routeRef.current = next;
      setRoute(next);
      restorePending.current = true;
      setAskOpen(false);
      const scrollY = state && typeof state === "object" && "__edisonScrollY" in state
        ? Number((state as { __edisonScrollY?: unknown }).__edisonScrollY)
        : 0;
      requestAnimationFrame(() => window.scrollTo(0, Number.isFinite(scrollY) ? scrollY : 0));
    };
    applyLocation(window.history.state);
    const onPopState = (event: PopStateEvent) => applyLocation(event.state);
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    if (!continuityReady || loading || (view === "home" && readingLoops.loading) || (view === "library" && libraryLoading) || (view === "article" && article?.id !== route.articleId)) return;
    if (!restorePending.current) return;
    restorePending.current = false;
    const frame = requestAnimationFrame(() => {
      const focusTarget = document.querySelector<HTMLElement>("main h1, main");
      if (focusTarget) {
        focusTarget.setAttribute("tabindex", "-1");
        focusTarget.focus({ preventScroll: true });
      }
      restorePosition(readerRouteHref(route), view === "home" ? readingJourney?.feedScrollY ?? 0 : 0);
    });
    return () => cancelAnimationFrame(frame);
  }, [article?.id, continuityReady, libraryLoading, loading, readingJourney?.feedScrollY, readingLoops.loading, restorePosition, route, view]);

  useEffect(() => {
    const savePosition = () => { if (!restorePending.current) capturePosition(readerRouteHref(routeRef.current)); };
    window.addEventListener("pagehide", savePosition);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const scrolled = () => {
      clearTimeout(timer);
      timer = setTimeout(savePosition, 180);
    };
    window.addEventListener("scroll", scrolled, { passive: true });
    return () => { clearTimeout(timer); window.removeEventListener("pagehide", savePosition); window.removeEventListener("scroll", scrolled); };
  }, [capturePosition]);

  useEffect(() => {
    if (!continuityReady) return;
    queueMicrotask(() => setQuestionDrafts((current) => ({ ...continuity.record.current.questionDrafts, ...current })));
  }, [continuityReady, continuity.record]);

  useEffect(() => {
    if (!readingLoops.device.hydrated) return;
    queueMicrotask(() => {
      setNewLoopDraft((current) => current || readingLoops.device.workspace.newLoopDraft);
      setCurateDrafts((current) => ({ ...readingLoops.device.workspace.directionDrafts, ...current }));
    });
  }, [readingLoops.device.hydrated, readingLoops.device.workspace.directionDrafts, readingLoops.device.workspace.newLoopDraft]);

  useEffect(() => {
    queueMicrotask(() => rememberPublicArticles(readingLoops.articles.filter((item) => item.visibility === "public").map((item) => item.id)));
  }, [readingLoops.articles, rememberPublicArticles]);

  const readDirections = useCallback(async () => {
    const sequence = ++directionReadSequence.current;
    const response = editorialDirectionResponseSchema.parse(
      await edisonApi<unknown>("/editorial-direction"),
    );
    if (sequence === directionReadSequence.current) {
      setDirectionData(response);
      setDirectionLoadError("");
    }
    return response;
  }, []);

  useEffect(() => {
    if (dataMode === "prototype") return;
    let active = true;
    const starter = edisonPublicApi<unknown>("/public/editions/news/current")
      .then((value) => publicStarterEditionSchema.parse(value));

    void (async () => {
      if (dataMode === "guest") {
        try {
          const nextStarter = await starter;
          if (!active) return;
          setStarterEdition(nextStarter);
          rememberPublicArticles(nextStarter.items.map((item) => item.id));
          setStories(nextStarter.items.map((item) => starterArticle(item)));
          setFeedError("");
        } catch (error) {
          if (active) setFeedError(handleError(error));
        } finally {
          if (active) setLoading(false);
        }
        return;
      }

      const [starterResult, profileResult, feedResult, directionsResult] = await Promise.allSettled([
        starter,
        edisonApi<ReaderProfile>("/me"),
        edisonApi<unknown>("/feed?category=for-you&limit=20")
          .then((value) => feedResponseSchema.parse(value)),
        readDirections(),
      ]);
      if (!active) return;
      if (starterResult.status === "fulfilled") {
        setStarterEdition(starterResult.value);
        rememberPublicArticles(starterResult.value.items.map((item) => item.id));
      }
      if (profileResult.status === "fulfilled") {
        setProfile(profileResult.value);
        setProfileError("");
      } else {
        setProfile(null);
        setProfileError(handleError(profileResult.reason));
      }
      setProfileLoading(false);
      if (directionsResult.status === "rejected") setDirectionLoadError(handleError(directionsResult.reason));

      const nextPersonalEdition = feedResult.status === "fulfilled"
        ? feedResult.value
        : null;
      setPersonalEdition(nextPersonalEdition);
      const directionEditionId = directionsResult.status === "fulfilled"
        ? directionsResult.value.sections.find((entry) => entry.section === "news")?.currentEditionId
        : null;
      const editionMismatch = Boolean(
        nextPersonalEdition?.editionId &&
        directionEditionId &&
        nextPersonalEdition.editionId !== directionEditionId,
      );

      if (feedResult.status === "fulfilled" && feedResult.value.items.length > 0 && !editionMismatch) {
        setStories(feedResult.value.items);
        setUsingStarter(false);
        setFeedError("");
      } else if (starterResult.status === "fulfilled") {
        setStories(starterResult.value.items.map((item) => starterArticle(item)));
        setUsingStarter(true);
        setFeedError(
          editionMismatch
            ? "Your account edition changed while Edison was opening it. The public starter edition is shown until you reload."
            : feedResult.status === "rejected"
              ? "Your personal edition could not be opened, so Edison is showing the public starter edition."
              : feedResult.value.editionId
                ? "Your personal News edition is still being prepared, so Edison is showing the public starter edition."
                : "Your first personal News edition has not been prepared yet, so Edison is showing the public starter edition.",
        );
      } else {
        const error = feedResult.status === "rejected"
          ? feedResult.reason
          : starterResult.status === "rejected" ? starterResult.reason : null;
        setFeedError(handleError(error));
      }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [dataMode, handleError, readDirections, rememberPublicArticles]);

  useEffect(() => () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
  }, []);

  useEffect(() => {
    if (dataMode !== "live" || !profile) return;
    let timeZone: string;
    try {
      timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      return;
    }
    if (!timeZone || (profile.onboardingComplete && profile.timezone === timeZone)) return;

    let active = true;
    void edisonApi<ReaderProfile>("/me", {
      method: "PATCH",
      body: JSON.stringify({ timezone: timeZone }),
    }).then((updated) => {
      if (active) setProfile(updated);
    }).catch((error) => {
      if (active) showNotice(handleError(error), "error");
    });
    return () => { active = false; };
  }, [dataMode, handleError, profile, showNotice]);

  useEffect(() => {
    if (view !== "article" || !route.articleId) return;
    if (dataMode !== "prototype" && loading) return;
    const articleId = route.articleId;
    const cached = articleCache.current.get(articleId);
    if (cached) {
      setArticleError("");
      setArticle(cached);
      return;
    }
    if (dataMode === "prototype") {
      const story = prototypeStories.find((entry) => entry.id === articleId);
      if (story) {
        const next = makeDemoArticle(story, "a demo reader");
        articleCache.current.set(articleId, next);
        setArticleError("");
        setArticle(next);
      } else {
        setArticle(null);
        setArticleError("That story is not part of the current sample edition.");
      }
      return;
    }
    const publicItem = starterEdition?.items.find((item) => item.id === articleId);
    if (publicItem) {
      const next = starterArticle(publicItem);
      rememberPublicArticles([articleId]);
      articleCache.current.set(articleId, next);
      setArticleError("");
      setArticle(next);
      return;
    }
    const sequence = ++articleRequest.current;
    setArticle(null);
    setArticleError("");
    void (async () => {
      try {
        const publicSnapshot = publicStarterArticleSchema.parse(
          await edisonPublicApi<unknown>(
            `/public/articles/${encodeURIComponent(articleId)}`,
          ),
        );
        rememberPublicArticles([articleId]);
        return { article: starterArticle(publicSnapshot), privateArticle: false };
      } catch (publicError) {
        if (dataMode !== "live") throw publicError;
        return {
          article: await edisonApi<Article>(`/articles/${encodeURIComponent(articleId)}`),
          privateArticle: true,
        };
      }
    })()
      .then(({ article: next, privateArticle }) => {
        articleCache.current.set(articleId, next);
        if (sequence !== articleRequest.current || routeRef.current.articleId !== articleId) return;
        setArticleError("");
        setArticle(next);
        if (privateArticle) {
          void edisonApi(`/articles/${encodeURIComponent(articleId)}/events`, {
            method: "POST",
            body: JSON.stringify({
              eventType: "opened",
              idempotencyKey: `open-${crypto.randomUUID()}`,
            }),
          }).catch(() => undefined);
        }
      })
      .catch((error) => {
        if (sequence === articleRequest.current && routeRef.current.articleId === articleId) {
          setArticleError(handleError(error));
        }
      });
  }, [dataMode, handleError, loading, prototypeStories, rememberPublicArticles, route.articleId, starterEdition, view]);

  useEffect(() => {
    const articleId = article?.id;
    if (
      view !== "article" ||
      !articleId ||
      dataMode !== "live" ||
      knownPublicArticleIds.has(articleId) ||
      article.writtenFor === "the public edition" ||
      !reader.id
    ) return;

    let active = true;
    const sequence = ++conversationReadSequence.current;
    queueMicrotask(() => {
      if (!active || sequence !== conversationReadSequence.current) return;
      setConversationLoading((current) => ({ ...current, [articleId]: true }));
      setConversationErrors((current) => ({ ...current, [articleId]: "" }));
    });

    try {
      const raw = localStorage.getItem(
        questionRequestStorageKey(reader.id, articleId),
      );
      if (raw) {
        const candidate = JSON.parse(raw) as Partial<PendingCreation>;
        if (
          typeof candidate.request === "string" &&
          candidate.request.trim().length > 0 &&
          candidate.request.length <= 4_000 &&
          typeof candidate.idempotencyKey === "string"
        ) {
          const pending = {
            message: candidate.request,
            idempotencyKey: candidate.idempotencyKey,
          };
          questionRequests.current.set(articleId, pending);
          queueMicrotask(() => {
            if (!active || sequence !== conversationReadSequence.current) return;
            setQuestionDrafts((current) => current[articleId]
              ? current
              : { ...current, [articleId]: pending.message });
          });
        }
      }
    } catch {
      // A corrupt optional recovery draft cannot affect the server conversation.
    }

    void edisonApi<unknown>(
      `/articles/${encodeURIComponent(articleId)}/conversation`,
    )
      .then((value) => articleConversationResponseSchema.parse(value))
      .then((response: ArticleConversationResponse) => {
        if (!active || sequence !== conversationReadSequence.current) return;
        const incoming = response.conversation?.messages ?? [];
        setConversationMessages((current) => ({
          ...current,
          [articleId]: mergeConversationMessages(
            current[articleId] ?? [],
            incoming,
          ),
        }));
      })
      .catch((error) => {
        if (!active || sequence !== conversationReadSequence.current) return;
        setConversationErrors((current) => ({
          ...current,
          [articleId]: handleError(error),
        }));
      })
      .finally(() => {
        if (!active || sequence !== conversationReadSequence.current) return;
        setConversationLoading((current) => ({ ...current, [articleId]: false }));
      });

    return () => { active = false; };
  }, [article, dataMode, handleError, knownPublicArticleIds, reader.id, view]);

  useEffect(() => {
    if (view !== "library" || dataMode !== "live") return;
    let active = true;
    const sequence = ++libraryReadSequence.current;
    queueMicrotask(() => {
      if (!active || sequence !== libraryReadSequence.current) return;
      setLibraryLoading(true);
      setLibraryError("");
    });

    void edisonApi<unknown>("/library")
      .then((value) => libraryResponseSchema.parse(value))
      .then((nextLibrary) => {
        if (!active || sequence !== libraryReadSequence.current) return;
        setLibrary(nextLibrary);
        setLibraryError("");
      })
      .catch((error) => {
        if (!active || sequence !== libraryReadSequence.current) return;
        setLibraryError(handleError(error));
      })
      .finally(() => {
        if (!active || sequence !== libraryReadSequence.current) return;
        setLibraryLoading(false);
      });

    return () => { active = false; };
  }, [dataMode, handleError, view]);

  function openStory(story: ArticleCard): Promise<void> {
    const publicItem = starterEdition?.items.find((item) => item.id === story.id);
    if (dataMode === "prototype") articleCache.current.set(story.id, makeDemoArticle(story, "a demo reader"));
    else if (publicItem) {
      rememberPublicArticles([story.id]);
      articleCache.current.set(story.id, starterArticle(publicItem));
    }
    setArticle(articleCache.current.get(story.id) ?? null);
    if (pulseEnabled && view === "home") {
      continuity.rememberJourney(story.id, createReadingJourney(activeLoopId, pulseArticles.map((entry) => entry.id), story.id, window.scrollY));
    }
    const originLoopId = view === "library" ? continuity.record.current.journeys[story.id]?.loopId ?? activeLoopId : activeLoopId;
    navigate({ section: "news", view: "article", articleId: story.id, ...(pulseEnabled ? { loopId: originLoopId } : {}) });
    return Promise.resolve();
  }

  function patchStory(articleId: string, patch: Partial<ArticleCard>) {
    setStories((current) => current.map((story) => story.id === articleId ? { ...story, ...patch } : story));
    readingLoops.patchArticle(articleId, patch);
    const cached = articleCache.current.get(articleId);
    if (cached) articleCache.current.set(articleId, { ...cached, ...patch });
    setArticle((current) => current?.id === articleId ? { ...current, ...patch } : current);
  }

  async function toggleSave(story: ArticleCard) {
    const publicStory = knownPublicArticleIds.has(story.id);
    if (dataMode === "guest" || publicStory) {
      if (pulseEnabled) {
        try {
          const alreadySaved = savedPublic.some((entry) => entry.id === story.id);
          await readingLoops.device.update((value) => ({
            ...value,
            savedPublicArticles: alreadySaved
              ? value.savedPublicArticles.filter((entry) => entry.id !== story.id)
              : [...value.savedPublicArticles.filter((entry) => entry.id !== story.id), { ...story, saved: true }].slice(-30),
          }));
          patchStory(story.id, { saved: !alreadySaved });
          showNotice(alreadySaved ? "Removed from this device’s saved reading." : "Saved on this device. Public saves do not sync to your account.", "success");
        } catch (error) { showNotice(handleError(error), "error"); }
        return;
      }
      showNotice(dataMode === "guest"
        ? "Sign in to keep stories in your library. Reading the public edition does not require an account."
        : "Public starter stories are readable now but are not part of your private library.");
      return;
    }
    const nextSaved = !story.saved;
    patchStory(story.id, { saved: nextSaved });
    if (dataMode === "prototype") {
      showNotice(nextSaved ? "Saved for this demo session." : "Removed from the demo library.", "success");
      return;
    }
    try {
      await edisonApi(`/articles/${encodeURIComponent(story.id)}/save`, {
        method: nextSaved ? "PUT" : "DELETE",
      });
    } catch (error) {
      patchStory(story.id, { saved: !nextSaved });
      showNotice(handleError(error), "error");
    }
  }

  function openLibrary() {
    navigate({ section, view: "library", articleId: null, ...(route.loopId ? { loopId: route.loopId } : {}) });
  }

  function openCurate() {
    if (!readingLoops.loops.length) { setNewLoopOpen(true); return; }
    setCurateLoopId(activeLoop?.id ?? "");
    setCurateError("");
    setCurateStatus("");
    setCurateOpen(true);
  }

  async function createLoop() {
    const curiosity = newLoopDraft.trim();
    if (!curiosity) { setNewLoopError("Enter a subject or question, or close this to browse the collection."); return; }
    const match = matchPreparedSubject(curiosity, allReadable);
    const availableIds = new Set(allReadable.map((item) => item.id));
    try {
      const id = await readingLoops.create({
        title: match?.title ?? curiosity.slice(0, 120),
        originalCuriosity: curiosity,
        publicArticleIds: match?.articleIds.filter((articleId) => availableIds.has(articleId)) ?? [],
      });
      setNewLoopOpen(false);
      setNewLoopDraft("");
      setNewLoopError("");
      void readingLoops.device.update((value) => ({ ...value, newLoopDraft: "" })).catch(() => undefined);
      navigate({ section: "news", view: "home", articleId: null, loopId: id });
      showNotice(dataMode === "live" ? "Loop saved to your account." : "Loop saved on this device. No personal article has been generated.", "success");
    } catch (error) { setNewLoopError(handleError(error)); }
  }

  async function curate(undoId?: string) {
    if (!selectedCurateLoop) { setCurateError("Choose the loop you want to shape."); return; }
    try {
      await readingLoops.changeDirection(selectedCurateLoop.id, curateDrafts[selectedCurateLoop.id] ?? selectedCurateLoop.direction, undoId);
      setCurateStatus(`${undoId ? "Direction restored" : "Direction saved"} for ${selectedCurateLoop.title}. ${dataMode === "live" ? "Future scheduled reading uses this direction; existing articles stay unchanged." : "Saved on this device only; guest directions do not generate or adapt articles."}`);
      setCurateError("");
      setCurateDrafts((current) => { const next = { ...current }; delete next[selectedCurateLoop.id]; return next; });
      void readingLoops.device.update((value) => { const drafts = { ...value.directionDrafts }; delete drafts[selectedCurateLoop.id]; return { ...value, directionDrafts: drafts }; }).catch(() => undefined);
    } catch (error) { setCurateError(handleError(error)); }
  }

  function editionIdFor(owner: PublicationSection): string {
    if (dataMode === "live") {
      const directionEditionId = directionData?.sections.find(
        (entry) => entry.section === owner,
      )?.currentEditionId;
      return owner === "news"
        ? resolveLiveNewsEditionId(personalEdition?.editionId, directionEditionId)
        : directionEditionId ?? "";
    }
    if (owner === "news") {
      return starterEdition?.id ?? (dataMode === "prototype"
        ? `demo-news-${(prototypeResearchedAt ?? "1970-01-01").slice(0, 10)}`
        : "");
    }
    return "";
  }

  async function divertOneOff(text: string, target: PublicationSection) {
    await workspace.updateDraft(target, "creation", text);
    await workspace.updateDraft(section, "editorial", "");
    if (target !== section) navigate({ section: target, view: "home", articleId: null });
    setOneOffStatus("This looks like a one-off piece. Your editorial direction is unchanged.");
    setOneOffError("");
    setOneOffOpen(true);
  }

  async function submitDirection() {
    const owner = section;
    const visible = workspace.workspace.sections[owner];
    const text = visible.editorialDraft.trim();
    if (!text || directionUi[owner].pending) return;
    const oneOffTarget = detectOneOffSection(text);
    if (oneOffTarget) {
      await divertOneOff(text, oneOffTarget);
      return;
    }
    if (isAmbiguousCreationRequest(text)) {
      patchDirectionUi(owner, {
        error: "Do you want one new piece, or should this change future editions? Use + for one piece, or describe what you want more or less of here.",
      });
      return;
    }
    const editionId = visible.scope === "edition" ? editionIdFor(owner) : null;
    if (visible.scope === "edition" && !editionId) {
      patchDirectionUi(owner, {
        error: `${owner[0].toUpperCase()}${owner.slice(1)} does not have a current edition identity yet. Choose From now on instead.`,
      });
      return;
    }

    if (dataMode !== "live") {
      patchDirectionUi(owner, { pending: true, error: "", status: "" });
      const result = await workspace.saveDirection(owner, editionId ?? "");
      patchDirectionUi(owner, {
        pending: false,
        error: result.ok ? "" : result.message,
        status: result.ok ? result.message : "",
        mutationId: null,
        resultingRevision: result.ok ? result.revision : null,
      });
      return;
    }

    const serverSection = directionData?.sections.find((entry) => entry.section === owner);
    if (!serverSection) {
      patchDirectionUi(owner, { error: "Your account direction is not ready. Reload it before saving this instruction." });
      return;
    }
    const previous = pendingDirections.current.get(owner);
    const samePrevious = previous && previous.text === text && previous.scope === visible.scope && previous.editionId === editionId
      ? previous
      : null;
    if (samePrevious && serverSection.revision > samePrevious.expectedRevision) {
      const confirmed = directionData?.instructions.some((instruction) =>
        instruction.section === owner && instruction.revision > samePrevious.expectedRevision &&
        instruction.text === text && instruction.scope === visible.scope && instruction.editionId === editionId,
      );
      pendingDirections.current.delete(owner);
      try { localStorage.removeItem(directionRequestStorageKey(reader.id, owner)); } catch { /* Retry metadata is best effort. */ }
      if (confirmed) {
        await workspace.updateDraft(owner, "editorial", "");
        patchDirectionUi(owner, { error: "", status: `${owner[0].toUpperCase()}${owner.slice(1)} direction was already saved. Existing content is unchanged; no new writing was requested.` });
      } else {
        patchDirectionUi(owner, { error: "Your direction changed since this unconfirmed request. Review the current direction before making another change." });
      }
      return;
    }
    const pending: PendingDirection = samePrevious && samePrevious.expectedRevision === serverSection.revision
      ? samePrevious
      : {
          text,
          scope: visible.scope,
          editionId,
          expectedRevision: serverSection.revision,
          idempotencyKey: `direction-${crypto.randomUUID()}`,
        };
    pendingDirections.current.set(owner, pending);
    try { localStorage.setItem(directionRequestStorageKey(reader.id, owner), JSON.stringify(pending)); } catch { /* The in-memory key still protects this session. */ }
    patchDirectionUi(owner, { pending: true, error: "", status: "" });
    try {
      const body = {
        section: owner,
        text,
        scope: visible.scope,
        editionId,
        expectedRevision: pending.expectedRevision,
        idempotencyKey: pending.idempotencyKey,
      } satisfies CreateEditorialInstructionRequest;
      const mutation = editorialDirectionMutationResponseSchema.parse(
        await edisonApi<unknown>("/editorial-direction", {
          method: "POST",
          body: JSON.stringify(body),
        }),
      );
      if (mutation.section !== owner || mutation.previousRevision !== pending.expectedRevision) {
        throw new Error("Edison returned a direction revision for a different request.");
      }
      await readDirections();
      await workspace.updateDraft(owner, "editorial", "");
      pendingDirections.current.delete(owner);
      try { localStorage.removeItem(directionRequestStorageKey(reader.id, owner)); } catch { /* Saved direction is already confirmed by the API. */ }
      patchDirectionUi(owner, {
        pending: false,
        error: "",
        status: `${owner[0].toUpperCase()}${owner.slice(1)} direction saved to your account. ${visible.scope === "persistent" ? "From now on" : "This edition only"}. Existing content is unchanged; no new writing was requested.`,
        mutationId: mutation.stillReversible ? mutation.mutationId : null,
        resultingRevision: mutation.stillReversible ? mutation.currentRevision : null,
      });
    } catch (error) {
      let reconciled: EditorialDirectionResponse | null = null;
      try { reconciled = await readDirections(); } catch { /* Unknown outcome stays retryable with the same key. */ }
      const confirmed = reconciled?.instructions.some((instruction) =>
        instruction.section === owner &&
        instruction.revision > pending.expectedRevision &&
        instruction.text === text &&
        instruction.scope === visible.scope &&
        instruction.editionId === editionId,
      );
      if (confirmed) {
        await workspace.updateDraft(owner, "editorial", "");
        pendingDirections.current.delete(owner);
        try { localStorage.removeItem(directionRequestStorageKey(reader.id, owner)); } catch { /* Saved direction is already reconciled. */ }
        patchDirectionUi(owner, {
          pending: false,
          error: "",
          status: `${owner[0].toUpperCase()}${owner.slice(1)} direction was saved. Existing content is unchanged; no new writing was requested.`,
          mutationId: null,
          resultingRevision: null,
        });
      } else {
        if (error instanceof EdisonApiError && error.status === 409) {
          pendingDirections.current.delete(owner);
          try { localStorage.removeItem(directionRequestStorageKey(reader.id, owner)); } catch { /* A stale key must not be reused in memory. */ }
        }
        patchDirectionUi(owner, {
          pending: false,
          status: "",
          error: reconciled
            ? handleError(error)
            : "Edison could not confirm whether that direction was saved. Your draft is still here; retrying will reuse the same request safely.",
        });
      }
    }
  }

  async function undoDirection(owner: PublicationSection) {
    const current = directionUi[owner];
    if (current.pending || current.resultingRevision === null) return;
    patchDirectionUi(owner, { pending: true, error: "", status: "" });
    if (dataMode !== "live") {
      const result = await workspace.undoDirection(owner, current.resultingRevision);
      patchDirectionUi(owner, {
        pending: false,
        error: result.ok ? "" : result.message,
        status: result.ok ? result.message : "",
        mutationId: null,
        resultingRevision: null,
      });
      return;
    }
    if (!current.mutationId) {
      patchDirectionUi(owner, { pending: false, error: "This saved change was reconciled after an uncertain response. Review direction before changing it again." });
      return;
    }
    try {
      const body = {
        section: owner,
        expectedRevision: current.resultingRevision,
        idempotencyKey: `undo-${crypto.randomUUID()}`,
      } satisfies UndoEditorialDirectionRequest;
      await edisonApi<EditorialDirectionMutationResponse>(
        `/editorial-direction/mutations/${encodeURIComponent(current.mutationId)}/undo`,
        { method: "POST", body: JSON.stringify(body) },
      );
      await readDirections();
      patchDirectionUi(owner, { pending: false, error: "", status: `${owner[0].toUpperCase()}${owner.slice(1)} editorial change undone.`, mutationId: null, resultingRevision: null });
    } catch (error) {
      try { await readDirections(); } catch { /* Preserve the original error. */ }
      patchDirectionUi(owner, { pending: false, status: "", error: handleError(error) });
    }
  }

  async function mutateLiveDirection(
    instruction: PublicationDirection,
    operation: "edit" | "remove",
    text?: string,
  ): Promise<{ ok: boolean; message: string }> {
    const owner = instruction.section;
    const serverSection = directionData?.sections.find((entry) => entry.section === owner);
    if (!serverSection) return { ok: false, message: "Reload account direction before making this change." };
    patchDirectionUi(owner, { pending: true, error: "", status: "" });
    try {
      if (operation === "edit") {
        const body = {
          section: owner,
          text: text?.trim() ?? "",
          scope: instruction.scope,
          editionId: instruction.editionId,
          expectedRevision: serverSection.revision,
          idempotencyKey: `direction-edit-${crypto.randomUUID()}`,
        } satisfies UpdateEditorialInstructionRequest;
        await edisonApi(`/editorial-direction/${encodeURIComponent(instruction.id)}`, {
          method: "PATCH",
          body: JSON.stringify(body),
        });
      } else {
        const body = {
          section: owner,
          expectedRevision: serverSection.revision,
          idempotencyKey: `direction-remove-${crypto.randomUUID()}`,
        } satisfies DeleteEditorialInstructionRequest;
        await edisonApi(`/editorial-direction/${encodeURIComponent(instruction.id)}`, {
          method: "DELETE",
          body: JSON.stringify(body),
        });
      }
      await readDirections();
      const message = `${owner[0].toUpperCase()}${owner.slice(1)} instruction ${operation === "edit" ? "updated" : "removed"}. Saved reading is unchanged.`;
      patchDirectionUi(owner, { pending: false, status: message, error: "" });
      return { ok: true, message };
    } catch (error) {
      try { await readDirections(); } catch { /* Keep the mutation failure visible. */ }
      const message = handleError(error);
      patchDirectionUi(owner, { pending: false, status: "", error: message });
      return { ok: false, message };
    }
  }

  const saveCreationState = useCallback((next: CreationState | null) => {
    setCreation(next);
    if (dataMode !== "live") return;
    try {
      if (next) localStorage.setItem(creationStorageKey(reader.id), JSON.stringify(next));
      else localStorage.removeItem(creationStorageKey(reader.id));
    } catch {
      // The API job is still durable. We avoid claiming device persistence.
    }
  }, [dataMode, reader.id]);

  useEffect(() => {
    if (dataMode !== "live") return;
    let active = true;
    try {
      const raw = localStorage.getItem(creationStorageKey(reader.id));
      if (raw) {
        const candidate = JSON.parse(raw) as Partial<CreationState>;
        if (candidate.section === "news" && typeof candidate.request === "string" &&
            typeof candidate.idempotencyKey === "string" && typeof candidate.jobId === "string" &&
            ["queued", "running", "succeeded", "failed", "cancelled"].includes(candidate.status ?? "")) {
          queueMicrotask(() => {
            if (active) setCreation(candidate as CreationState);
          });
        }
      }
      const pendingRaw = localStorage.getItem(creationRequestStorageKey(reader.id));
      if (pendingRaw) {
        const candidate = JSON.parse(pendingRaw) as Partial<PendingCreation>;
        if (typeof candidate.request === "string" && typeof candidate.idempotencyKey === "string") {
          pendingCreation.current = candidate as PendingCreation;
        }
      }
    } catch { /* Corrupt optional job UI state cannot create or retry work. */ }
    return () => { active = false; };
  }, [dataMode, reader.id]);

  useEffect(() => {
    if (
      dataMode !== "live" ||
      !reader.id ||
      !workspace.hydrated ||
      !directionData ||
      guestImportChecked.current
    ) return;
    guestImportChecked.current = true;
    let active = true;
    try {
      const guest = readPublicationWorkspace(localStorage);
      const hasWork = (["news", "books", "podcasts"] as PublicationSection[])
        .some((owner) => {
          const state = guest.sections[owner];
          return state.directions.length > 0 ||
            Boolean(state.editorialDraft.trim()) ||
            Boolean(state.creationDraft.trim());
        });
      const importedVersion = Number(
        localStorage.getItem(guestImportMarkerKey(reader.id)) ?? "-1",
      );
      if (hasWork && (!Number.isFinite(importedVersion) || guest.version > importedVersion)) {
        queueMicrotask(() => {
          if (!active) return;
          setGuestWorkspace(guest);
          setGuestImportError("");
          setGuestImportOpen(true);
        });
      }
    } catch {
      // Guest storage remains untouched. Returning to guest mode exposes its
      // existing recovery message instead of overwriting corrupt data here.
    }
    return () => { active = false; };
  }, [dataMode, directionData, reader.id, workspace.hydrated]);

  async function importGuestDirections() {
    if (!guestWorkspace || !reader.id || dataMode !== "live" || !directionData || guestImportPending) return;
    setGuestImportPending(true);
    setGuestImportError("");
    let imported = 0;
    let skipped = 0;
    let copiedDrafts = 0;
    let conflictingDrafts = 0;

    const allGuestDirections = (["news", "books", "podcasts"] as PublicationSection[])
      .flatMap((owner) => guestWorkspace.sections[owner].directions);
    let server = directionData;

    const alreadyPresent = (
      instruction: PublicationDirection,
      editionId: string | null,
    ) => server.instructions.some((candidate) =>
      candidate.section === instruction.section &&
      candidate.text === instruction.text &&
      candidate.scope === instruction.scope &&
      candidate.editionId === editionId,
    );

    try {
      server = await readDirections();
      for (const instruction of allGuestDirections) {
        let accepted = false;
        for (let attempt = 0; attempt < 2 && !accepted; attempt += 1) {
          const state = server.sections.find(
            (candidate) => candidate.section === instruction.section,
          );
          if (!state) throw new Error("The account direction is incomplete.");
          const editionId = instruction.scope === "edition"
            ? state.currentEditionId
            : null;
          if (alreadyPresent(instruction, editionId)) {
            skipped += 1;
            accepted = true;
            break;
          }

          const body = {
            section: instruction.section,
            text: instruction.text,
            scope: instruction.scope,
            editionId,
            expectedRevision: state.revision,
            idempotencyKey: guestDirectionImportKey(instruction),
          } satisfies CreateEditorialInstructionRequest;
          try {
            editorialDirectionMutationResponseSchema.parse(
              await edisonApi<unknown>("/editorial-direction", {
                method: "POST",
                body: JSON.stringify(body),
              }),
            );
            imported += 1;
            server = await readDirections();
            accepted = true;
          } catch (error) {
            server = await readDirections();
            if (alreadyPresent(instruction, editionId)) {
              imported += 1;
              accepted = true;
            } else if (attempt === 1) {
              throw error;
            }
          }
        }
      }

      for (const owner of ["news", "books", "podcasts"] as PublicationSection[]) {
        const guestSection = guestWorkspace.sections[owner];
        const accountSection = workspace.workspace.sections[owner];
        for (const kind of ["editorial", "creation"] as const) {
          const guestDraft = guestSection[`${kind}Draft`].trim();
          if (!guestDraft) continue;
          const accountDraft = accountSection[`${kind}Draft`].trim();
          if (accountDraft && accountDraft !== guestDraft) {
            conflictingDrafts += 1;
            continue;
          }
          if (!accountDraft) {
            if (kind === "editorial") {
              const scopeResult = await workspace.updateScope(owner, guestSection.scope);
              if (!scopeResult.ok) throw new Error(scopeResult.message);
            }
            const draftResult = await workspace.updateDraft(owner, kind, guestDraft);
            if (!draftResult.ok) throw new Error(draftResult.message);
            copiedDrafts += 1;
          }
        }
      }

      localStorage.setItem(
        guestImportMarkerKey(reader.id),
        String(guestWorkspace.version),
      );
      setGuestImportOpen(false);
      setGuestWorkspace(null);
      const parts = [
        imported ? `${imported} guest ${imported === 1 ? "instruction" : "instructions"} added` : "No new instructions needed",
        skipped ? `${skipped} already present` : "",
        copiedDrafts ? `${copiedDrafts} ${copiedDrafts === 1 ? "draft" : "drafts"} copied` : "",
        conflictingDrafts ? `${conflictingDrafts} different account ${conflictingDrafts === 1 ? "draft was" : "drafts were"} left untouched` : "",
      ].filter(Boolean);
      showNotice(`${parts.join(" · ")}. Guest notes remain saved on this device.`, "success");
    } catch (error) {
      setGuestImportError(
        `${handleError(error)} Any guest notes and unconfirmed imports remain available; retrying will reconcile before adding anything.`,
      );
    } finally {
      setGuestImportPending(false);
    }
  }

  useEffect(() => {
    if (dataMode !== "live") return;
    for (const owner of ["news", "books", "podcasts"] as PublicationSection[]) {
      try {
        const raw = localStorage.getItem(directionRequestStorageKey(reader.id, owner));
        if (!raw) continue;
        const candidate = JSON.parse(raw) as Partial<PendingDirection>;
        if (typeof candidate.text === "string" &&
            (candidate.scope === "persistent" || candidate.scope === "edition") &&
            (candidate.editionId === null || typeof candidate.editionId === "string") &&
            typeof candidate.expectedRevision === "number" &&
            Number.isInteger(candidate.expectedRevision) &&
            typeof candidate.idempotencyKey === "string") {
          pendingDirections.current.set(owner, candidate as PendingDirection);
        }
      } catch { /* Corrupt retry metadata is never submitted. */ }
    }
  }, [dataMode, reader.id]);

  useEffect(() => {
    if (dataMode !== "live" || !creation || !["queued", "running"].includes(creation.status)) return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const poll = async () => {
      try {
        const job = await edisonApi<GenerationJob>(`/generation-jobs/${encodeURIComponent(creation.jobId)}`);
        if (!active) return;
        const next = { ...creation, status: job.status, outputArticleId: job.outputArticleId };
        saveCreationState(next);
        if (job.status === "succeeded" && job.outputArticleId) {
          const ready = await edisonApi<Article>(`/articles/${encodeURIComponent(job.outputArticleId)}`);
          articleCache.current.set(ready.id, ready);
          setOneOffStatus("Your commissioned article is ready.");
          return;
        }
        if (job.status === "failed" || job.status === "cancelled") {
          setOneOffError("The article could not be written. Your editorial direction is unchanged.");
          return;
        }
        timer = setTimeout(poll, 3_000);
      } catch {
        if (active) timer = setTimeout(poll, 5_000);
      }
    };
    timer = setTimeout(poll, 1_500);
    return () => { active = false; if (timer) clearTimeout(timer); };
  }, [creation, dataMode, saveCreationState]);

  async function submitOneOff() {
    const owner = section;
    const request = workspace.workspace.sections[owner].creationDraft.trim();
    if (owner !== "news" || dataMode !== "live" || !request || creationSubmitting) return;
    const prior = pendingCreation.current?.request === request ? pendingCreation.current : null;
    const idempotencyKey = prior?.idempotencyKey ?? `one-off-article-${crypto.randomUUID()}`;
    pendingCreation.current = { request, idempotencyKey };
    try {
      localStorage.setItem(creationRequestStorageKey(reader.id), JSON.stringify(pendingCreation.current));
    } catch { /* The in-memory key still protects this browser session. */ }
    setCreationSubmitting(true);
    setOneOffError("");
    try {
      const job = await edisonApi<GenerationJob>("/generation-jobs", {
        method: "POST",
        body: JSON.stringify({ kind: "feed-replenishment", topic: request, idempotencyKey }),
      });
      const next: CreationState = { section: "news", request, idempotencyKey, jobId: job.id, status: job.status, outputArticleId: job.outputArticleId };
      saveCreationState(next);
      pendingCreation.current = null;
      try { localStorage.removeItem(creationRequestStorageKey(reader.id)); } catch { /* Accepted job state is already retained where possible. */ }
      await workspace.updateDraft(owner, "creation", "");
      setOneOffStatus(job.status === "succeeded" ? "Your commissioned article is ready." : "Your article is queued. Your News direction is unchanged.");
    } catch (error) {
      setOneOffError(error instanceof EdisonApiError && error.status >= 500
        ? "Edison could not confirm the request. Your draft is still here; retrying will reuse the same logical request."
        : handleError(error));
    } finally {
      setCreationSubmitting(false);
    }
  }

  async function submitQuestion() {
    if (
      dataMode !== "live" ||
      !article ||
      !reader.id ||
      publicArticleIds.has(article.id) ||
      article.writtenFor === "the public edition"
    ) return;
    const owner = article.id;
    const message = (questionDrafts[owner] ?? "").trim();
    if (!message || questionPending[owner]) return;
    const prior = questionRequests.current.get(owner);
    const request = prior?.message === message ? prior : { message, idempotencyKey: `question-${crypto.randomUUID()}` };
    questionRequests.current.set(owner, request);
    try {
      localStorage.setItem(
        questionRequestStorageKey(reader.id, owner),
        JSON.stringify({ request: request.message, idempotencyKey: request.idempotencyKey }),
      );
    } catch {
      // The in-memory key still protects retries in this browser session.
    }
    setQuestionPending((current) => ({ ...current, [owner]: true }));
    setConversationErrors((current) => ({ ...current, [owner]: "" }));
    try {
      const response = conversationResponseSchema.parse(
        await edisonApi<unknown>(`/articles/${encodeURIComponent(owner)}/conversation`, {
          method: "POST",
          body: JSON.stringify(request),
        }),
      ) as ConversationResponse;
      const answeredAt = Date.now();
      const incoming: ConversationMessage[] = [
        {
          id: response.userMessageId,
          role: "user",
          content: message,
          citations: [],
          createdAt: new Date(answeredAt).toISOString(),
        },
        {
          id: response.assistantMessageId,
          role: "assistant",
          content: response.answer,
          citations: response.citations,
          createdAt: new Date(answeredAt + 1).toISOString(),
        },
      ];
      questionRequests.current.delete(owner);
      try {
        localStorage.removeItem(questionRequestStorageKey(reader.id, owner));
      } catch {
        // The accepted conversation remains durable on the server.
      }
      setQuestionDrafts((current) => ({ ...current, [owner]: "" }));
      continuity.rememberDraft(owner, "");
      setConversationMessages((current) => ({
        ...current,
        [owner]: mergeConversationMessages(current[owner] ?? [], incoming),
      }));
      showNotice(pulseEnabled ? "Your answer is ready in this conversation." : "Edison answered your follow-up below the article.", "success");
    } catch (error) {
      const message = handleError(error);
      setConversationErrors((current) => ({ ...current, [owner]: message }));
      showNotice(message, "error");
    } finally {
      setQuestionPending((current) => ({ ...current, [owner]: false }));
    }
  }

  const orderedCategorySettings = useMemo(() => profile
    ? [...profile.preferences.categories].sort((a, b) => a.position - b.position)
    : [], [profile]);

  async function setCategoryVisibility(changedCategory: ContentCategory, visible: boolean) {
    if (dataMode !== "live" || !profile || changedCategory === "for-you" || updatingCategories) return;
    if (!visible && profile.preferences.categories.filter((entry) => entry.visible).length <= 1) {
      showNotice("Keep at least one News category visible.");
      return;
    }
    const previous = profile;
    const categories = profile.preferences.categories.map((entry) => entry.category === changedCategory ? { ...entry, visible } : entry);
    setUpdatingCategories(true);
    setProfile({ ...profile, preferences: { ...profile.preferences, categories } });
    try {
      setProfile(await edisonApi<ReaderProfile>("/me", { method: "PATCH", body: JSON.stringify({ categories }) }));
    } catch (error) {
      setProfile(previous);
      showNotice(handleError(error), "error");
    } finally { setUpdatingCategories(false); }
  }

  async function moveCategory(changedCategory: ArticleCategory, direction: -1 | 1) {
    if (dataMode !== "live" || !profile || updatingCategories) return;
    const ordered = [...profile.preferences.categories].sort((a, b) => a.position - b.position);
    const currentIndex = ordered.findIndex((entry) => entry.category === changedCategory);
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;
    [ordered[currentIndex], ordered[nextIndex]] = [ordered[nextIndex], ordered[currentIndex]];
    const categories = ordered.map((entry, position) => ({ ...entry, position }));
    const previous = profile;
    setUpdatingCategories(true);
    setProfile({ ...profile, preferences: { ...profile.preferences, categories } });
    try {
      setProfile(await edisonApi<ReaderProfile>("/me", { method: "PATCH", body: JSON.stringify({ categories }) }));
    } catch (error) {
      setProfile(previous);
      showNotice(handleError(error), "error");
    } finally { setUpdatingCategories(false); }
  }

  async function updatePreference(patch: Partial<Pick<ReaderProfile["preferences"], "articleLength" | "depth" | "novelty">>) {
    if (dataMode !== "live" || !profile || updatingPreference) return;
    const previous = profile;
    setUpdatingPreference(true);
    setProfile({ ...profile, preferences: { ...profile.preferences, ...patch } });
    try {
      setProfile(await edisonApi<ReaderProfile>("/me", { method: "PATCH", body: JSON.stringify(patch) }));
    } catch (error) {
      setProfile(previous);
      showNotice(handleError(error), "error");
    } finally { setUpdatingPreference(false); }
  }

  function storeExplicitInterest(next: ExplicitInterest) {
    setProfile((current) => current ? {
      ...current,
      preferences: {
        ...current.preferences,
        explicitInterests: [...current.preferences.explicitInterests.filter((item) => item.id !== next.id), next]
          .sort((a, b) => a.topic.localeCompare(b.topic)),
      },
    } : current);
  }

  async function addExplicitInterest(topic: string) {
    if (!profile || interestAction || dataMode !== "live") return false;
    setInterestAction("add");
    try {
      const next = await edisonApi<ExplicitInterest>("/me/interests", { method: "POST", body: JSON.stringify({ topic }) });
      storeExplicitInterest(next);
      showNotice(`${next.topic} will shape future stories.`, "success");
      return true;
    } catch (error) { showNotice(handleError(error), "error"); return false; }
    finally { setInterestAction(null); }
  }

  async function updateExplicitInterestStatus(id: string, status: ExplicitInterestStatus) {
    if (!profile || interestAction || dataMode !== "live") return;
    setInterestAction(`${id}:status`);
    try {
      const next = await edisonApi<ExplicitInterest>(`/me/interests/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify({ status }) });
      storeExplicitInterest(next);
    } catch (error) { showNotice(handleError(error), "error"); }
    finally { setInterestAction(null); }
  }

  async function deleteExplicitInterest(id: string) {
    if (!profile || interestAction || dataMode !== "live") return;
    setInterestAction(`${id}:delete`);
    try {
      await edisonApi<void>(`/me/interests/${encodeURIComponent(id)}`, { method: "DELETE" });
      setProfile((current) => current ? { ...current, preferences: { ...current.preferences, explicitInterests: current.preferences.explicitInterests.filter((item) => item.id !== id) } } : current);
    } catch (error) { showNotice(handleError(error), "error"); }
    finally { setInterestAction(null); }
  }

  async function removeLearnedInterest(interest: { label: string }) {
    if (!profile || dataMode !== "live") {
      return {
        ok: false,
        message: "Learned account interests are unavailable without a connected account.",
      };
    }
    try {
      const updated = await edisonApi<ReaderProfile>(
        "/me/inferred-preferences",
        {
          method: "DELETE",
          body: JSON.stringify({ preference: interest.label }),
        },
      );
      setProfile(updated);
      return {
        ok: true,
        message: `Removed “${interest.label}” from what Edison has learned.`,
      };
    } catch (error) {
      return { ok: false, message: handleError(error) };
    }
  }

  const directions: PublicationDirection[] = dataMode === "live"
    ? directionData?.instructions.map(toDirection) ?? []
    : (["news", "books", "podcasts"] as PublicationSection[]).flatMap((owner) =>
        workspace.workspace.sections[owner].directions.map((direction) => ({
          ...direction,
          activeForCurrentEdition: direction.scope === "persistent" || direction.editionId === editionIdFor(owner),
        })),
      );
  const guestDirections = guestWorkspace
    ? (["news", "books", "podcasts"] as PublicationSection[]).flatMap(
        (owner) => guestWorkspace.sections[owner].directions,
      )
    : [];
  const guestDraftCount = guestWorkspace
    ? (["news", "books", "podcasts"] as PublicationSection[]).reduce(
        (count, owner) => count +
          Number(Boolean(guestWorkspace.sections[owner].editorialDraft.trim())) +
          Number(Boolean(guestWorkspace.sections[owner].creationDraft.trim())),
        0,
      )
    : 0;
  const guestDraftConflictCount = guestWorkspace
    ? (["news", "books", "podcasts"] as PublicationSection[]).reduce(
        (count, owner) => {
          const guest = guestWorkspace.sections[owner];
          const account = workspace.workspace.sections[owner];
          return count + (["editorial", "creation"] as const).filter((kind) => {
            const guestDraft = guest[`${kind}Draft`].trim();
            const accountDraft = account[`${kind}Draft`].trim();
            return guestDraft && accountDraft && guestDraft !== accountDraft;
          }).length;
        },
        0,
      )
    : 0;
  const currentDirectionUi = directionUi[section];
  const currentEditionId = editionIdFor(section);
  const showingPersonalNews = dataMode === "live" && !usingStarter && Boolean(personalEdition);
  const editionDate = section === "news"
    ? showingPersonalNews
      ? personalEdition?.editionDate ?? ""
      : usingStarter
        ? starterEdition?.editionDate ?? prototypeResearchedAt ?? ""
        : prototypeResearchedAt ?? ""
    : "";
  const personalLabel = showingPersonalNews && name
    ? `Edited for ${name}`
    : starterEdition?.label ?? "A place to begin";
  const itemCount = section === "news"
    ? showingPersonalNews
      ? personalEdition?.itemCount ?? stories.length
      : usingStarter
        ? starterEdition?.itemCount ?? stories.length
        : stories.length
    : 0;
  const articleIsPublic = article
    ? knownPublicArticleIds.has(article.id) || article.writtenFor === "the public edition"
    : false;
  const oneOffUnavailable = section === "books"
    ? "Book publishing and a book reader are not connected yet. Browser storage keeps the draft on this device when available."
    : section === "podcasts"
      ? "Podcast publishing and playback are not connected yet. Browser storage keeps the draft on this device when available."
      : dataMode === "live" ? undefined
        : dataMode === "guest" ? "Sign in to commission an article. Public reading does not require an account."
          : "AI article generation is not connected in this demo. Browser storage keeps the draft on this device when available.";

  const readerContent = (
    <>
      {view === "home" && pulseEnabled && (
        <PulseFeed
          articles={pulseArticles}
          activeLoopLabel={activeLoopLabel}
          intro={activeLoop
            ? activeLoop.direction || `Keep exploring ${activeLoop.title}.`
            : readingLoops.loops.length ? "Ready reading from the subjects you’re exploring." : "A few worthwhile reads, selected from Edison’s collection."}
          artworkByArticleId={preparedArtworkByArticleId}
          loading={loading || readingLoops.loading}
          error={feedError || readingLoops.error || readingLoops.device.error || continuity.error}
          onOpenArticle={openStory}
          onToggleSave={toggleSave}
          emptyState={<div className="pulse-empty"><h2>No ready article here yet</h2><p>{activeLoop ? dataMode === "live" ? "Your subject is saved. Future scheduled reading can use it; no new article has been requested by adding this loop." : "Your subject is saved on this device. We don’t have prepared reading for it yet." : "There are no ready articles in this selection."}</p><button type="button" onClick={() => navigate({ section: "news", view: "home", articleId: null, loopId: "collection" })}>Browse prepared reading</button><button type="button" onClick={() => { setNewLoopError(""); setNewLoopOpen(true); }}>Explore another subject</button></div>}
        >
          {readingLoops.error && <button type="button" onClick={() => void readingLoops.reload().catch((error) => showNotice(handleError(error), "error"))}>Retry loops</button>}
          {!readingLoops.loops.length && <button className="editorial-text-action" type="button" onClick={() => setNewLoopOpen(true)}>What&apos;s something you want to learn more about?</button>}
          {activeLoopId !== "collection" && readingLoops.loops.length > 0 && <button className="editorial-text-action" type="button" onClick={() => navigate({ section: "news", view: "home", articleId: null, loopId: "collection" })}>Browse the prepared collection</button>}
          {dataMode === "live" && <button className="editorial-text-action" type="button" onClick={() => { setOneOffError(""); setOneOffOpen(true); }}>Commission one article</button>}
          {creation && <p role="status">{creation.status === "succeeded" ? "Your commissioned article is ready." : creation.status === "failed" || creation.status === "cancelled" ? "Your commissioned article could not be written. Your draft is preserved." : "Your commissioned article is being prepared."}{creation.outputArticleId && <button type="button" onClick={() => navigate({ section: "news", view: "article", articleId: creation.outputArticleId, loopId: activeLoopId })}>Read commissioned article</button>}</p>}
        </PulseFeed>
      )}
      {view === "home" && !pulseEnabled && (
        <main className="publication-content">
          {section !== "news" && <h1 className="visually-hidden">{section === "books" ? "Books" : "Podcasts"}</h1>}
          <PublicationFolio section={section} editionDate={editionDate} personalLabel={personalLabel} count={itemCount} />
          <EditorialComposer
            section={section}
            value={sectionWorkspace.editorialDraft}
            scope={sectionWorkspace.scope}
            pending={currentDirectionUi.pending}
            disabled={!workspace.hydrated}
            error={currentDirectionUi.error || (dataMode === "live" ? directionLoadError : "") || workspace.storageError || undefined}
            status={currentDirectionUi.status}
            onChange={(value) => { patchDirectionUi(section, { error: "", status: "" }); void workspace.updateDraft(section, "editorial", value); }}
            onScopeChange={(scope) => { patchDirectionUi(section, { error: "", status: "" }); void workspace.updateScope(section, scope); }}
            onSubmit={submitDirection}
            onReview={() => openDirectionReview(section)}
          />
          {(currentDirectionUi.resultingRevision !== null || currentDirectionUi.status) && (
            <div className="editorial-inline-actions publication-direction-actions">
              {currentDirectionUi.resultingRevision !== null && (
                <button className="editorial-text-action" type="button" disabled={currentDirectionUi.pending} onClick={() => void undoDirection(section)}>Undo</button>
              )}
              <button className="editorial-text-action" type="button" onClick={() => openDirectionReview(section)}>Review direction</button>
            </div>
          )}
          {creation && creation.section === section && (
            <div className="publication-creation-status" role="status">
              <p>{creation.status === "succeeded"
                ? "Your commissioned article is ready."
                : creation.status === "failed" || creation.status === "cancelled"
                  ? "The commissioned article could not be written."
                  : "Your commissioned article is being written. The current edition remains readable."}</p>
              {creation.status === "succeeded" && creation.outputArticleId && (
                <button type="button" className="editorial-text-action" onClick={() => navigate({ section: "news", view: "article", articleId: creation.outputArticleId })}>Read commissioned article</button>
              )}
              {(creation.status === "failed" || creation.status === "cancelled") && (
                <button type="button" className="editorial-text-action" onClick={() => { void workspace.updateDraft("news", "creation", creation.request); saveCreationState(null); setOneOffOpen(true); }}>Retry from saved request</button>
              )}
            </div>
          )}

          {section === "news" && (
            <NewsHome
              stories={stories}
              dataMode={dataMode}
              usingStarter={usingStarter}
              loading={loading}
              error={feedError}
              openStory={openStory}
              setSummary={setSummary}
              toggleSave={toggleSave}
              longPressTimer={longPressTimer}
            />
          )}
          {section === "books" && <BooksHome books={[]} editionId={currentEditionId || undefined} connected={false} />}
          {section === "podcasts" && <PodcastsHome episodes={[]} editionId={currentEditionId || undefined} connected={false} />}
        </main>
      )}

      {view === "article" && (article ? (
        <ArticleView
          key={article.id}
          article={pulseEnabled && articleIsPublic ? { ...article, saved: savedPublic.some((saved) => saved.id === article.id) } : article}
          conversationMessages={conversationMessages[article.id] ?? []}
          conversationLoading={conversationLoading[article.id] ?? false}
          conversationError={conversationErrors[article.id] || undefined}
          dataMode={articleIsPublic
            ? dataMode === "live" ? "public" : "guest"
            : dataMode}
          back={backHome}
          backLabel={pulseEnabled ? typeof window !== "undefined" && window.history.state?.__edisonArticleReturnRoute?.view === "library" ? "Back to Library" : `Back to ${activeLoopLabel}` : undefined}
          nextArticle={pulseEnabled ? nextArticle : null}
          onNext={pulseEnabled && nextArticle ? () => {
            if (readingJourney) continuity.rememberJourney(nextArticle.id, { ...readingJourney, returnArticleId: nextArticle.id });
            void openStory(nextArticle);
          } : undefined}
          onAsk={pulseEnabled ? () => setAskOpen(true) : undefined}
          deviceSave={pulseEnabled && articleIsPublic}
          pulse={pulseEnabled}
          save={() => void toggleSave(article)}
          onError={(error) => showNotice(handleError(error), "error")}
          onCompleted={(currentStreak) => {
            patchStory(article.id, { completed: true });
            if (profile) setProfile({ ...profile, currentStreak });
          }}
          onShared={(shareId) => setArticle((current) => current ? { ...current, shareId } : current)}
        />
      ) : (
        <DataStatus icon={articleError ? <AlertCircle /> : <LoaderCircle className="spin" />} tone={articleError ? "error" : "default"}>
          {articleError || "Opening this story…"}
        </DataStatus>
      ))}

      {view === "library" && (
        <LibraryView
          dataMode={dataMode}
          library={library}
          fallbackSaved={pulseEnabled ? savedPublic : stories.filter((story) => story.saved)}
          deviceSaved={pulseEnabled}
          loops={pulseEnabled ? readingLoops.loops : undefined}
          openLoop={(loopId) => navigate({ section: "news", view: "home", articleId: null, loopId })}
          loading={libraryLoading}
          error={libraryError}
          back={backHome}
          open={openStory}
          openArticle={(articleId) => navigate({ section: "news", view: "article", articleId, ...(route.loopId ? { loopId: route.loopId } : {}) })}
        />
      )}

      {view === "profile" && (
        <ProfileView
          dataMode={dataMode}
          reader={{ name, email }}
          profile={profile}
          loading={profileLoading}
          error={profileError}
          streak={streak}
          back={backHome}
          preferenceSaving={updatingPreference}
          interestAction={interestAction}
          updatePreference={updatePreference}
          addInterest={addExplicitInterest}
          updateInterestStatus={updateExplicitInterestStatus}
          deleteInterest={deleteExplicitInterest}
          manageCategories={() => setManage(true)}
          reviewDirection={() => openDirectionReview(section)}
          deviceSettings={pulseEnabled && <section className="pulse-device-settings" aria-label="Device reading data">
        <h2>Reading on this device</h2>
        <p>Public saves and unfinished drafts stay on this device. Guest loops are separate from account loops.</p>
        {dataMode === "live" && readingLoops.guestLoops.length > 0 && <>
          <p>{readingLoops.guestLoops.length} guest {readingLoops.guestLoops.length === 1 ? "loop is" : "loops are"} available on this device. Importing adds missing loops and leaves matching account loops untouched. It does not request generation.</p>
          <button type="button" disabled={readingLoops.pending} onClick={() => void readingLoops.importGuestLoops().then(({ imported, skipped }) => showNotice(`${imported} loops added; ${skipped} matching account loops left untouched. Guest originals remain on this device.`, "success")).catch((error) => showNotice(`${handleError(error)} Guest originals remain available; retrying will not overwrite account loops.`, "error"))}>Add guest loops to my account</button>
        </>}
        <button type="button" onClick={() => setClearDeviceOpen(true)}>Clear local Pulse data</button>
        <details><summary>Other publication formats</summary><p>Books and podcasts are not connected yet.</p><button type="button" onClick={() => goHome("books")}>Books</button><button type="button" onClick={() => goHome("podcasts")}>Podcasts</button></details>
      </section>}
        />
      )}

      {view === "article" && article && dataMode === "live" && !articleIsPublic && !pulseEnabled && (
        <div className="composer-wrap">
          <div className="prompt-chips">
            {["Go deeper", "Counterpoint", "Historical context"].map((prompt) => (
              <button key={prompt} type="button" onClick={() => setQuestionDrafts((current) => ({ ...current, [article.id]: prompt }))}>{prompt}</button>
            ))}
          </div>
          <div className="composer">
            <EdisonMark className="composer-mark" />
            <input
              aria-label="Ask about this article"
              value={questionDrafts[article.id] ?? ""}
              maxLength={4_000}
              onChange={(event) => setQuestionDrafts((current) => ({ ...current, [article.id]: event.target.value }))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.nativeEvent.isComposing && event.nativeEvent.keyCode !== 229) {
                  event.preventDefault();
                  void submitQuestion();
                }
              }}
              placeholder="Ask about this article…"
              disabled={questionPending[article.id]}
            />
            <button type="button" onClick={() => void submitQuestion()} disabled={questionPending[article.id] || !(questionDrafts[article.id] ?? "").trim()} aria-label="Send article question">
              {questionPending[article.id] ? <LoaderCircle className="spin" /> : <Send />}
            </button>
          </div>
        </div>
      )}

      {pulseEnabled && <>
        <Sheet open={clearDeviceOpen} onOpenChange={setClearDeviceOpen}>
          <SheetContent><SheetHeader><SheetTitle>Clear local Pulse data?</SheetTitle><SheetDescription>This removes {dataMode === "guest" ? "guest loops, " : ""}public saves, Pulse loop and direction drafts, pending article questions, and this tab’s reading positions. Account articles, loops, saves and conversations are not deleted. Older publication-format drafts are kept.</SheetDescription></SheetHeader><button type="button" onClick={() => setClearDeviceOpen(false)}>Keep my data</button><button type="button" disabled={Object.values(questionPending).some(Boolean)} onClick={() => void readingLoops.device.update(() => emptyPulseWorkspace()).then(() => { clearPendingArticleQuestions(localStorage, reader.id); continuity.clear(); questionRequests.current.clear(); setQuestionDrafts({}); setNewLoopDraft(""); setCurateDrafts({}); setClearDeviceOpen(false); showNotice("Local Pulse data cleared. Account data was not deleted.", "success"); }).catch((error) => showNotice(`Some local data could not be cleared. ${handleError(error)}`, "error"))}>Clear local Pulse data</button></SheetContent>
        </Sheet>
        <CurateDialog
          open={curateOpen}
          loops={readingLoops.loops}
          selectedLoopId={curateLoopId}
          draftText={curateDrafts[curateLoopId] ?? selectedCurateLoop?.direction ?? ""}
          currentDirection={selectedCurateLoop?.direction ?? ""}
          history={selectedCurateLoop?.history ?? []}
          lastMutationId={selectedCurateLoop?.lastMutationId}
          pending={readingLoops.pending}
          error={curateError || readingLoops.error || readingLoops.device.error}
          status={curateStatus || (dataMode === "guest" ? "Directions stay on this device; guest reading is selected from prepared articles, not generated." : "Saved direction applies to future reading, not this article.")}
          requireLoopSelection={!activeLoop}
          onOpenChange={setCurateOpen}
          onSelectLoop={(id) => { setCurateLoopId(id); setCurateError(""); setCurateStatus(""); }}
          onDraftChange={(value) => {
            if (!curateLoopId) return;
            setCurateDrafts((current) => ({ ...current, [curateLoopId]: value }));
            void readingLoops.device.update((workspace) => ({ ...workspace, directionDrafts: { ...workspace.directionDrafts, [curateLoopId]: value } })).catch(() => undefined);
          }}
          onSubmit={() => curate()}
          onUndo={() => selectedCurateLoop?.lastMutationId ? curate(selectedCurateLoop.lastMutationId) : Promise.resolve()}
        />
        <NewLoopDialog
          open={newLoopOpen}
          draftText={newLoopDraft}
          suggestions={preparedSuggestions(allReadable)}
          pending={readingLoops.pending}
          error={newLoopError || readingLoops.device.error}
          status={dataMode === "live" ? "Your loops sync to your Edison account. Adding a loop does not request immediate generation." : "Loops and public saves stay on this device. No account is needed to read the collection."}
          onOpenChange={setNewLoopOpen}
          onDraftChange={(value) => { setNewLoopDraft(value); setNewLoopError(""); void readingLoops.device.update((workspace) => ({ ...workspace, newLoopDraft: value })).catch(() => undefined); }}
          onSubmit={createLoop}
        />
        <Sheet open={askOpen && view === "article"} onOpenChange={setAskOpen}>
          <SheetContent className="pulse-ask-sheet">
            <SheetHeader><SheetTitle>Ask about this article</SheetTitle><SheetDescription>{article?.title}. Questions stay with this article and do not change a loop’s direction.</SheetDescription></SheetHeader>
            {article && <>
              <div className="pulse-question-messages" aria-live="polite">
                {(conversationMessages[article.id] ?? []).map((message) => <div key={message.id}><b>{message.role === "user" ? "You" : "Edison"}</b><p>{message.content}</p>{message.citations.map((citation) => { const source = article.sources.find((entry) => entry.id === citation.sourceId); return source ? <a key={`${citation.sourceId}-${citation.label}`} href={source.url} target="_blank" rel="noreferrer">{citation.label} · {source.publisher}</a> : null; })}</div>)}
                {conversationLoading[article.id] && <p>Opening this conversation…</p>}
                {conversationErrors[article.id] && <p role="alert">{conversationErrors[article.id]}</p>}
              </div>
              <label htmlFor="pulse-article-question">Your question</label>
              <textarea id="pulse-article-question" maxLength={4000} value={questionDrafts[article.id] ?? ""} onChange={(event) => { const value = event.target.value; setQuestionDrafts((current) => ({ ...current, [article.id]: value })); continuity.rememberDraft(article.id, value); }} />
              {continuity.error && <p role="alert">{continuity.error}</p>}
              {dataMode === "live" && !articleIsPublic
                ? <button type="button" className="primary" disabled={questionPending[article.id] || !(questionDrafts[article.id] ?? "").trim()} onClick={() => void submitQuestion()}>{questionPending[article.id] ? "Getting an answer…" : "Ask Edison"}</button>
                : <p>Answers are available on your private Edison articles. This prepared public article does not have live Q&amp;A.{!continuity.error && " Your draft stays in this tab for reload."}</p>}
            </>}
          </SheetContent>
        </Sheet>
      </>}

      <OneOffComposer
        open={oneOffOpen}
        onOpenChange={setOneOffOpen}
        section={section}
        value={sectionWorkspace.creationDraft}
        onChange={(value) => { setOneOffError(""); setOneOffStatus(""); void workspace.updateDraft(section, "creation", value); }}
        onSubmit={submitOneOff}
        pending={creationSubmitting}
        disabled={!workspace.hydrated}
        unavailableReason={oneOffUnavailable}
        error={oneOffError || workspace.storageError || undefined}
        status={oneOffStatus}
      />

      <GuestDirectionImportDialog
        open={guestImportOpen}
        onOpenChange={setGuestImportOpen}
        instructions={guestDirections}
        draftCount={guestDraftCount}
        conflictingDraftCount={guestDraftConflictCount}
        pending={guestImportPending}
        error={guestImportError || undefined}
        onImport={importGuestDirections}
      />

      <EditorialDirectionReview
        open={directionReviewOpen}
        onOpenChange={setDirectionReviewOpen}
        section={reviewSection}
        onSectionChange={setReviewSection}
        instructions={directions}
        learnedInterests={(profile?.preferences.inferredPreferences ?? []).map((label, index) => ({ id: `inferred-${index}`, label }))}
        pending={directionUi[reviewSection].pending}
        hydrated={workspace.hydrated && (dataMode !== "live" || Boolean(directionData))}
        persistenceLabel={dataMode === "live" ? "Synced to your Edison account" : workspace.storageError ? undefined : "Saved on this device"}
        unavailableReason={dataMode === "live" ? directionLoadError || undefined : undefined}
        error={directionUi[reviewSection].error || undefined}
        status={directionUi[reviewSection].status}
        editionLabel={(id) => id === editionIdFor(reviewSection) ? "current edition" : "past edition"}
        onEdit={(instruction, text) => dataMode === "live"
          ? mutateLiveDirection(instruction, "edit", text)
          : workspace.editDirection(instruction.section, instruction.id, text, instruction.revision)}
        onRemove={(instruction) => dataMode === "live"
          ? mutateLiveDirection(instruction, "remove")
          : workspace.removeDirection(instruction.section, instruction.id, instruction.revision)}
        onRemoveLearnedInterest={dataMode === "live" ? removeLearnedInterest : undefined}
      />

      {notice && (
        <div
          className={`toast ${notice.tone}`}
          role={notice.tone === "error" ? "alert" : "status"}
        >
          {notice.tone === "error"
            ? <AlertCircle />
            : notice.tone === "success" ? <Check /> : <Info />}
          {notice.message}
        </div>
      )}

      <Sheet open={Boolean(summary)} onOpenChange={(open) => !open && setSummary(null)}>
        <SheetContent side="bottom" className="summary-sheet">
          <SheetHeader><SheetDescription>{summary?.kicker}</SheetDescription><SheetTitle>{summary?.title}</SheetTitle></SheetHeader>
          <ul>{summary?.summary.map((item) => <li key={item}>{item}</li>)}</ul>
          <button className="primary" onClick={() => summary && void openStory(summary)}>Read the full story <BookOpen /></button>
        </SheetContent>
      </Sheet>

      <Sheet open={manage} onOpenChange={setManage}>
        <SheetContent className="manage-sheet">
          <SheetHeader>
            <SheetTitle>Manage News categories</SheetTitle>
            <SheetDescription>{dataMode === "live" ? "Choose the categories that can shape your News edition and set their order." : "Category controls require a signed-in account."}</SheetDescription>
          </SheetHeader>
          {(profile ? orderedCategorySettings : categoryOrder.slice(1).map((entry, position) => ({ category: entry as ArticleCategory, position, visible: true }))).map((setting, index, settings) => (
            <div className="category-setting" key={setting.category}>
              <GripVertical aria-hidden="true" /><span>{categoryLabels[setting.category]}</span>
              <div className="category-actions"><div className="category-order-controls">
                <button type="button" aria-label={`Move ${categoryLabels[setting.category]} up`} disabled={dataMode !== "live" || updatingCategories || index === 0} onClick={() => void moveCategory(setting.category, -1)}><ChevronUp /></button>
                <button type="button" aria-label={`Move ${categoryLabels[setting.category]} down`} disabled={dataMode !== "live" || updatingCategories || index === settings.length - 1} onClick={() => void moveCategory(setting.category, 1)}><ChevronDown /></button>
              </div><Switch aria-label={`Show ${categoryLabels[setting.category]}`} checked={setting.visible} disabled={dataMode !== "live" || updatingCategories} onCheckedChange={(checked) => void setCategoryVisibility(setting.category, checked)} /></div>
            </div>
          ))}
        </SheetContent>
      </Sheet>
    </>
  );
  return pulseEnabled ? (
    <PulseShell loops={readingLoops.loops} activeLoopId={activeLoopId} showCurate={view === "home"} showLoopNavigation={view === "home"}
      onSelectLoop={(loopId) => navigate({ section: "news", view: "home", articleId: null, loopId })}
      onAddLoop={() => { setNewLoopError(""); setNewLoopOpen(true); }}
      onOpenHome={() => navigate({ section: "news", view: "home", articleId: null, loopId: "for-you" })}
      onOpenLibrary={openLibrary}
      onOpenProfile={() => navigate({ section, view: "profile", articleId: null, loopId: activeLoopId })}
      onOpenCurate={openCurate}>
      {readerContent}
    </PulseShell>
  ) : (
    <PublicationShell section={section} profileLabel={name || "Edison reader"} streak={streak} demo={dataMode === "prototype"} showCreate={view === "home"}
      onSectionChange={(next) => goHome(next)} onOpenProfile={() => navigate({ section, view: "profile", articleId: null })} onOpenLibrary={openLibrary}
      onCreate={() => { setOneOffError(""); setOneOffOpen(true); }}>
      {readerContent}
    </PublicationShell>
  );
}

function NewsHome({
  stories,
  dataMode,
  usingStarter,
  loading,
  error,
  openStory,
  setSummary,
  toggleSave,
  longPressTimer,
}: {
  stories: ArticleCard[];
  dataMode: DataMode;
  usingStarter: boolean;
  loading: boolean;
  error: string;
  openStory: (story: ArticleCard) => Promise<void>;
  setSummary: (story: ArticleCard) => void;
  toggleSave: (story: ArticleCard) => Promise<void>;
  longPressTimer: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
}) {
  const storyMode = dataMode === "prototype"
    ? "prototype"
    : dataMode === "guest"
      ? "guest"
      : usingStarter
        ? "public"
        : "live";
  if (loading && !stories.length) return <DataStatus icon={<LoaderCircle className="spin" />}>Opening today&apos;s edition…</DataStatus>;
  if (error && !stories.length) return <DataStatus icon={<AlertCircle />} tone="error">{error}</DataStatus>;
  if (!stories.length) return <div className="empty"><BookOpen /><h1>No ready News edition yet</h1><p>Edison has not received a published starter edition. No sample stories have been substituted.</p></div>;
  return <section className="publication-news-edition" aria-label="News stories">
    {error && <p className="editorial-dependency" role="status">{error}</p>}
    <StoryCard story={stories[0]} dataMode={storyMode} lead open={openStory} summary={setSummary} save={toggleSave} timerRef={longPressTimer} tone={storyTones[0]} />
    {stories.slice(1).map((story, index) => <StoryCard key={story.id} story={story} dataMode={storyMode} open={openStory} summary={setSummary} save={toggleSave} timerRef={longPressTimer} tone={storyTones[(index + 1) % storyTones.length]} />)}
    <div className="edition-end"><b><EdisonMark className="edition-mark" /></b><p>You&apos;re caught up.</p><span>{dataMode === "prototype" ? "You’ve reached the end of the sample edition. AI generation is off in this demo." : "You’ve reached the end of this finite News edition."}</span></div>
  </section>;
}
