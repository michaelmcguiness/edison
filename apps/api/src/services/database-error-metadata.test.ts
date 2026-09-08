import assert from "node:assert/strict";
import test from "node:test";
import { DrizzleQueryError } from "drizzle-orm/errors";

import { safeDatabaseErrorMetadata } from "../observability/safe-database-error";

function codedError(code: string, message = "safe test error") {
  return Object.assign(new Error(message), { code });
}

test("classifies a Drizzle-wrapped Postgres authentication failure", () => {
  const postgresError = codedError(
    "28P01",
    "password authentication failed for secret-user",
  );
  const wrapped = new DrizzleQueryError(
    "select * from private.secret_table",
    ["secret-parameter"],
    postgresError,
  );

  assert.deepEqual(safeDatabaseErrorMetadata(wrapped), {
    databaseErrorCategory: "authentication",
    databaseErrorCode: "28P01",
  });
  const serialized = JSON.stringify(safeDatabaseErrorMetadata(wrapped));
  assert.doesNotMatch(
    serialized,
    /secret-user|secret_table|secret-parameter|password authentication/i,
  );
});

test("classifies fixed network and TLS codes", () => {
  assert.deepEqual(safeDatabaseErrorMetadata(codedError("ENOTFOUND")), {
    databaseErrorCategory: "network",
    databaseErrorCode: "ENOTFOUND",
  });
  assert.deepEqual(
    safeDatabaseErrorMetadata(codedError("ERR_TLS_CERT_ALTNAME_INVALID")),
    {
      databaseErrorCategory: "tls",
      databaseErrorCode: "ERR_TLS_CERT_ALTNAME_INVALID",
    },
  );
});

test("distinguishes permission and missing-schema failures", () => {
  assert.deepEqual(safeDatabaseErrorMetadata(codedError("42501")), {
    databaseErrorCategory: "permission",
    databaseErrorCode: "42501",
  });
  assert.deepEqual(safeDatabaseErrorMetadata(codedError("3F000")), {
    databaseErrorCategory: "schema",
    databaseErrorCode: "3F000",
  });
  assert.deepEqual(safeDatabaseErrorMetadata(codedError("42P01")), {
    databaseErrorCategory: "schema",
    databaseErrorCode: "42P01",
  });
});

test("omits unknown and secret-bearing arbitrary codes", () => {
  const result = safeDatabaseErrorMetadata(
    codedError("DATABASE_PASSWORD_secret-value", "host=secret.example"),
  );

  assert.deepEqual(result, {});
  assert.equal(JSON.stringify(result), "{}");
});

test("reports only fixed codes for query and server-internal failures", () => {
  for (const [code, category] of [["42601", "query"], ["XX000", "internal"]]) {
    assert.deepEqual(
      safeDatabaseErrorMetadata(codedError(code, "secret server details")),
      { databaseErrorCategory: category, databaseErrorCode: code },
    );
  }
});

test("cause traversal is cycle-safe, depth-bounded, and accessor-safe", () => {
  const cycle: { cause?: unknown } = {};
  cycle.cause = cycle;
  assert.deepEqual(safeDatabaseErrorMetadata(cycle), {});

  const allowedDepth = {
    cause: { cause: { cause: { cause: codedError("ECONNREFUSED") } } },
  };
  assert.deepEqual(safeDatabaseErrorMetadata(allowedDepth), {
    databaseErrorCategory: "network",
    databaseErrorCode: "ECONNREFUSED",
  });
  const beyondMaximumDepth = { cause: allowedDepth };
  assert.deepEqual(safeDatabaseErrorMetadata(beyondMaximumDepth), {});

  let getterReads = 0;
  const accessorError = {};
  Object.defineProperties(accessorError, {
    code: {
      get() {
        getterReads += 1;
        throw new Error("secret getter must not run");
      },
    },
    cause: {
      get() {
        getterReads += 1;
        return codedError("28P01");
      },
    },
  });
  assert.deepEqual(safeDatabaseErrorMetadata(accessorError), {});
  assert.equal(getterReads, 0);
});
