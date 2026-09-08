import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createEditorialInstructionRequestSchema,
  maxEditorialInstructionsPerSection,
  publicStarterEditionSchema,
  publishPublicStarterEditionRequestSchema,
} from "@edison/contracts";
import { fingerprintRequest } from "./request-fingerprint";
import { json, publicApiHandler } from "../http/api-handler";

const editionId = "10000000-0000-4000-8000-000000000001";
const idempotencyKey = "direction-10000000-0000-4000-8000-000000000001";

const source = {
  id: "20000000-0000-4000-8000-000000000001",
  title: "A source",
  publisher: "Example Institute",
  url: "https://example.com/research",
  publishedAt: null,
  accessedAt: "2026-09-04T12:00:00.000Z",
};

const article = {
  version: 1 as const,
  category: "tech-science" as const,
  kicker: "Science",
  topic: "A grounded topic",
  title: "A grounded public article",
  deck: "A useful explanation based on a real source.",
  body: [
    {
      type: "paragraph" as const,
      text: "A sourced claim.",
      citations: [{ sourceId: source.id, label: "1" }],
    },
  ],
  summary: ["First", "Second", "Third"],
  readingMinutes: 4,
  sourceCount: 1,
  researchedAt: "2026-09-04T12:00:00.000Z",
  publishedAt: "2026-09-04T12:00:00.000Z",
  sources: [source],
};

test("editorial instruction scope and edition identity must agree", () => {
  assert.equal(
    createEditorialInstructionRequestSchema.safeParse({
      section: "news",
      text: "More economic history.",
      scope: "edition",
      editionId,
      expectedRevision: 0,
      idempotencyKey,
    }).success,
    true,
  );
  assert.equal(
    createEditorialInstructionRequestSchema.safeParse({
      section: "news",
      text: "More economic history.",
      scope: "edition",
      expectedRevision: 0,
      idempotencyKey,
    }).success,
    false,
  );
  assert.equal(
    createEditorialInstructionRequestSchema.safeParse({
      section: "news",
      text: "More economic history.",
      scope: "persistent",
      editionId,
      expectedRevision: 0,
      idempotencyKey,
    }).success,
    false,
  );
  assert.equal(
    createEditorialInstructionRequestSchema.safeParse({
      section: "news",
      text: "More economic history.",
      scope: "persistent",
      expectedRevision: 0,
      idempotencyKey,
      ownerId: "41000000-0000-4000-8000-000000000002",
    }).success,
    false,
  );
});

test("public starter publication accepts only safe strict article snapshots", () => {
  const valid = {
    editionDate: "2026-09-04",
    label: "A place to begin",
    idempotencyKey: "starter-10000000-0000-4000-8000-000000000001",
    items: [{ reason: "A varied place to begin.", article }],
  };
  assert.equal(
    publishPublicStarterEditionRequestSchema.safeParse(valid).success,
    true,
  );
  assert.equal(
    publishPublicStarterEditionRequestSchema.safeParse({
      ...valid,
      items: [
        {
          reason: "Private personalization must not leak.",
          article: { ...article, whyWritten: "The reader asked privately." },
        },
      ],
    }).success,
    false,
  );
});

test("public article source links reject executable schemes and credentials", () => {
  const request = (url: string) => ({
    editionDate: "2026-09-04",
    label: "A place to begin",
    idempotencyKey: "starter-10000000-0000-4000-8000-000000000001",
    items: [
      {
        reason: "A varied place to begin.",
        article: { ...article, sources: [{ ...source, url }] },
      },
    ],
  });

  assert.equal(
    publishPublicStarterEditionRequestSchema.safeParse(
      request("javascript:alert(1)"),
    ).success,
    false,
  );
  assert.equal(
    publishPublicStarterEditionRequestSchema.safeParse(
      request("https://reader:secret@example.com/source"),
    ).success,
    false,
  );
  assert.equal(
    publishPublicStarterEditionRequestSchema.safeParse(
      request("https://example.com/source"),
    ).success,
    true,
  );
});

test("starter edition item counts are verified", () => {
  assert.equal(
    publicStarterEditionSchema.safeParse({
      id: editionId,
      section: "news",
      editionDate: "2026-09-04",
      label: "A place to begin",
      publishedAt: "2026-09-04T12:00:00.000Z",
      itemCount: 2,
      items: [
        {
          id: "30000000-0000-4000-8000-000000000001",
          position: 1,
          reason: "A varied place to begin.",
          article,
        },
      ],
    }).success,
    false,
  );
});

test("request fingerprints are stable and distinguish semantic edits", () => {
  const request = ["create", "news", "More history", "persistent", null, 0];
  assert.equal(fingerprintRequest(request), fingerprintRequest(request));
  assert.notEqual(
    fingerprintRequest(request),
    fingerprintRequest(["create", "books", "More history", "persistent", null, 0]),
  );
  assert.match(fingerprintRequest(request), /^[a-f0-9]{64}$/);
});

test("server direction writes enforce the same 50-per-section cap as the client", () => {
  assert.equal(maxEditorialInstructionsPerSection, 50);
  const serviceSource = readFileSync(
    new URL("./editorial-directions.ts", import.meta.url),
    "utf8",
  );
  assert.match(
    serviceSource,
    /activeInstructionCount >= maxEditorialInstructionsPerSection/,
  );
  const createStart = serviceSource.indexOf(
    "export async function createEditorialInstruction",
  );
  const stateLock = serviceSource.indexOf(
    "const state = await requireDirectionState",
    createStart,
  );
  const countCheck = serviceSource.indexOf(
    "activeInstructionCount",
    createStart,
  );
  assert.ok(createStart >= 0 && stateLock > createStart && countCheck > stateLock);
  assert.match(serviceSource, /editorial_direction_limit_reached/);
});

test("the public endpoint wrapper serves a read without an Authorization header", async () => {
  const response = await publicApiHandler(
    new Request("https://api.edison.test/v1/public/editions/news/current"),
    async () => json({ visibility: "public-only" }),
  );
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { visibility: "public-only" });
  assert.equal(response.headers.get("cache-control"), "no-store");
});
