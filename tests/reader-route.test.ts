import assert from "node:assert/strict";
import test from "node:test";
import {
  detectOneOffSection,
  guestDirectionImportKey,
  isAmbiguousCreationRequest,
  mergeConversationMessages,
  parseReaderRoute,
  readerRouteHref,
  resolveLiveNewsEditionId,
} from "../components/edison/reader-app";

test("reader routes keep sections and article deep links explicit", () => {
  assert.deepEqual(parseReaderRoute("?section=books"), {
    section: "books",
    view: "home",
    articleId: null,
  });
  assert.deepEqual(parseReaderRoute("?section=news&view=article&article=story%2Fone"), {
    section: "news",
    view: "article",
    articleId: "story/one",
  });
  assert.equal(readerRouteHref({ section: "podcasts", view: "profile", articleId: null }), "/?section=podcasts&view=profile");
  assert.equal(readerRouteHref({ section: "news", view: "article", articleId: "story/one" }), "/?view=article&article=story%2Fone");
});

test("invalid and incomplete reader routes fail back to a safe News home", () => {
  assert.deepEqual(parseReaderRoute("?section=admin&view=article"), {
    section: "news",
    view: "home",
    articleId: null,
  });
  assert.deepEqual(parseReaderRoute("?section=books&view=unknown&article=ignored"), {
    section: "books",
    view: "home",
    articleId: null,
  });
});

test("Pulse routes retain an opaque originating loop through deep links and reject raw curiosity", () => {
  const loopId = "00000000-0000-4000-8000-000000000003";
  const route = { section: "news" as const, view: "article" as const, articleId: "00000000-0000-4000-8000-000000000004", loopId };
  assert.deepEqual(parseReaderRoute(readerRouteHref(route).slice(1)), route);
  assert.equal(parseReaderRoute("?loop=my%20private%20question").loopId, undefined);
  assert.equal(parseReaderRoute("?loop=collection").loopId, "collection");
  assert.doesNotMatch(readerRouteHref({ ...route, loopId: "my private question" }), /question/);
});

test("one-off detection is conservative and resolves an explicit format", () => {
  assert.equal(detectOneOffSection("Write me an article about public squares"), "news");
  assert.equal(detectOneOffSection("Please create a short book about bridges"), "books");
  assert.equal(detectOneOffSection("Compose a podcast episode about sleep"), "podcasts");
  assert.equal(detectOneOffSection("More reporting about public squares"), null);
  assert.equal(detectOneOffSection("Write with more historical depth"), null);
  assert.equal(isAmbiguousCreationRequest("Write something about bridges"), true);
  assert.equal(isAmbiguousCreationRequest("Make the feed more surprising"), false);
});

test("live News edition identity fails closed when feed and direction disagree", () => {
  const feedEditionId = "00000000-0000-4000-8000-000000000001";
  const directionEditionId = "00000000-0000-4000-8000-000000000002";

  assert.equal(resolveLiveNewsEditionId(feedEditionId, feedEditionId), feedEditionId);
  assert.equal(resolveLiveNewsEditionId(feedEditionId, null), feedEditionId);
  assert.equal(resolveLiveNewsEditionId(null, directionEditionId), directionEditionId);
  assert.equal(resolveLiveNewsEditionId(feedEditionId, directionEditionId), "");
});

test("guest import keys are stable per local direction revision", () => {
  const direction = {
    id: "00000000-0000-4000-8000-000000000001",
    revision: 3,
  };

  assert.equal(
    guestDirectionImportKey(direction),
    "guest-direction-00000000-0000-4000-8000-000000000001-r3",
  );
  assert.notEqual(
    guestDirectionImportKey({ ...direction, revision: 4 }),
    guestDirectionImportKey(direction),
  );
});

test("conversation hydration merges replayed messages without duplicates", () => {
  const first = {
    id: "00000000-0000-4000-8000-000000000001",
    role: "user" as const,
    content: "What changed?",
    citations: [],
    createdAt: "2026-09-04T12:00:00.000Z",
  };
  const answer = {
    id: "00000000-0000-4000-8000-000000000002",
    role: "assistant" as const,
    content: "The durable answer.",
    citations: [],
    createdAt: "2026-09-04T12:00:01.000Z",
  };

  assert.deepEqual(
    mergeConversationMessages([first], [answer, { ...first }]),
    [first, answer],
  );
});
