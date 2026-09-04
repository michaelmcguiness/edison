"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useRouter } from "next/navigation";
import type {
  Article,
  ArticleCategory,
  ArticleCard,
  ContentCategory,
  ExplicitInterest,
  ExplicitInterestStatus,
  FeedCommandRequest,
  FeedResponse,
  GenerationJob,
  LibraryResponse,
  OnboardingRequest,
  Profile as ReaderProfile,
} from "@edison/contracts";
import {
  AlertCircle,
  ArrowRight,
  Bookmark,
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Flame,
  GripVertical,
  LoaderCircle,
  Send,
  Settings2,
} from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { ArticleView } from "@/components/edison/article-view";
import {
  DataStatus,
  LibraryView,
  ProfileView,
} from "@/components/edison/library-profile";
import { StoryCard, storyTones } from "@/components/edison/story-card";
import { EdisonLogo, EdisonMark } from "@/components/edison/brand";
import { edisonApi, EdisonApiError } from "@/lib/api-client";
import { makeDemoArticle, makeDemoStories } from "@/lib/demo-content";

const categoryLabels: Record<ContentCategory, string> = {
  "for-you": "For you",
  "tech-science": "Tech & Science",
  business: "Business",
  "arts-culture": "Arts & Culture",
  sports: "Sports",
  entertainment: "Entertainment",
};

const categoryOrder = Object.keys(categoryLabels) as ContentCategory[];
type View = "feed" | "article" | "library" | "profile";
type DataMode = "prototype" | "live";
type ConversationAnswer = {
  answer: string;
  citations: Array<{ sourceId: string; label: string }>;
};

function messageFor(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Edison could not complete that request.";
}

