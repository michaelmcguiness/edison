"use client";

import type { ReactNode } from "react";
import {
  Bookmark,
  BookOpen,
  Flame,
  Headphones,
  Newspaper,
  Plus,
} from "lucide-react";
import { EdisonLogo } from "@/components/edison/brand";
import type { PublicationSection } from "@/lib/publication-state";

const destinations: Array<{
  section: PublicationSection;
  label: string;
  icon: typeof Newspaper;
}> = [
  { section: "news", label: "News", icon: Newspaper },
  { section: "books", label: "Books", icon: BookOpen },
  { section: "podcasts", label: "Podcasts", icon: Headphones },
];

function PublicationNavigation({
  section,
  onSectionChange,
  mobile = false,
}: {
  section: PublicationSection;
  onSectionChange: (section: PublicationSection) => void;
  mobile?: boolean;
}) {
  return (
    <nav
      className={mobile ? "publication-bottom-nav" : "publication-side-nav"}
      aria-label="Publication sections"
    >
      {!mobile && <p className="publication-nav-label">Edition</p>}
      <div className="publication-nav-items">
        {destinations.map((destination) => {
          const Icon = destination.icon;
          return (
            <button
              key={destination.section}
              type="button"
              aria-current={section === destination.section ? "page" : undefined}
              onClick={() => onSectionChange(destination.section)}
            >
              <Icon aria-hidden="true" />
              <span>{destination.label}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}

export function PublicationShell({
  section,
  children,
  profileLabel,
  streak,
  demo = false,
  showLibrary = true,
  showCreate = true,
  onSectionChange,
  onOpenProfile,
  onOpenLibrary,
  onCreate,
}: {
  section: PublicationSection;
  children: ReactNode;
  profileLabel: string;
  streak: number;
  demo?: boolean;
  showLibrary?: boolean;
  showCreate?: boolean;
  onSectionChange: (section: PublicationSection) => void;
  onOpenProfile: () => void;
  onOpenLibrary: () => void;
  onCreate: () => void;
}) {
  const initial = profileLabel.trim().charAt(0).toUpperCase() || "E";

  return (
    <div className="publication-app">
      {demo && (
        <div className="prototype-notice" role="status">
          <span>Demo</span>
          <span>Sample content · AI and account services are not connected</span>
        </div>
      )}
      <div className="publication-layout">
        <aside className="publication-rail">
          <PublicationNavigation
            section={section}
            onSectionChange={onSectionChange}
          />
        </aside>
        <div className="publication-page">
          <header className="publication-masthead">
            <span className="publication-desk" aria-hidden="true">
              {section}
            </span>
            <button
              className="brand publication-brand"
              type="button"
              onClick={() => onSectionChange(section)}
              aria-label="Edison home"
            >
              <EdisonLogo />
            </button>
            <nav className="publication-tools" aria-label="Reader tools">
              {showLibrary && (
                <button type="button" onClick={onOpenLibrary} aria-label="Saved reading">
                  <Bookmark aria-hidden="true" />
                </button>
              )}
              {streak > 0 && (
                <button
                  type="button"
                  className="publication-streak"
                  onClick={onOpenProfile}
                  aria-label={`Reading streak: ${streak} days`}
                >
                  <Flame aria-hidden="true" />
                  <span>{streak}</span>
                </button>
              )}
              <button
                type="button"
                className="publication-avatar"
                onClick={onOpenProfile}
                aria-label="Open profile and settings"
              >
                <span aria-hidden="true">{initial}</span>
              </button>
            </nav>
          </header>
          <p className="publication-promise">
            A publication written entirely for you, every day.
          </p>
          {children}
        </div>
      </div>
      {showCreate && (
        <button
          type="button"
          className="publication-create"
          onClick={onCreate}
          aria-label={`Create one ${section === "news" ? "article" : section === "books" ? "book" : "podcast"}`}
        >
          <Plus aria-hidden="true" />
        </button>
      )}
      <PublicationNavigation
        mobile
        section={section}
        onSectionChange={onSectionChange}
      />
    </div>
  );
}

export function PublicationFolio({
  section,
  editionDate,
  personalLabel,
  count,
}: {
  section: PublicationSection;
  editionDate: string;
  personalLabel: string;
  count: number;
}) {
  const date = new Date(editionDate);
  const validDate = Number.isFinite(date.getTime());
  const label = section === "news" ? "Current edition" : section === "books" ? "Reading library" : "Listening queue";
  const noun = section === "news"
    ? count === 1 ? "story" : "stories"
    : section === "books"
      ? count === 1 ? "book" : "books"
      : count === 1 ? "episode" : "episodes";

  return (
    <div className="publication-folio" aria-label={`${label} details`}>
      <span className="publication-folio-label">{label}</span>
      <span className="publication-personal-label">{personalLabel}</span>
      <span className="publication-folio-context">
        {validDate && (
          <>
            <time dateTime={editionDate}>
              {new Intl.DateTimeFormat("en", {
                month: "long",
                day: "numeric",
                year: "numeric",
                timeZone: "UTC",
              }).format(date)}
            </time>
            <span aria-hidden="true"> · </span>
          </>
        )}
        {count} {noun}
      </span>
    </div>
  );
}
