import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import type { ArticleCard } from "@edison/contracts";
import { matchPreparedSubject, preparedArtworkByArticleId, preparedSubjects, preparedSuggestions } from "../lib/prepared-catalog";
import { loadPublicStarterFixture } from "../scripts/public-starter";

const published = JSON.parse(readFileSync(new URL("../content/public-starters/published-sleep-history-v1.json", import.meta.url), "utf8"));
const fixture = loadPublicStarterFixture();
const available: ArticleCard[] = fixture.items.map((item, index) => ({ ...item.article, id: published.articles[index].publicArticleId, slug: item.contentId, reason: item.reason, saved: false, completed: false }));

test("prepared subjects and artwork bind only the two verified published snapshots", () => {
  assert.equal(published.requestFingerprint, fixture.edition.requestFingerprint);
  assert.equal(published.articles.length, 2);
  fixture.items.forEach((item, index) => {
    assert.equal(published.articles[index].snapshotSha256, item.snapshotSha256);
    assert.equal(published.articles[index].contentId, item.contentId);
  });
  assert.deepEqual(preparedSubjects.flatMap((subject) => subject.articleIds), available.map((article) => article.id));
  assert.deepEqual(preparedSuggestions(available), ["Sleep", "History"]);
  assert.equal(preparedArtworkByArticleId[available[0].id].src, "/brand/pulse-loops/sleep-attention.png");
  assert.equal(preparedArtworkByArticleId[available[1].id].src, "/brand/pulse-loops/longitude.png");
  assert.equal(preparedArtworkByArticleId["unrelated-live-article"], undefined);
});

test("topic matching is explicit and never pads unavailable inventory or infers private intent", () => {
  assert.equal(matchPreparedSubject(" Sleep? ", available)?.title, "Sleep");
  assert.equal(matchPreparedSubject("longitude", available)?.title, "History");
  assert.equal(matchPreparedSubject("my health problem", available), null);
  assert.equal(matchPreparedSubject("AI", available), null);
  assert.equal(matchPreparedSubject("Sleep", []), null);
  assert.deepEqual(preparedSuggestions(available.slice(1)), ["History"]);
});
