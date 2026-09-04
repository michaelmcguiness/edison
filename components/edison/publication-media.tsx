import {
  bookProgressPercent,
  formatMediaDuration,
  mediaDateLabel,
  safePublicationUrl,
  selectContinueReading,
  type BookRecord,
  type PodcastRecord,
} from "@/lib/publication-media";

export type { BookRecord, PodcastRecord } from "@/lib/publication-media";

export type BooksHomeProps = {
  books: readonly BookRecord[];
  /** Stable publication edition ID, never a device-local day calculation. */
  editionId?: string;
  /** Set only when the supplied edition is actually today's publication. */
  editionIsToday?: boolean;
  connected?: boolean;
};

export type PodcastsHomeProps = {
  episodes: readonly PodcastRecord[];
  editionId?: string;
  featuredEpisodeId?: string;
  connected?: boolean;
};

function MediaEmpty({ format, connected }: {
  format: "books" | "podcasts";
  connected: boolean;
}) {
  const books = format === "books";
  return (
    <section className="publication-media-empty" aria-labelledby={`${format}-empty-title`}>
      <p className="publication-kicker">{books ? "Your reading library" : "Your listening queue"}</p>
      <h2 id={`${format}-empty-title`}>
        {books ? "Room for your next good book." : "Something worth listening to."}
      </h2>
      <p>{connected
        ? (books ? "No books have been added to your library yet." : "No episodes have been added to your queue yet.")
        : (books
          ? "Book publishing and a book reader aren’t connected yet. Your library will appear here when real books are available."
          : "Podcast publishing and playback aren’t connected yet. Your queue will appear here when real episodes are available.")}</p>
      {!connected && <p className="publication-media-note">No {books ? "books" : "episodes"} have been generated.</p>}
    </section>
  );
}

function Cover({ title, credit, imageUrl, podcast = false }: {
  title: string;
  credit?: string;
  imageUrl?: string;
  podcast?: boolean;
}) {
  const image = safePublicationUrl(imageUrl);
  return (
    <div className={`publication-media-cover${podcast ? " publication-podcast-art" : ""}`} aria-hidden="true">
      {image ? (
        // Catalog artwork is optional and may be served by a configured external source.
        // eslint-disable-next-line @next/next/no-img-element
        <img src={image} alt="" loading="lazy" decoding="async" />
      ) : (
        <><strong>{title}</strong>{credit && <span>{credit}</span>}</>
      )}
    </div>
  );
}

function BookProgress({ book }: { book: BookRecord }) {
  const value = bookProgressPercent(book);
  if (value === null) return null;
  // Do not round an unfinished book to "100% read".
  const label = value === 100 ? "Finished" : `${Math.floor(value)}% read`;
  return <div className="publication-media-progress">
    <progress value={value} max={100} aria-label={`${book.title}: ${label}`} />
    <span>{label}</span>
  </div>;
}

function BookCard({ book }: { book: BookRecord }) {
  const href = safePublicationUrl(book.readerHref);
  const minutes = book.readingMinutes;
  return <article className="publication-book-card">
    {href ? <a className="publication-cover-link" href={href} aria-label={`Read ${book.title}`}>
      <Cover title={book.title} credit={book.author} imageUrl={book.coverUrl} />
    </a> : <Cover title={book.title} credit={book.author} imageUrl={book.coverUrl} />}
    <h3>{href ? <a href={href}>{book.title}</a> : book.title}</h3>
    {book.author && <p className="publication-media-meta">{book.author}</p>}
    {minutes !== undefined && Number.isFinite(minutes) && minutes > 0 &&
      <p className="publication-media-meta">{minutes} min read</p>}
    <BookProgress book={book} />
    {!href && <p className="publication-media-note">Reader unavailable</p>}
  </article>;
}

function BooksGroup({ title, books }: { title: string; books: readonly BookRecord[] }) {
  if (!books.length) return null;
  return <section className="publication-media-group" aria-label={title}>
    <div className="publication-media-heading"><h2>{title}</h2><span>{books.length} {books.length === 1 ? "book" : "books"}</span></div>
    <div className="publication-books-grid">{books.map((book) => <BookCard key={book.id} book={book} />)}</div>
  </section>;
}

