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
  ChevronLeft,
  Flame,
  Library,
  LoaderCircle,
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
}: {
  dataMode: "prototype" | "live";
  library: LibraryResponse | null;
  fallbackSaved: ArticleCard[];
  loading: boolean;
  error: string;
  back: () => void;
  open: (story: ArticleCard) => Promise<void>;
}) {
  const saved = dataMode === "prototype" ? fallbackSaved : library?.saved ?? [];
  const threads = library?.learningThreads ?? [];

  return (
    <main className="subpage">
      <button className="back" onClick={back}>
        <ChevronLeft />Today
      </button>
      <header>
        <span className="eyebrow">Your reading life</span>
        <h1>Library</h1>
        <p>{dataMode === "prototype"
          ? "Demo saves work while this page is open and reset on reload. Learning threads below are examples."
          : "Saved stories and the questions you’re following over time."}</p>
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
            <h2>{dataMode === "prototype" ? "Sample learning threads" : "Learning threads"}</h2>
            <div className="thread-grid">
              {threads.map((thread) => (
                <div key={thread.id}>
                  <span>{thread.title}</span>
                  <b>{thread.currentLevel}</b>
                  <small>{thread.summary}</small>
                </div>
              ))}
              {dataMode === "prototype" && (
                <>
                  <div>
                    <span>Planetary systems</span>
                    <b>6 stories</b>
                    <small>Last explored today</small>
                  </div>
                  <div>
                    <span>How cities work</span>
                    <b>4 stories</b>
                    <small>Last explored yesterday</small>
                  </div>
                </>
              )}
              {dataMode === "live" && !threads.length && (
                <p className="quiet-empty">
                  Learning threads will emerge as you read and ask questions.
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
        </>
      )}
    </main>
  );
}

export function ProfileView({
  dataMode,
  reader,
  profile,
  streak,
  back,
  preferenceSaving,
  interestAction,
  updatePreference,
  addInterest,
  updateInterestStatus,
  deleteInterest,
}: {
  dataMode: "prototype" | "live";
  reader: { name: string; email: string };
  profile: ReaderProfile | null;
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
}) {
  const [newInterest, setNewInterest] = useState("");
  const inferred = profile?.preferences.inferredPreferences ?? [
    "You value explanations that connect current events to longer historical patterns.",
    "You tend to finish science stories with concrete examples.",
    "You prefer fewer startup funding stories.",
  ];
  const explicitInterests = profile?.preferences.explicitInterests ?? [];
  const liveControlsDisabled =
    dataMode !== "live" || !profile || preferenceSaving;

  return (
    <main className="subpage">
      <button className="back" onClick={back}>
        <ChevronLeft />Today
      </button>
      <header>
        <span className="eyebrow">Your Edison</span>
        <h1>{reader.name}</h1>
        <p>{dataMode === "prototype" ? "Sample profile · no account is connected" : reader.email}</p>
      </header>

      <div className="streak-card">
        <Flame fill="currentColor" />
        <div>
          <b>{streak} day streak</b>
          <span>{dataMode === "prototype" ? "Sample reading activity" : "Built one worthwhile story at a time"}</span>
        </div>
        <div className="week">
          {"SMTWTFS".split("").map((day, index) => (
            <span
              key={`${day}-${index}`}
              className={index < Math.min(streak, 7) ? "read" : ""}
            >
              {day}
            </span>
          ))}
        </div>
      </div>

      <section className="settings">
        <h2>Reading preferences</h2>
        {dataMode === "prototype" && (
          <p className="section-intro">These are example settings. Preference changes and personalization are disabled in this demo.</p>
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
              : "Interest controls are disabled in this demo."}
          </p>
        )}
      </section>

      <section>
        <h2>{dataMode === "prototype" ? "Example learned preferences" : "What your feed has learned"}</h2>
        <div className="learned">
          {inferred.length ? (
            inferred.map((item) => <p key={item}>{item}</p>)
          ) : (
            <p>Edison will explain the preferences it learns here.</p>
          )}
        </div>
      </section>

      {dataMode === "live" && (
        <form action="/auth/signout" method="post">
          <button className="signout" type="submit">Sign out</button>
        </form>
      )}
    </main>
  );
}
