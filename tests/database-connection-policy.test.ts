import assert from "node:assert/strict";
import test from "node:test";

import {
  DatabaseConnectionPolicyError,
  resolveDatabaseConnectionPolicy,
} from "../packages/db/src/database-connection-policy.mjs";

const BASE_URL =
  "postgresql://postgres.project:db-password-SENTINEL@pooler.invalid:6543/postgres";

function setEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function effectiveSsl(url: string) {
  return resolveDatabaseConnectionPolicy(url, { production: true }).ssl;
}

test("production defaults a URL without TLS parameters to explicit ssl=require", () => {
  const policy = resolveDatabaseConnectionPolicy(BASE_URL, {
    production: true,
  });
  assert.equal(policy.ssl, "require");
  assert.equal(policy.tlsDefaulted, true);
  assert.equal(effectiveSsl(BASE_URL), "require");
});

test("production retains or strengthens explicit certificate-verifying modes", () => {
  assert.equal(effectiveSsl(`${BASE_URL}?sslmode=verify-full`), "verify-full");
  assert.equal(effectiveSsl(`${BASE_URL}?sslmode=verify-ca`), "verify-full");
  assert.equal(effectiveSsl(`${BASE_URL}?ssl=true`), "verify-full");
  assert.equal(effectiveSsl(`${BASE_URL}?sslmode=require`), "require");
});

test("production rejects explicit insecure or unsupported TLS values", () => {
  for (const query of [
    "sslmode=disable",
    "sslmode=allow",
    "sslmode=prefer",
    "ssl=false",
    "ssl=0",
    "sslmode=REQUIRE",
  ]) {
    assert.throws(
      () =>
        resolveDatabaseConnectionPolicy(`${BASE_URL}?${query}`, {
          production: true,
        }),
      (error: unknown) =>
        error instanceof DatabaseConnectionPolicyError &&
        error.code === "insecure_tls",
    );
  }
});

test("production rejects duplicate, conflicting, and ambiguous TLS controls", () => {
  for (const query of [
    "sslmode=require&sslmode=disable",
    "ssl=true&ssl=false",
    "ssl=true&sslmode=disable",
    "SSLMode=require",
    "sslmode=verify-full&sslrootcert=system",
  ]) {
    assert.throws(
      () =>
        resolveDatabaseConnectionPolicy(`${BASE_URL}?${query}`, {
          production: true,
        }),
      (error: unknown) =>
        error instanceof DatabaseConnectionPolicyError &&
        error.code === "ambiguous_tls",
    );
  }
});

test("policy failures never include malformed URL credentials", () => {
  const secret = "db-password-SENTINEL";
  assert.throws(
    () =>
      resolveDatabaseConnectionPolicy(
        `postgresql://postgres:${secret}@[invalid-host/postgres`,
        { production: true },
      ),
    (error: unknown) => {
      assert.ok(error instanceof DatabaseConnectionPolicyError);
      assert.equal(error.code, "invalid_url");
      assert.doesNotMatch(error.message, new RegExp(secret));
      return true;
    },
  );
});

test("non-production preserves local Postgres.js TLS behavior", async () => {
  const localUrl = "postgresql://postgres:postgres@127.0.0.1:54322/postgres?sslmode=disable";
  const policy = resolveDatabaseConnectionPolicy(localUrl, {
    production: false,
  });
  assert.equal(policy.ssl, undefined);
  assert.equal(policy.tlsDefaulted, false);

  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
  };
  setEnvironment("DATABASE_URL", localUrl);
  setEnvironment("NODE_ENV", "development");
  try {
    const { getDb } = await import(
      `../packages/db/src/client.ts?local-tls-policy=${crypto.randomUUID()}`
    );
    const database = getDb();
    assert.equal(database.$client.options.ssl, false);
    await database.$client.end();
  } finally {
    setEnvironment("DATABASE_URL", previous.databaseUrl);
    setEnvironment("NODE_ENV", previous.nodeEnv);
  }
});

test("getDb passes explicit production TLS after URL and hostile PGSSL precedence", async () => {
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    nodeEnv: process.env.NODE_ENV,
    pgSsl: process.env.PGSSL,
  };
  setEnvironment("DATABASE_URL", BASE_URL);
  setEnvironment("NODE_ENV", "production");
  setEnvironment("PGSSL", "disable");
  try {
    for (const [url, expectedSsl] of [
      [BASE_URL, "require"],
      [`${BASE_URL}?sslmode=require`, "require"],
      [`${BASE_URL}?sslmode=verify-full`, "verify-full"],
    ] as const) {
      setEnvironment("DATABASE_URL", url);
      const { getDb } = await import(
        `../packages/db/src/client.ts?tls-policy=${crypto.randomUUID()}`
      );
      const database = getDb();
      assert.equal(database.$client.options.ssl, expectedSsl);
      assert.equal(database.$client.options.prepare, false);
      assert.equal(database.$client.options.max, 1);
      await database.$client.end();
    }
  } finally {
    setEnvironment("DATABASE_URL", previous.databaseUrl);
    setEnvironment("NODE_ENV", previous.nodeEnv);
    setEnvironment("PGSSL", previous.pgSsl);
  }
});