export function BooksHome({ books, editionId, editionIsToday = false, connected = false }: BooksHomeProps) {
  if (!books.length) return <MediaEmpty format="books" connected={connected} />;
  const current = selectContinueReading(books);
  const additions = editionId ? books.filter((book) => book.addedInEditionId === editionId) : [];
  const retained = books.filter((book) => !additions.includes(book) && book.id !== current?.id);
  return <div className="publication-books-home">
    {current && <section className="publication-media-feature" aria-label="Continue reading">
      <a className="publication-cover-link" href={safePublicationUrl(current.readerHref)!} aria-label={`Continue reading ${current.title}`}>
        <Cover title={current.title} credit={current.author} imageUrl={current.coverUrl} />
      </a>
      <div className="publication-media-feature-copy">
        <p className="publication-kicker">Continue reading</p>
        <h2>{current.title}</h2>
        {current.author && <p className="publication-media-meta">{current.author}</p>}
        {current.description && <p className="publication-media-description">{current.description}</p>}
        <BookProgress book={current} />
        <a className="publication-media-action" href={safePublicationUrl(current.readerHref)!}>Continue reading<span aria-hidden="true"> →</span></a>
      </div>
    </section>}
    <BooksGroup title={editionIsToday ? "Added to your library today" : "Added in this edition"} books={additions} />
    <BooksGroup title="Your library" books={retained} />
  </div>;
}

function EpisodeMetadata({ episode }: { episode: PodcastRecord }) {
  const duration = formatMediaDuration(episode.durationSeconds);
  const date = mediaDateLabel(episode.publishedAt);
  const listened = formatMediaDuration(episode.listenedSeconds);
  return <div className="publication-media-meta publication-episode-meta">
    {duration && <span>{duration}</span>}
    {date && <time dateTime={episode.publishedAt}>{date}</time>}
    {listened && <span>{episode.listenedSeconds === 0 ? "Unplayed" : `${listened} listened`}</span>}
  </div>;
}

function EpisodeAction({ episode }: { episode: PodcastRecord }) {
  const href = safePublicationUrl(episode.episodeHref);
  return href
    ? <a className="publication-media-action" href={href} aria-label={`Open episode: ${episode.title}`}>Open episode<span aria-hidden="true"> →</span></a>
    : <p className="publication-media-note">Playback unavailable</p>;
}

function EpisodesGroup({ title, episodes }: { title: string; episodes: readonly PodcastRecord[] }) {
  if (!episodes.length) return null;
  return <section className="publication-media-group" aria-label={title}>
    <div className="publication-media-heading"><h2>{title}</h2><span>{episodes.length} {episodes.length === 1 ? "episode" : "episodes"}</span></div>
    <div className="publication-episode-list">{episodes.map((episode) => <article className="publication-episode" key={episode.id}>
      <Cover title={episode.showTitle} imageUrl={episode.artworkUrl} podcast />
      <div><p className="publication-media-meta">{episode.showTitle}</p><h3>{episode.title}</h3>
        {episode.description && <p className="publication-media-description">{episode.description}</p>}
        <EpisodeMetadata episode={episode} /><EpisodeAction episode={episode} />
      </div>
    </article>)}</div>
  </section>;
}

export function PodcastsHome({ episodes, editionId, featuredEpisodeId, connected = false }: PodcastsHomeProps) {
  if (!episodes.length) return <MediaEmpty format="podcasts" connected={connected} />;
  const featured = episodes.find((episode) => episode.id === featuredEpisodeId) ?? episodes[0];
  const remaining = episodes.filter((episode) => episode.id !== featured.id);
  const additions = editionId ? remaining.filter((episode) => episode.addedInEditionId === editionId) : [];
  const retained = remaining.filter((episode) => !additions.includes(episode));
  return <div className="publication-podcasts-home">
    <section className="publication-media-feature" aria-label="Featured episode">
      <Cover title={featured.showTitle} imageUrl={featured.artworkUrl} podcast />
      <div className="publication-media-feature-copy"><p className="publication-kicker">Featured episode · {featured.showTitle}</p>
        <h2>{featured.title}</h2>
        {featured.description && <p className="publication-media-description">{featured.description}</p>}
        <EpisodeMetadata episode={featured} /><EpisodeAction episode={featured} />
      </div>
    </section>
    <EpisodesGroup title="New episodes" episodes={additions} />
    <EpisodesGroup title="Your listening queue" episodes={retained} />
  </div>;
}
