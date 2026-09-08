import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  bindPublishedSubjectManifest,
  buildPublicationReadSql,
  loadPublicStarterFixture,
} from "./public-starter";

// Intentionally no linked/project/URL option: this gate only uses disposable CI Postgres.
function execute(args: string[]) {
  return execFileSync(
    "pnpm",
    [
      "exec",
      "supabase",
      "db",
      "query",
      "--local",
      "--agent",
      "no",
      "--output-format",
      "json",
      ...args,
    ],
    { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 },
  );
}

function query(args: string[]) {
  const output = execute(args);
  const match = /(^|\n)\s*\[/.exec(output);
  if (!match) {
    const prefix = output.trim().replace(/\s+/g, " ").slice(0, 240);
    throw new Error(
      `The local SELECT did not return JSON. Output prefix: ${JSON.stringify(prefix)}`,
    );
  }
  const start = output.indexOf("[", match.index);
  return JSON.parse(output.slice(start)) as Record<string, unknown>[];
}

const fixture = loadPublicStarterFixture();
execute(["--file", "content/public-starters/accepted-sleep-history-v1.sql"]);
const first = query([buildPublicationReadSql(fixture)]);
const firstEdition = first.find((row) => row.public_starter_edition)
  ?.public_starter_edition;
const firstManifest = bindPublishedSubjectManifest(fixture, firstEdition);
execute(["--file", "content/public-starters/accepted-sleep-history-v1.sql"]);
const replay = query([buildPublicationReadSql(fixture)]);
const replayEdition = replay.find((row) => row.public_starter_edition)
  ?.public_starter_edition;
assert.deepEqual(bindPublishedSubjectManifest(fixture, replayEdition), firstManifest);
const counts = query(["SELECT count(*)::int AS editions, (SELECT count(*)::int FROM public.public_starter_edition_articles) AS articles FROM public.public_starter_editions"]);
assert.deepEqual(counts, [{ editions: 1, articles: 2 }]);
console.log("Disposable database: two reviewed articles published; replay preserved exact edition/article IDs and snapshots.");
