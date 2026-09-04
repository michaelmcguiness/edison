import assert from "node:assert/strict";
import test from "node:test";
import { presentExplicitInterests } from "../apps/api/src/presenters/interest";

test("profile interest presentation exposes only retained explicit choices", () => {
  assert.deepEqual(
    presentExplicitInterests([
      {
        id: "00000000-0000-4000-8000-000000000001",
        kind: "explicit",
        status: "muted",
        topic: "Startups",
      },
      {
        id: "00000000-0000-4000-8000-000000000002",
        kind: "inferred",
        status: "active",
        topic: "Private learned signal",
      },
      {
        id: "00000000-0000-4000-8000-000000000003",
        kind: "explicit",
        status: "deleted",
        topic: "Deleted preference",
      },
      {
        id: "00000000-0000-4000-8000-000000000004",
        kind: "explicit",
        status: "active",
        topic: "Architecture",
      },
    ]),
    [
      {
        id: "00000000-0000-4000-8000-000000000004",
        status: "active",
        topic: "Architecture",
      },
      {
        id: "00000000-0000-4000-8000-000000000001",
        status: "muted",
        topic: "Startups",
      },
    ],
  );
});
