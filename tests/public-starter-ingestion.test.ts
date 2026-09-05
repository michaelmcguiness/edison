import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  bindPublishedSubjectManifest,
  buildPublicationSql,
  loadPublicStarterFixture,
  publicStarterFixturePath,
  runPublicStarterCli,
  sha256,
  toPublicationRequest,
  validatePublicStarterFixtureData,
} from "../scripts/public-starter";

const fixture = loadPublicStarterFixture();

function publishedEdition() {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    section: "news" as const,
    editionDate: fixture.edition.editionDate,
    label: fixture.edition.label,
    publishedAt: "2026-09-05T22:00:00.000Z",
    itemCount: fixture.items.length,
    items: fixture.items.map((item, index) => ({
      id: `20000000-0000-4000-8000-00000000000${index + 1}`,
      position: index + 1,
      reason: item.reason,
      article: item.article,
    })),
  };
}

test("reviewed public starter fixture contains only the accepted Sleep and History artifacts", () => {
  assert.deepEqual(
    fixture.items.map((item) => [
      item.contentId,
      item.subjectId,
      item.sourceDocument.sha256,
    ]),
    [
      [
        "sleep-attention",
        "sleep",
        "9ced5cc067151e4f31406b6fa5bcf078d386af11969b85605b64583a0643e8f1",
      ],
      [
        "longitude",
        "history",
        "b7a8b5674625f2d694998b4497d9c1049f6d4387721f12a09896c8a6ed42dbae",
      ],
    ],
  );
  assert.equal(
    fixture.approval.prohibitedArticleFingerprint,
    "aa26d2258cb391ad552466f39bee01ae4d1596d480fef59381dfeb9b184d8c50",
  );
  assert.equal(fixture.approval.prohibitedFingerprintKind, "lost-request-json");

  for (const item of fixture.items) {
    const source = readFileSync(
      new URL(`../${item.sourceDocument.path}`, import.meta.url),
    );
    assert.equal(source.byteLength, item.sourceDocument.bytes);
    assert.equal(sha256(source), item.sourceDocument.sha256);
    assert.notEqual(
      item.sourceDocument.sha256,
      fixture.approval.prohibitedArticleFingerprint,
    );
    assert.notEqual(
      item.snapshotSha256,
      fixture.approval.prohibitedArticleFingerprint,
    );
  }
});

test("fixture validation pins accepted prose, source URLs, citations, and request identity", () => {
  const raw = JSON.parse(readFileSync(publicStarterFixturePath, "utf8")) as unknown;
  assert.equal(validatePublicStarterFixtureData(raw).fixtureId, fixture.fixtureId);

  const request = toPublicationRequest(fixture);
  assert.equal(request.items.length, 2);
  assert.equal(
    fixture.edition.requestFingerprint,
    "a3f2f9e5bee9882891a7be35505b371088580e65d978a086a9889bb3519d3371",
  );
  assert.deepEqual(
    request.items.map((item) => [
      item.article.title,
      item.article.readingMinutes,
      item.article.sourceCount,
    ]),
    [
      ["Six-Hour Nights Can Feel Fine. That’s the Problem.", 3, 6],
      ["Why longitude became a problem of time", 5, 5],
    ],
  );

  const serialized = JSON.stringify(request);
  for (const privateField of [
    "ownerId",
    "userId",
    "email",
    "whyWritten",
    "writtenFor",
    "model",
    "prompt",
  ]) {
    assert.doesNotMatch(serialized, new RegExp(`"${privateField}"`));
  }
});

test("lost request JSON and any accepted-content drift fail closed", () => {
  const changed = structuredClone(fixture);
  changed.items[1]!.sourceDocument.sha256 =
    changed.approval.prohibitedArticleFingerprint;
  assert.throws(
    () => validatePublicStarterFixtureData(changed),
    /accepted source identity|lost request-JSON fingerprint/,
  );

  const rewritten = structuredClone(fixture);
  rewritten.items[0]!.article.body[0] = {
    type: "paragraph",
    text: "A rewritten opening must receive its own editorial acceptance.",
    citations: rewritten.items[0]!.article.body[0]!.type === "paragraph"
      ? rewritten.items[0]!.article.body[0]!.citations
      : [],
  };
  assert.throws(
    () => validatePublicStarterFixtureData(rewritten),
    /reader body diverges/,
  );
});