export function ReaderApp({
  reader,
  dataMode = "prototype",
  prototypeResearchedAt,
}: {
  reader: { name: string; email: string };
  dataMode?: DataMode;
  prototypeResearchedAt?: string;
}) {
  const router = useRouter();
  const prototypeStories = useMemo(
    () => makeDemoStories(prototypeResearchedAt ?? "1970-01-01T00:00:00.000Z"),
    [prototypeResearchedAt],
  );
  const [view, setView] = useState<View>("feed");
  const [category, setCategory] = useState<ContentCategory>("for-you");
  const [stories, setStories] = useState<ArticleCard[]>(
    dataMode === "prototype" ? prototypeStories : [],
  );
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingJobId, setPendingJobId] = useState<string | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [summary, setSummary] = useState<ArticleCard | null>(null);
  const [manage, setManage] = useState(false);
  const [composer, setComposer] = useState("");
  const [notice, setNotice] = useState("");
  const [loadError, setLoadError] = useState("");
  const [loading, setLoading] = useState(dataMode === "live");
  const [submitting, setSubmitting] = useState(false);
  const [updatingCategories, setUpdatingCategories] = useState(false);
  const [updatingPreference, setUpdatingPreference] = useState(false);
  const [interestAction, setInterestAction] = useState<string | null>(null);
  const [profile, setProfile] = useState<ReaderProfile | null>(null);
  const [library, setLibrary] = useState<LibraryResponse | null>(null);
  const [onboarding, setOnboarding] = useState(dataMode === "prototype");
  const [interest, setInterest] = useState("");
  const [articleLength, setArticleLength] =
    useState<OnboardingRequest["articleLength"]>("standard");
  const [conversationAnswer, setConversationAnswer] =
    useState<ConversationAnswer | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingComposerRequest = useRef<{
    scope: string;
    message: string;
    idempotencyKey: string;
  } | null>(null);
  const pendingGenerationKeys = useRef(new Map<string, string>());
  const categoryRequestSequence = useRef(0);

  const name = profile?.displayName ?? reader.name;
  const email = profile?.email ?? reader.email;
  const streak = profile?.currentStreak ?? (dataMode === "prototype" ? 12 : 0);

  const showNotice = useCallback((message: string) => {
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    setNotice(message);
    noticeTimer.current = setTimeout(() => setNotice(""), 5200);
  }, []);

  const handleError = useCallback(
    (error: unknown) => {
      if (error instanceof EdisonApiError && error.status === 401) {
        router.replace("/login");
      }
      return messageFor(error);
    },
    [router],
  );

  useEffect(
    () => () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
    },
    [],
  );

  useEffect(() => {
    if (dataMode === "prototype") {
      return;
    }

    let active = true;
    const initialCategorySequence = categoryRequestSequence.current;
    Promise.all([
      edisonApi<ReaderProfile>("/me"),
      edisonApi<FeedResponse>("/feed?category=for-you&limit=20"),
    ])
      .then(([nextProfile, feed]) => {
        if (!active) return;
        setProfile(nextProfile);
        setOnboarding(!nextProfile.onboardingComplete);
        if (initialCategorySequence === categoryRequestSequence.current) {
          setStories(feed.items);
          setNextCursor(feed.nextCursor);
          setLoadError("");
        }
      })
      .catch((error) => {
        if (
          active &&
          initialCategorySequence === categoryRequestSequence.current
        ) {
          setLoadError(handleError(error));
        }
      })
      .finally(() => {
        if (
          active &&
          initialCategorySequence === categoryRequestSequence.current
        ) {
          setLoading(false);
        }
      });

    return () => {
      active = false;
    };
  }, [dataMode, handleError]);

  useEffect(() => {
    if (dataMode !== "live" || !pendingJobId) return;

    let active = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let consecutiveFailures = 0;

    async function poll() {
      try {
        const job = await edisonApi<GenerationJob>(
          `/generation-jobs/${pendingJobId}`,
        );
        if (!active) return;

        if (job.status === "succeeded") {
          const feed = await edisonApi<FeedResponse>(
            `/feed?category=${encodeURIComponent(category)}&limit=20`,
          );
          if (!active) return;
          setStories(feed.items);
          setNextCursor(feed.nextCursor);
          setLoadError("");
          setPendingJobId(null);
          showNotice("Your new story is ready.");
          return;
        }

        if (job.status === "failed" || job.status === "cancelled") {
          setPendingJobId(null);
          showNotice("Edison could not finish that story. Please try again.");
          return;
        }

        consecutiveFailures = 0;
      } catch (error) {
        if (!active) return;
        consecutiveFailures += 1;
        if (consecutiveFailures >= 3) {
          setPendingJobId(null);
          showNotice(handleError(error));
          return;
        }
      }

      if (active) timer = setTimeout(poll, 3_000);
    }

    timer = setTimeout(poll, 2_000);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [category, dataMode, handleError, pendingJobId, showNotice]);

  const orderedCategorySettings = useMemo(() => {
    if (!profile) return [];
    return [...profile.preferences.categories].sort(
      (left, right) => left.position - right.position,
    );
  }, [profile]);

  const visibleCategories = useMemo<ContentCategory[]>(() => {
    if (!profile) return categoryOrder;
    return [
      "for-you",
      ...orderedCategorySettings
        .filter((entry) => entry.visible)
        .map((entry) => entry.category),
    ];
  }, [orderedCategorySettings, profile]);

  async function selectCategory(nextCategory: string) {
    const selected = nextCategory as ContentCategory;
    const requestSequence = ++categoryRequestSequence.current;
    setCategory(selected);
    if (dataMode === "prototype") return;
    setLoading(true);
    setLoadError("");
    try {
      const feed = await edisonApi<FeedResponse>(
        `/feed?category=${encodeURIComponent(selected)}&limit=20`,
      );
      if (requestSequence !== categoryRequestSequence.current) return;
      setStories(feed.items);
      setNextCursor(feed.nextCursor);
    } catch (error) {
      if (requestSequence !== categoryRequestSequence.current) return;
      setLoadError(handleError(error));
    } finally {
      if (requestSequence === categoryRequestSequence.current) {
        setLoading(false);
      }
    }
  }

  function patchStory(articleId: string, patch: Partial<ArticleCard>) {
    setStories((current) =>
      current.map((story) =>
        story.id === articleId ? { ...story, ...patch } : story,
      ),
    );
    setArticle((current) =>
      current?.id === articleId ? { ...current, ...patch } : current,
    );
  }

  async function openStory(story: ArticleCard) {
    setConversationAnswer(null);
    if (dataMode === "prototype") {
      setArticle(makeDemoArticle(story, name));
      setSummary(null);
      setView("article");
      window.scrollTo(0, 0);
      return;
    }

    setSubmitting(true);
    try {
      const nextArticle = await edisonApi<Article>(`/articles/${story.id}`);
      setArticle(nextArticle);
      setSummary(null);
      setView("article");
      window.scrollTo(0, 0);
      void edisonApi(`/articles/${story.id}/events`, {
        method: "POST",
        body: JSON.stringify({
          eventType: "opened",
          idempotencyKey: `open-${crypto.randomUUID()}`,
        }),
      }).catch(() => undefined);
    } catch (error) {
      showNotice(handleError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function toggleSave(story: ArticleCard) {
    const nextSaved = !story.saved;
    patchStory(story.id, { saved: nextSaved });
    if (dataMode === "prototype") {
      showNotice(nextSaved
        ? "Saved for this demo session. Reloading resets your library."
        : "Removed from your demo library.");
      return;
    }
    try {
      await edisonApi(`/articles/${story.id}/save`, {
        method: nextSaved ? "PUT" : "DELETE",
      });
    } catch (error) {
      patchStory(story.id, { saved: !nextSaved });
      showNotice(handleError(error));
    }
  }

  async function openLibrary() {
    setView("library");
    if (dataMode === "prototype") return;
    setLoading(true);
    try {
      setLibrary(await edisonApi<LibraryResponse>("/library"));
      setLoadError("");
    } catch (error) {
      setLoadError(handleError(error));
    } finally {
      setLoading(false);
    }
  }

  async function submitComposer() {
    if (dataMode !== "live") return;
    const message = composer.trim();
    if (!message || submitting) return;
    const scope = view === "article" && article ? `article:${article.id}` : "feed";
    const priorRequest = pendingComposerRequest.current;
    const idempotencyKey =
      priorRequest?.scope === scope && priorRequest.message === message
        ? priorRequest.idempotencyKey
        : `${view === "article" ? "question" : "command"}-${crypto.randomUUID()}`;
    pendingComposerRequest.current = { scope, message, idempotencyKey };
    setSubmitting(true);
    setComposer("");
    try {
      if (view === "article" && article) {
        const response = await edisonApi<ConversationAnswer>(
          `/articles/${article.id}/conversation`,
          {
            method: "POST",
            body: JSON.stringify({
              message,
              idempotencyKey,
            }),
          },
        );
        setConversationAnswer(response);
        showNotice("Edison answered your follow-up below the article.");
      } else {
        const response = await edisonApi<{ message: string }>(
          "/feed/commands",
          {
            method: "POST",
          body: JSON.stringify({
            command: message,
            idempotencyKey,
          } satisfies FeedCommandRequest),
          },
        );
        showNotice(response.message);
      }
      pendingComposerRequest.current = null;
    } catch (error) {
      showNotice(handleError(error));
      setComposer(message);
    } finally {
      setSubmitting(false);
    }
  }

  async function finishOnboarding() {
    if (dataMode === "prototype") {
      setOnboarding(false);
      return;
    }
    if (!interest.trim() || submitting) return;

    setSubmitting(true);
    try {
      const nextProfile = await edisonApi<ReaderProfile>("/onboarding", {
        method: "POST",
        body: JSON.stringify({
          displayName: name,
          goals: interest.trim(),
          articleLength,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
        } satisfies OnboardingRequest),
      });
      setProfile(nextProfile);
      setOnboarding(false);
      showNotice("Your profile is ready. Edison is composing your first story.");
      await createGenerationJob("initial-edition");
    } catch (error) {
      showNotice(handleError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function createGenerationJob(
    kind: "initial-edition" | "feed-replenishment",
    requestedCategory?: ArticleCategory,
  ) {
    if (dataMode !== "live") return;
    const requestScope = `${kind}:${requestedCategory ?? "any"}`;
    const idempotencyKey =
      pendingGenerationKeys.current.get(requestScope) ??
      `${kind}-${crypto.randomUUID()}`;
    pendingGenerationKeys.current.set(requestScope, idempotencyKey);
    const job = await edisonApi<GenerationJob>("/generation-jobs", {
      method: "POST",
      body: JSON.stringify({
        kind,
        ...(requestedCategory ? { category: requestedCategory } : {}),
        idempotencyKey,
      }),
    });
    pendingGenerationKeys.current.delete(requestScope);
    if (job.status === "queued" || job.status === "running") {
      setPendingJobId(job.id);
    }
    return job;
  }

  async function requestStory() {
    if (dataMode !== "live" || submitting || pendingJobId) return;
    setSubmitting(true);
    try {
      await createGenerationJob(
        "feed-replenishment",
        category === "for-you" ? undefined : category,
      );
      showNotice("Edison is researching a new story. It will appear here when ready.");
    } catch (error) {
      showNotice(handleError(error));
    } finally {
      setSubmitting(false);
    }
  }

  async function setCategoryVisibility(
    changedCategory: ContentCategory,
    visible: boolean,
  ) {
    if (dataMode !== "live" || !profile || changedCategory === "for-you" || updatingCategories) return;
    if (
      !visible &&
      profile.preferences.categories.filter((entry) => entry.visible).length <= 1
    ) {
      showNotice("Keep at least one section visible in your edition.");
      return;
    }
    const categories = profile.preferences.categories.map((entry) =>
      entry.category === changedCategory ? { ...entry, visible } : entry,
    );
    const previous = profile;
    setUpdatingCategories(true);
    setProfile({
      ...profile,
      preferences: { ...profile.preferences, categories },
    });
    try {
      const nextProfile = await edisonApi<ReaderProfile>("/me", {
        method: "PATCH",
        body: JSON.stringify({ categories }),
      });
      setProfile(nextProfile);
      if (!visible && category === changedCategory) {
        await selectCategory("for-you");
      }
    } catch (error) {
      setProfile(previous);
      showNotice(handleError(error));
    } finally {
      setUpdatingCategories(false);
    }
  }

  async function moveCategory(
    changedCategory: ArticleCategory,
    direction: -1 | 1,
  ) {
    if (dataMode !== "live" || !profile || updatingCategories) return;
    const ordered = [...profile.preferences.categories].sort(
      (left, right) => left.position - right.position,
    );
    const currentIndex = ordered.findIndex(
      (entry) => entry.category === changedCategory,
    );
    const nextIndex = currentIndex + direction;
    if (currentIndex < 0 || nextIndex < 0 || nextIndex >= ordered.length) return;

    [ordered[currentIndex], ordered[nextIndex]] = [
      ordered[nextIndex],
      ordered[currentIndex],
    ];
    const categories = ordered.map((entry, position) => ({
      ...entry,
      position,
    }));
    const previous = profile;
    setUpdatingCategories(true);
    setProfile({
      ...profile,
      preferences: { ...profile.preferences, categories },
    });
    try {
      setProfile(
        await edisonApi<ReaderProfile>("/me", {
          method: "PATCH",
          body: JSON.stringify({ categories }),
        }),
      );
      showNotice(
        `${categoryLabels[changedCategory]} moved ${direction < 0 ? "up" : "down"}.`,
      );
    } catch (error) {
      setProfile(previous);
      showNotice(handleError(error));
    } finally {
      setUpdatingCategories(false);
    }
  }

  async function updatePreference(
    patch: Partial<
      Pick<
        ReaderProfile["preferences"],
        "articleLength" | "depth" | "novelty"
      >
    >,
  ) {
    if (dataMode !== "live" || !profile || updatingPreference) return;
    const previous = profile;
    setUpdatingPreference(true);
    setProfile({
      ...profile,
      preferences: { ...profile.preferences, ...patch },
    });
    try {
      setProfile(
        await edisonApi<ReaderProfile>("/me", {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),
      );
    } catch (error) {
      setProfile(previous);
      showNotice(handleError(error));
    } finally {
      setUpdatingPreference(false);
    }
  }

  function storeExplicitInterest(nextInterest: ExplicitInterest) {
    setProfile((current) => {
      if (!current) return current;
      const explicitInterests = [
        ...current.preferences.explicitInterests.filter(
          (item) => item.id !== nextInterest.id,
        ),
        nextInterest,
      ].sort((left, right) => left.topic.localeCompare(right.topic));
      return {
        ...current,
        preferences: { ...current.preferences, explicitInterests },
      };
    });
  }

  async function addExplicitInterest(topic: string) {
    if (!profile || interestAction || dataMode !== "live") return false;
    setInterestAction("add");
    try {
      const nextInterest = await edisonApi<ExplicitInterest>("/me/interests", {
        method: "POST",
        body: JSON.stringify({ topic }),
      });
      storeExplicitInterest(nextInterest);
      showNotice(`${nextInterest.topic} will shape future stories.`);
      return true;
    } catch (error) {
      showNotice(handleError(error));
      return false;
    } finally {
      setInterestAction(null);
    }
  }

  async function updateExplicitInterestStatus(
    interestId: string,
    status: ExplicitInterestStatus,
  ) {
    if (!profile || interestAction || dataMode !== "live") return;
    setInterestAction(`${interestId}:status`);
    try {
      const nextInterest = await edisonApi<ExplicitInterest>(
        `/me/interests/${encodeURIComponent(interestId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ status }),
        },
      );
      storeExplicitInterest(nextInterest);
      showNotice(
        status === "muted"
          ? `${nextInterest.topic} is now an avoid signal.`
          : `${nextInterest.topic} is back in your interests.`,
      );
    } catch (error) {
      showNotice(handleError(error));
    } finally {
      setInterestAction(null);
    }
  }

  async function deleteExplicitInterest(interestId: string) {
    if (!profile || interestAction || dataMode !== "live") return;
    const existing = profile.preferences.explicitInterests.find(
      (item) => item.id === interestId,
    );
    setInterestAction(`${interestId}:delete`);
    try {
      await edisonApi<void>(`/me/interests/${encodeURIComponent(interestId)}`, {
        method: "DELETE",
      });
      setProfile((current) =>
        current
          ? {
              ...current,
              preferences: {
                ...current.preferences,
                explicitInterests:
                  current.preferences.explicitInterests.filter(
                    (item) => item.id !== interestId,
                  ),
              },
            }
          : current,
      );
      showNotice(
        existing
          ? `${existing.topic} was removed from your direct interests.`
          : "That interest was removed.",
      );
    } catch (error) {
      showNotice(handleError(error));
    } finally {
      setInterestAction(null);
    }
  }

  const loadMore = useCallback(async () => {
    if (
      dataMode !== "live" ||
      view !== "feed" ||
      !nextCursor ||
      loadingMore
    ) {
      return;
    }

    setLoadingMore(true);
    const categorySequence = categoryRequestSequence.current;
    try {
      const feed = await edisonApi<FeedResponse>(
        `/feed?category=${encodeURIComponent(category)}&limit=20&cursor=${encodeURIComponent(nextCursor)}`,
      );
      if (categorySequence !== categoryRequestSequence.current) return;
      setStories((current) => [
        ...current,
        ...feed.items.filter(
          (item) => !current.some((existing) => existing.id === item.id),
        ),
      ]);
      setNextCursor(feed.nextCursor);
    } catch (error) {
      if (categorySequence !== categoryRequestSequence.current) return;
      showNotice(handleError(error));
    } finally {
      setLoadingMore(false);
    }
  }, [category, dataMode, handleError, loadingMore, nextCursor, showNotice, view]);

  const displayedStories =
    dataMode === "prototype" && category !== "for-you"
      ? stories.filter((story) => story.category === category)
      : stories;

  return (
    <div className="app-shell">
      {dataMode === "prototype" && (
        <div className="prototype-notice" role="status">
          <span>Demo</span>
          <span>Sample content · changes reset on reload</span>
        </div>
      )}

      <header className="site-header">
        <button
          className="brand"
          onClick={() => setView("feed")}
          aria-label="Edison"
        >
          <EdisonLogo />
        </button>
        <nav aria-label="Reader tools">
          <button onClick={() => void openLibrary()} aria-label="Library">
            <Bookmark />
          </button>
          <button
            className="streak"
            onClick={() => setView("profile")}
            aria-label={`${dataMode === "prototype" ? "Sample reading" : "Reading"} streak: ${streak} days`}
          >
            <Flame fill="currentColor" />{streak}
          </button>
          <button
            className="avatar"
            onClick={() => setView("profile")}
            aria-label="Open profile and settings"
          >
            {name[0]?.toUpperCase() ?? "E"}
          </button>
        </nav>
      </header>

      {view === "feed" && (
        <>
          <div className="category-row">
            <Tabs value={category} onValueChange={selectCategory}>
              <TabsList>
                {visibleCategories.map((entry) => (
                  <TabsTrigger key={entry} value={entry}>
                    {categoryLabels[entry]}
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <button onClick={() => setManage(true)} aria-label="Manage categories">
              <Settings2 />
            </button>
          </div>
          <main className="feed">
            {loading ? (
              <DataStatus icon={<LoaderCircle className="spin" />}>
                Opening today&apos;s edition…
              </DataStatus>
            ) : loadError ? (
              <DataStatus icon={<AlertCircle />} tone="error">
                {loadError}
              </DataStatus>
            ) : displayedStories.length ? (
              <>
                <div className="edition-folio" aria-label="Edition details">
                  <span>{dataMode === "prototype" ? "Sample edition" : "Today’s edition"}</span>
                  <span>{dataMode === "prototype" ? "Personalization preview" : `Edited for ${name}`}</span>
                  <span>{displayedStories.length} stories</span>
                </div>
                <StoryCard
                  story={displayedStories[0]}
                  dataMode={dataMode}
                  lead
                  open={openStory}
                  summary={setSummary}
                  save={toggleSave}
                  timerRef={longPressTimer}
                  tone={storyTones[0]}
                />
                {displayedStories.slice(1).map((story, index) => (
                  <StoryCard
                    key={story.id}
                    story={story}
                    dataMode={dataMode}
                    open={openStory}
                    summary={setSummary}
                    save={toggleSave}
                    timerRef={longPressTimer}
                    tone={storyTones[(index + 1) % storyTones.length]}
                  />
                ))}
                {nextCursor ? (
                  <FeedSentinel loading={loadingMore} onVisible={loadMore} />
                ) : (
                  <div className="edition-end">
                    <b><EdisonMark className="edition-mark" /></b>
                    <p>You&apos;re caught up.</p>
                    <span>{dataMode === "prototype"
                      ? "You’ve reached the end of the sample edition. AI generation is off in this demo."
                      : "Your next edition will keep learning from what you read."}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="empty">
                <BookOpen />
                <h1>{dataMode === "prototype" ? "No sample stories in this section" : "Your edition is being composed"}</h1>
                <p>{dataMode === "prototype"
                  ? "Try For you to explore the sample edition."
                  : "Edison writes in the background, so reading never waits on generation."}</p>
                {dataMode === "live" && (
                  <button
                    className="primary empty-action"
                    onClick={() => void requestStory()}
                    disabled={submitting || Boolean(pendingJobId)}
                  >
                    {submitting || pendingJobId ? (
                      <LoaderCircle className="spin" />
                    ) : (
                      <ArrowRight />
                    )}
                    {pendingJobId ? "Researching your story…" : "Compose a story"}
                  </button>
                )}
              </div>
            )}
          </main>
        </>
      )}

      {view === "article" && article && (
        <ArticleView
          article={article}
          conversationAnswer={conversationAnswer}
          dataMode={dataMode}
          back={() => setView("feed")}
          save={() => void toggleSave(article)}
          onError={(error) => showNotice(handleError(error))}
          onCompleted={(currentStreak) => {
            patchStory(article.id, { completed: true });
            if (profile) setProfile({ ...profile, currentStreak });
          }}
          onShared={(shareId) =>
            setArticle((current) => current ? { ...current, shareId } : current)
          }
        />
      )}

      {view === "library" && (
        <LibraryView
          dataMode={dataMode}
          library={library}
          fallbackSaved={stories.filter((story) => story.saved)}
          loading={loading}
          error={loadError}
          back={() => setView("feed")}
          open={openStory}
        />
      )}

      {view === "profile" && (
        <ProfileView
          dataMode={dataMode}
          reader={{ name, email }}
          profile={profile}
          streak={streak}
          back={() => setView("feed")}
          preferenceSaving={updatingPreference}
          interestAction={interestAction}
          updatePreference={updatePreference}
          addInterest={addExplicitInterest}
          updateInterestStatus={updateExplicitInterestStatus}
          deleteInterest={deleteExplicitInterest}
        />
      )}

      <div className="composer-wrap">
        {view === "article" && (
          <div className="prompt-chips">
            {["Go deeper", "Counterpoint", "Historical context"].map((prompt) => (
              <button key={prompt} onClick={() => setComposer(prompt)} disabled={dataMode !== "live"}>{prompt}</button>
            ))}
          </div>
        )}
        <div className="composer">
          <EdisonMark className="composer-mark" />
          <input
            aria-label={
              dataMode === "prototype"
                ? "AI requests are unavailable in this demo"
                : view === "article"
                ? "Ask about this article"
                : "Shape your next edition"
            }
            value={composer}
            onChange={(event) => setComposer(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submitComposer();
            }}
            placeholder={dataMode === "prototype"
              ? "AI requests are off in this demo"
              : view === "article" ? "Ask about this article…" : "Shape your next edition…"}
            disabled={dataMode !== "live" || submitting}
          />
          <button
            onClick={() => void submitComposer()}
            disabled={dataMode !== "live" || submitting}
            aria-label={
              view === "article"
                ? "Send article question"
                : "Send edition request"
            }
          >
            {submitting ? <LoaderCircle className="spin" /> : <Send />}
          </button>
        </div>
      </div>

      {notice && (
        <div className="toast" role="status"><Check />{notice}</div>
      )}

      <Sheet open={Boolean(summary)} onOpenChange={(open) => !open && setSummary(null)}>
        <SheetContent side="bottom" className="summary-sheet">
          <SheetHeader>
            <SheetDescription>{summary?.kicker}</SheetDescription>
            <SheetTitle>{summary?.title}</SheetTitle>
          </SheetHeader>
          <ul>{summary?.summary.map((item) => <li key={item}>{item}</li>)}</ul>
          <button className="primary" onClick={() => summary && void openStory(summary)}>
            Read the full story <BookOpen />
          </button>
        </SheetContent>
      </Sheet>

      <Sheet open={manage} onOpenChange={setManage}>
        <SheetContent className="manage-sheet">
          <SheetHeader>
            <SheetTitle>Manage your sections</SheetTitle>
            <SheetDescription>
              {dataMode === "prototype"
                ? "Section controls are a preview and are disabled in this demo. All sample sections remain visible."
                : "Choose what appears in your edition and set the order."}
            </SheetDescription>
          </SheetHeader>
          {(profile
            ? orderedCategorySettings
            : categoryOrder.slice(1).map((entry, position) => ({
                category: entry as ArticleCategory,
                position,
                visible: true,
              }))).map((setting, index, settings) => {
            const entry = setting.category;
            return (
              <div className="category-setting" key={entry}>
                <GripVertical aria-hidden="true" />
                <span>{categoryLabels[entry]}</span>
                <div className="category-actions">
                  <div className="category-order-controls">
                    <button
                      type="button"
                      aria-label={`Move ${categoryLabels[entry]} up`}
                      disabled={
                        dataMode !== "live" || updatingCategories || index === 0
                      }
                      onClick={() => void moveCategory(entry, -1)}
                    >
                      <ChevronUp />
                    </button>
                    <button
                      type="button"
                      aria-label={`Move ${categoryLabels[entry]} down`}
                      disabled={
                        dataMode !== "live" ||
                        updatingCategories ||
                        index === settings.length - 1
                      }
                      onClick={() => void moveCategory(entry, 1)}
                    >
                      <ChevronDown />
                    </button>
                  </div>
                  <Switch
                    aria-label={`Show ${categoryLabels[entry]}`}
                    checked={setting.visible}
                    disabled={dataMode !== "live" || updatingCategories}
                    onCheckedChange={(checked) => {
                      if (dataMode === "live") {
                        void setCategoryVisibility(entry, checked);
                      }
                    }}
                  />
                </div>
              </div>
            );
          })}
        </SheetContent>
      </Sheet>

      <Dialog open={onboarding}>
        <DialogContent className="onboarding" showCloseButton={false}>
          <DialogHeader>
            <EdisonMark className="onboarding-mark" />
            <DialogTitle>What do you want to understand?</DialogTitle>
            <DialogDescription>
              {dataMode === "prototype"
                ? "Explore a sample edition and preview how onboarding will work. These example preferences stay on this page, are not saved, and do not generate or change stories."
                : "Edison will compose a daily publication around the questions that keep pulling you back."}
            </DialogDescription>
          </DialogHeader>
          <label className="onboarding-interest-label" htmlFor="onboarding-interest">
            {dataMode === "prototype" ? "Try an example question or subject (optional)" : "Start with a question or subject"}
          </label>
          <textarea
            id="onboarding-interest"
            value={interest}
            onChange={(event) => setInterest(event.target.value)}
            placeholder="The future of cities, how memory works, the history behind today’s news…"
          />
          <fieldset>
            <legend>How long should most stories be?</legend>
            {[
              ["brief", "Brief · 4–6 min"],
              ["standard", "Standard · 7–10 min"],
              ["deep", "Deep · 12–18 min"],
            ].map(([value, label]) => (
              <label key={value}>
                <input
                  type="radio"
                  name="length"
                  checked={articleLength === value}
                  onChange={() => setArticleLength(value as OnboardingRequest["articleLength"])}
                />
                {label}
              </label>
            ))}
          </fieldset>
          <button
            className="primary"
            disabled={(dataMode === "live" && !interest.trim()) || submitting}
            onClick={() => void finishOnboarding()}
          >
            {submitting ? <LoaderCircle className="spin" /> : <ArrowRight />}
            {dataMode === "prototype" ? "Explore sample edition" : "Compose my edition"}
          </button>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function FeedSentinel({
  loading,
  onVisible,
}: {
  loading: boolean;
  onVisible: () => Promise<void>;
}) {
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void onVisible();
      },
      { rootMargin: "500px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [onVisible]);

  return (
    <div className="feed-sentinel" ref={sentinelRef} aria-live="polite">
      {loading && <LoaderCircle className="spin" />}
    </div>
  );
}
