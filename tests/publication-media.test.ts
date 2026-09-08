import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import test from "node:test";
import { BooksHome, PodcastsHome } from "../components/edison/publication-media";
import {
  bookProgressPercent,
  formatMediaDuration,
  mediaDateLabel,
  safePublicationUrl,
  selectContinueReading,
  type BookRecord,
  type PodcastRecord,
} from "../lib/publication-media";

const book: BookRecord = {
  id: "test-book-1",
  title: "Catalog title",
  readerHref: "/library/test-book-1",
  progress: { completed: 1, total: 4, lastReadAt: "2026-09-01T00:00:00Z" },
};
const episode: PodcastRecord = {
  id: "test-episode-1",
  title: "Catalog episode",
  showTitle: "Catalog show",
  episodeHref: "/listen/test-episode-1",
};

test("empty media homes disclose missing services without samples or preview actions", () => {
  const books = renderToStaticMarkup(createElement(BooksHome, { books: [] }));
  const podcasts = renderToStaticMarkup(createElement(PodcastsHome, { episodes: [] }));
  assert.match(books, /Book publishing and a book reader aren’t connected/);
  assert.match(podcasts, /Podcast publishing and playback aren’t connected/);
  for (const html of [books, podcasts]) {
    assert.doesNotMatch(html, /<button|<a |<audio|<progress/);
    assert.doesNotMatch(html, /Michael|design sample|How Cities Remember/);
  }
});

test("connected empty media homes distinguish no records from missing integration", () => {
  const html = renderToStaticMarkup(createElement(BooksHome, { books: [], connected: true }));
  assert.match(html, /No books have been added/);
  assert.doesNotMatch(html, /aren’t connected|No books have been generated/);
});

test("continue reading uses actual progress and latest reading timestamp without mutating records", () => {
  const newer: BookRecord = { ...book, id: "newer", progress: { completed: 2, total: 3, lastReadAt: "2026-09-02T00:00:00Z" } };
  const records = Object.freeze([book, newer]);
  assert.equal(selectContinueReading(records)?.id, "newer");
  assert.equal(records[0], book);
  assert.equal(bookProgressPercent(book), 25);
});

test("continue reading never invents progress or links for unavailable, finished, or unstarted books", () => {
  const variants: BookRecord[] = [
    { ...book, readerHref: undefined },
    { ...book, progress: undefined },
    { ...book, progress: { ...book.progress!, completed: 0 } },
    { ...book, progress: { ...book.progress!, completed: 4 } },
    { ...book, progress: { ...book.progress!, lastReadAt: "invalid" } },
  ];
  assert.equal(selectContinueReading(variants), null);
});

test("invalid reading progress is omitted instead of coerced to a plausible number", () => {
  for (const progress of [
    { completed: -1, total: 4 }, { completed: 5, total: 4 },
    { completed: 1, total: 0 }, { completed: NaN, total: 2 },
    { completed: 1, total: Infinity },
  ]) {
    assert.equal(bookProgressPercent({ ...book, progress: { ...progress, lastReadAt: "2026-09-02" } }), null);
  }
});

test("catalog URLs allow local and HTTPS links but reject unsafe schemes and credentials", () => {
  assert.equal(safePublicationUrl("/library/book?chapter=2#paragraph-3"), "/library/book?chapter=2#paragraph-3");
  assert.equal(safePublicationUrl("https://media.example.test/episode"), "https://media.example.test/episode");
  for (const url of ["javascript:alert(1)", "data:text/html,hi", "//example.test", "\\evil.test", "/\\evil.test", "https://user:pass@example.test", "https:\n//example.test", " https://example.test", "http://example.test", "ftp://example.test", ""]) {
    assert.equal(safePublicationUrl(url), null, url);
  }
});

test("books retain earlier editions and label today's additions only when explicitly confirmed", () => {
  const added: BookRecord = { id: "today", title: "New catalog title", addedInEditionId: "edition-current" };
  const old: BookRecord = { id: "old", title: "Retained title", addedInEditionId: "edition-old" };
  const html = renderToStaticMarkup(createElement(BooksHome, {
    books: [book, added, old], editionId: "edition-current", editionIsToday: true,
  }));
  assert.match(html, /Continue reading/);
  assert.match(html, /Added to your library today/);
  assert.match(html, /Your library/);
  assert.match(html, /Retained title/);
  assert.match(html, /25% read/);
  const olderEdition = renderToStaticMarkup(createElement(BooksHome, { books: [added], editionId: "edition-current" }));
  assert.match(olderEdition, /Added in this edition/);
  assert.doesNotMatch(olderEdition, /today/);
});

test("supplied book titles are escaped and missing readers have no fabricated action", () => {
  const html = renderToStaticMarkup(createElement(BooksHome, { books: [{ id: "x", title: "<script>unsafe</script>" }] }));
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Reader unavailable/);
  assert.doesNotMatch(html, /<a |<script>/);
});

test("podcast feature and new episode rows keep real metadata and working destination links", () => {
  const fresh: PodcastRecord = {
    ...episode, id: "fresh", title: "New catalog episode", durationSeconds: 1510,
    listenedSeconds: 0, publishedAt: "2026-09-04T00:00:00Z", addedInEditionId: "edition-current",
  };
  const html = renderToStaticMarkup(createElement(PodcastsHome, {
    episodes: [fresh, episode], featuredEpisodeId: episode.id, editionId: "edition-current",
  }));
  assert.match(html, /Featured episode · Catalog show/);
  assert.match(html, /New episodes/);
  assert.match(html, /25 min 10 sec/);
  assert.match(html, /Sep 4, 2026/);
  assert.match(html, /Unplayed/);
  assert.match(html, /href="\/listen\/test-episode-1"/);
  assert.doesNotMatch(html, /<audio|Preview|data-audio/);
});

test("podcasts with no playback state or route do not claim unplayed, progress, or playable audio", () => {
  const html = renderToStaticMarkup(createElement(PodcastsHome, { episodes: [{ ...episode, episodeHref: undefined }] }));
  assert.match(html, /Playback unavailable/);
  assert.doesNotMatch(html, /Unplayed|listened|<a |<button|<audio/);
});

test("media dates and durations never substitute the current day or made-up duration", () => {
  assert.equal(mediaDateLabel(undefined), null);
  assert.equal(mediaDateLabel("invalid"), null);
  assert.equal(formatMediaDuration(undefined), null);
  assert.equal(formatMediaDuration(-1), null);
  assert.equal(formatMediaDuration(NaN), null);
  assert.equal(formatMediaDuration(0), "0 sec");
  assert.equal(formatMediaDuration(3601), "1 hr");
});
