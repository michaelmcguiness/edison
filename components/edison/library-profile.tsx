"use client";

import { useState } from "react";
import type {
  ExplicitInterestStatus,
  ArticleCard,
  LibraryResponse,
  Profile as ReaderProfile,
} from "@edison/contracts";
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  Flame,
  Library,
  LoaderCircle,
  MessageCircle,
  Plus,
  Trash2,
} from "lucide-react";
import { Slider } from "@/components/ui/slider";

type PreferencePatch = Partial<
  Pick<
    ReaderProfile["preferences"],
    "articleLength" | "depth" | "novelty"
  >
>;

const articleLengthOptions = [
  { value: "brief", label: "Brief", detail: "4–6 min" },
  { value: "standard", label: "Standard", detail: "7–10 min" },
  { value: "deep", label: "Deep", detail: "12–18 min" },
] as const;

export function DataStatus({
  icon,
  tone = "default",
  children,
}: {
  icon: React.ReactNode;
  tone?: "default" | "error";
  children: React.ReactNode;
}) {
  return (
    <div
      className={`data-status ${tone}`}
      role={tone === "error" ? "alert" : "status"}
    >
      {icon}
      <p>{children}</p>
    </div>
  );
}

export function LibraryView({
  dataMode,
  library,
  fallbackSaved,
  loading,
  error,
  back,
  open,
  openArticle,
}: {
  dataMode: "prototype" | "guest" | "live";
  library: LibraryResponse | null;
  fallbackSaved: ArticleCard[];
  loading: boolean;
  error: string;
  back: () => void;
  open: (story: ArticleCard) => Promise<void>;
  openArticle: (articleId: string) => void;
}) {
  const saved = dataMode === "prototype" ? fallbackSaved : library?.saved ?? [];
  const completed = library?.completed ?? [];
  const threads = library?.learningThreads ?? [];
  const conversations = library?.conversations ?? [];

  return (
    <main className="subpage">
      <button className="back" onClick={back}>
        <ChevronLeft />Back to edition
      </button>
      <header>
        <span className="eyebrow">Your reading life</span>
        <h1>Library</h1>
        <p>{dataMode === "prototype"
          ? "Demo saves work while this page is open and reset on reload."
            : dataMode === "guest"
              ? "Sign in when you want to keep stories and reading progress. Public reading remains open."
            : "Saved and completed stories, plus the article conversations you’re following."}</p>
      </header>

      {loading ? (
        <DataStatus icon={<LoaderCircle className="spin" />}>
          Opening your library…
        </DataStatus>
      ) : error ? (
        <DataStatus icon={<AlertCircle />} tone="error">{error}</DataStatus>
      ) : (
        <>
          <section>
            <h2>Learning threads</h2>
            <div className="thread-grid">
              {threads.map((thread) => (
                <div key={thread.id}>
                  <span>{thread.title}</span>
                  <b>{thread.currentLevel}</b>
                  <small>{thread.summary}</small>
                </div>
              ))}
              {!threads.length && (
                <p className="quiet-empty">
                  {dataMode === "live"
                    ? "Learning threads will emerge as you read and ask questions."
                    : "No account learning threads are connected here."}
                </p>
              )}
            </div>
          </section>

          <section>
            <h2>Saved stories</h2>
            {saved.map((story) => (
              <button
                className="library-story"
                key={story.id}
                onClick={() => void open(story)}
              >
                <Library />
                <span>
                  <b>{story.title}</b>
                  <small>{story.kicker} · {story.readingMinutes} min</small>
                </span>
              </button>
            ))}
            {!saved.length && (
              <p className="quiet-empty">Stories you save will live here.</p>
            )}
          </section>

          {dataMode === "live" && (
            <section>
              <h2>Article conversations</h2>
              {conversations.map((conversation) => (
                <button
                  className="library-story"
                  key={conversation.id}
                  onClick={() => openArticle(conversation.articleId)}
                >
                  <MessageCircle />
                  <span>
                    <b>{conversation.title || conversation.articleTitle}</b>
                    <small>Continue with {conversation.articleTitle}</small>
                  </span>
                </button>
              ))}
              {!conversations.length && (
                <p className="quiet-empty">Questions you ask about an article will appear here.</p>
              )}
            </section>
          )}

          {dataMode === "live" && (
            <section>
              <h2>Completed stories</h2>
              {completed.map((story) => (
                <button
                  className="library-story"
                  key={story.id}
                  onClick={() => void open(story)}
                >
                  <CheckCircle2 />
                  <span>
                    <b>{story.title}</b>
                    <small>{story.kicker} · {story.readingMinutes} min</small>
                  </span>
                </button>
              ))}
              {!completed.length && (
                <p className="quiet-empty">Stories you mark as read will appear here.</p>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}

export function ProfileView({
  dataMode,
  reader,
  profile,
  loading,
  error,
  streak,
  back,
  preferenceSaving,
  interestAction,
  updatePreference,
  addInterest,
  updateInterestStatus,
  deleteInterest,
  manageCategories,
  reviewDirection,
}: {
  dataMode: "prototype" | "guest" | "live";
  reader: { name: string; email: string };
  profile: ReaderProfile | null;
  loading: boolean;
  error: string;
  streak: number;
  back: () => void;
  preferenceSaving: boolean;
  interestAction: string | null;
  updatePreference: (patch: PreferencePatch) => Promise<void>;
  addInterest: (topic: string) => Promise<boolean>;
  updateInterestStatus: (
    interestId: string,
    status: ExplicitInterestStatus,
  ) => Promise<void>;
  deleteInterest: (interestId: string) => Promise<void>;
  manageCategories: () => void;
  reviewDirection: () => void;
}) {
  const [newInterest, setNewInterest] = useState("");
  const inferred = profile?.preferences.inferredPreferences ?? [];
  const explicitInterests = profile?.preferences.explicitInterests ?? [];
  const liveControlsDisabled =
    dataMode !== "live" || !profile || preferenceSaving;

  return (
    <main className="subpage">
      <button className="back" onClick={back}>
        <ChevronLeft />Back to edition
      </button>
      <header>
        <span className="eyebrow">Your Edison</span>
        <h1>{reader.name || "Your publication"}</h1>
        <p>{dataMode === "prototype"
          ? "Sample reading · no account or AI service is connected"
          : dataMode === "guest"
            ? "Reading is open. Sign in only when you want account-synced history and preferences."
            : reader.email}</p>
      </header>

      {loading ? (
        <DataStatus icon={<LoaderCircle className="spin" />}>
          Opening your profile…
        </DataStatus>
      ) : error ? (
        <DataStatus icon={<AlertCircle />} tone="error">{error}</DataStatus>
      ) : null}

      {dataMode === "live" && <div className="streak-card">
        <Flame fill="currentColor" />
        <div>
          <b>{streak}-day streak</b>
          <span>Built one worthwhile story at a time</span>
        </div>
      </div>}

      <section>
        <h2>Editorial direction</h2>
        <p className="section-intro">Review the instructions you gave Edison separately from interests learned through reading.</p>
        <button className="signout" type="button" onClick={reviewDirection}>Review editorial direction</button>
        {dataMode === "live" && <button className="signout" type="button" onClick={manageCategories}>Manage News categories</button>}
      </section>

      <section className="settings">
        <h2>Reading preferences</h2>
        {dataMode !== "live" && (
          <p className="section-intro">Account reading preferences are available after sign-in. Device-local editorial notes remain separate.</p>
        )}
        <label>
          <span>
            <b>Depth</b>
            <small>From quick orientation to technical detail</small>
          </span>
          <Slider
            key={`depth-${profile?.preferences.depth ?? 62}`}
            aria-label="Preferred article depth"
            defaultValue={[profile?.preferences.depth ?? 62]}
            onValueCommit={([depth]) => void updatePreference({ depth })}
            disabled={liveControlsDisabled}
          />
        </label>
        <label>
          <span>
            <b>Novelty</b>
            <small>How far Edison should wander</small>
          </span>
          <Slider
            key={`novelty-${profile?.preferences.novelty ?? 72}`}
            aria-label="Preferred feed novelty"
            defaultValue={[profile?.preferences.novelty ?? 72]}
            onValueCommit={([novelty]) => void updatePreference({ novelty })}
            disabled={liveControlsDisabled}
          />
        </label>
        <fieldset
          className="article-length-setting"
          disabled={liveControlsDisabled}
        >
          <legend>
            <b>Article length</b>
            <small>How long most stories should be</small>
          </legend>
          <div className="article-length-options">
            {articleLengthOptions.map((option) => (
              <label className="article-length-option" key={option.value}>
                <input
                  type="radio"
                  name="profile-article-length"
                  value={option.value}
                  checked={
                    (profile?.preferences.articleLength ?? "standard") ===
                    option.value
                  }
                  onChange={() =>
                    void updatePreference({ articleLength: option.value })
                  }
                />
                <span>
                  <b>{option.label}</b>
                  <small>{option.detail}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </section>

      <section className="interest-settings">
        <h2>Your interests</h2>
        <p className="section-intro" id="interest-control-help">
          Add topics you want more of. Muting makes a topic an explicit avoid
          signal; removing it forgets only your direct choice, not Edison&apos;s
          separate learned notes.
        </p>
        <form
          className="interest-form"
          aria-describedby="interest-control-help"
          onSubmit={(event) => {
            event.preventDefault();
            void addInterest(newInterest).then((added) => {
              if (added) setNewInterest("");
            });
          }}
        >
          <label htmlFor="new-interest">Add an interest</label>
          <div>
            <input
              id="new-interest"
              value={newInterest}
              onChange={(event) => setNewInterest(event.target.value)}
              maxLength={200}
              placeholder="e.g. synthetic biology"
              disabled={dataMode !== "live" || !profile || Boolean(interestAction)}
            />
            <button
              type="submit"
              disabled={
                dataMode !== "live" ||
                !profile ||
                !newInterest.trim() ||
                Boolean(interestAction)
              }
            >
              {interestAction === "add" ? (
                <LoaderCircle className="spin" aria-hidden="true" />
              ) : (
                <Plus aria-hidden="true" />
              )}
              Add
            </button>
          </div>
        </form>

        {explicitInterests.length ? (
          <ul className="interest-list" aria-live="polite">
            {explicitInterests.map((item) => {
              const pending = interestAction?.startsWith(item.id) ?? false;
              const nextStatus = item.status === "active" ? "muted" : "active";
              return (
                <li key={item.id}>
                  <span className="interest-topic">
                    <b>{item.topic}</b>
                    <small>{item.status === "active" ? "Included" : "Muted"}</small>
                  </span>
                  <button
                    className="interest-status-action"
                    type="button"
                    disabled={Boolean(interestAction)}
                    aria-label={`${nextStatus === "muted" ? "Mute" : "Restore"} ${item.topic}`}
                    onClick={() =>
                      void updateInterestStatus(item.id, nextStatus)
                    }
                  >
                    {pending && interestAction?.endsWith(":status") ? (
                      <LoaderCircle className="spin" aria-hidden="true" />
                    ) : item.status === "active" ? (
                      "Mute"
                    ) : (
                      "Restore"
                    )}
                  </button>
                  <button
                    className="interest-delete-action"
                    type="button"
                    disabled={Boolean(interestAction)}
                    aria-label={`Remove ${item.topic}`}
                    onClick={() => void deleteInterest(item.id)}
                  >
                    {pending && interestAction?.endsWith(":delete") ? (
                      <LoaderCircle className="spin" aria-hidden="true" />
                    ) : (
                      <Trash2 aria-hidden="true" />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="quiet-empty" aria-live="polite">
            {dataMode === "live"
              ? "Add a topic to make it an explicit part of your edition."
              : "Account interest controls are unavailable without a connected account."}
          </p>
        )}
      </section>

      <section>
        <h2>What your feed has learned</h2>
        <div className="learned">
          {inferred.length ? (
            inferred.map((item) => <p key={item}>{item}</p>)
          ) : (
            <p>{dataMode === "live" ? "Edison will explain the preferences it learns here." : "No learned account interests are available."}</p>
          )}
        </div>
      </section>

      {dataMode === "live" && (
        <form action="/auth/signout" method="post">
          <button className="signout" type="submit">Sign out</button>
        </form>
      )}
      {dataMode === "guest" && <a className="signout" href="/login">Sign in</a>}
    </main>
  );
}
