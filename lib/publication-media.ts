/** Display records supplied by a real catalog/reader integration, not API contracts. */
export type BookRecord = {
  id: string;
  title: string;
  author?: string;
  description?: string;
  readerHref?: string;
  coverUrl?: string;
  addedInEditionId?: string;
  readingMinutes?: number;
  progress?: {
    completed: number;
    total: number;
    lastReadAt: string;
  };
};

export type PodcastRecord = {
  id: string;
  title: string;
  showTitle: string;
  description?: string;
  /** A functioning episode/player destination; this component never fabricates audio. */
  episodeHref?: string;
  artworkUrl?: string;
  addedInEditionId?: string;
  publishedAt?: string;
  durationSeconds?: number;
  listenedSeconds?: number;
};

/** Reject script/data URLs and protocol-relative destinations from catalog data. */
export function safePublicationUrl(value: string | undefined): string | null {
  if (!value || value !== value.trim() || /[\\\u0000-\u0020\u007f]/.test(value)) {
    return null;
  }
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password
      ? value
      : null;
  } catch {
    return null;
  }
}

export function bookProgressPercent(book: BookRecord): number | null {
  const progress = book.progress;
  if (
    !progress ||
    !Number.isFinite(progress.completed) ||
    !Number.isFinite(progress.total) ||
    progress.total <= 0 ||
    progress.completed < 0 ||
    progress.completed > progress.total
  ) return null;
  return (progress.completed / progress.total) * 100;
}

export function selectContinueReading(books: readonly BookRecord[]): BookRecord | null {
  return books
    .filter((book) => {
      const progress = bookProgressPercent(book);
      return progress !== null && progress > 0 && progress < 100 &&
        Boolean(safePublicationUrl(book.readerHref)) &&
        Number.isFinite(Date.parse(book.progress!.lastReadAt));
    })
    .sort((left, right) =>
      Date.parse(right.progress!.lastReadAt) - Date.parse(left.progress!.lastReadAt),
    )[0] ?? null;
}

export function formatMediaDuration(seconds: number | undefined): string | null {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds < 0) return null;
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const remainder = whole % 60;
  if (hours) return `${hours} hr${minutes ? ` ${minutes} min` : ""}`;
  if (minutes) return `${minutes} min${remainder ? ` ${remainder} sec` : ""}`;
  return `${remainder} sec`;
}

export function mediaDateLabel(value: string | undefined): string | null {
  if (!value || !Number.isFinite(Date.parse(value))) return null;
  return new Intl.DateTimeFormat("en", {
    month: "short", day: "numeric", year: "numeric", timeZone: "UTC",
  }).format(new Date(value));
}