test("checked-in SQL is generated from the validated fixture and preserves publication invariants", () => {
  const generated = buildPublicationSql(fixture);
  const checkedIn = readFileSync(
    new URL(
      "../content/public-starters/accepted-sleep-history-v1.sql",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(checkedIn, generated);
  assert.match(generated, /^-- Generated from .*\n-- PREPARED ONLY:/);
  assert.match(generated, /BEGIN;[\s\S]*COMMIT;/);
  assert.match(generated, /pg_advisory_xact_lock/);
  assert.match(
    generated,
    /AT TIME ZONE 'UTC'[\s\S]*starter_edition_date_in_future/,
  );
  assert.match(generated, /existing_edition\.request_fingerprint <>/);
  assert.match(generated, /existing_edition\.status <> 'published'/);
  assert.match(generated, /RAISE EXCEPTION 'starter_edition_date_exists'/);
  assert.match(
    generated,
    /INSERT INTO public\.public_starter_editions[\s\S]*'draft',[\s\S]*NULL/,
  );
  assert.match(
    generated,
    /INSERT INTO public\.public_starter_edition_articles[\s\S]*new_edition_id, 1[\s\S]*new_edition_id, 2/,
  );
  assert.match(
    generated,
    /UPDATE public\.public_starter_editions[\s\S]*SET status = 'published',[\s\S]*published_at = clock_timestamp\(\)/,
  );
  assert.doesNotMatch(generated, /^\s*(?:DELETE|TRUNCATE|DROP|ALTER)\b/im);
  assert.doesNotMatch(
    generated,
    /DATABASE_URL|Authorization:|access[_-]?token|service_role/i,
  );

  const editionInsert = generated.indexOf(
    "INSERT INTO public.public_starter_editions",
  );
  const itemInsert = generated.indexOf(
    "INSERT INTO public.public_starter_edition_articles",
  );
  const publicationUpdate = generated.indexOf(
    "UPDATE public.public_starter_editions",
  );
  assert.ok(
    editionInsert > 0 &&
      itemInsert > editionInsert &&
      publicationUpdate > itemInsert,
  );
});

test("subject IDs bind only after exact database-generated publication IDs exist", () => {
  const edition = publishedEdition();
  const manifest = bindPublishedSubjectManifest(fixture, edition);
  assert.equal(manifest.editionId, edition.id);
  assert.deepEqual(
    manifest.articles.map((item) => [
      item.contentId,
      item.subjectId,
      item.publicArticleId,
    ]),
    [
      ["sleep-attention", "sleep", edition.items[0]!.id],
      ["longitude", "history", edition.items[1]!.id],
    ],
  );
  assert.deepEqual(manifest.subjects, [
    {
      id: "sleep",
      label: "Sleep",
      direction: "Understand sleep, attention and recovery.",
      publicArticleIds: [edition.items[0]!.id],
    },
    {
      id: "history",
      label: "History",
      direction: "Explore how ideas and inventions changed everyday life.",
      publicArticleIds: [edition.items[1]!.id],
    },
  ]);

  const mismatched = structuredClone(edition);
  mismatched.items[0]!.article.title = "A different article";
  assert.throws(
    () => bindPublishedSubjectManifest(fixture, mismatched),
    /does not match sleep-attention/,
  );
});

test("operator CLI defaults to local validation and has no publish mode", () => {
  assert.match(runPublicStarterCli([]), /no external action taken/);
  const help = runPublicStarterCli(["--help"]);
  assert.match(help, /default is validation only/i);
  assert.doesNotMatch(help, /--publish|bearer|token/i);
});
