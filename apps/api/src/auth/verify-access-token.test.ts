import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../http/errors";
import { enforceAlphaEmailAllowlist } from "./verify-access-token";

test("production authentication fails closed without a private-alpha allowlist", () => {
  assert.throws(
    () =>
      enforceAlphaEmailAllowlist(
        { email: "reader@example.com" },
        { NODE_ENV: "production" },
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 503 &&
      error.code === "alpha_allowlist_not_configured",
  );
});

test("a malformed configured allowlist fails closed", () => {
  assert.throws(
    () =>
      enforceAlphaEmailAllowlist(
        { email: "reader@example.com" },
        {
          NODE_ENV: "production",
          EDISON_ALLOWED_EMAILS: "not-an-email",
        },
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.code === "alpha_allowlist_not_configured",
  );
});

test("the private-alpha allowlist is exact and case insensitive", () => {
  const environment = {
    NODE_ENV: "production",
    EDISON_ALLOWED_EMAILS: "Reader@Example.com",
  };

  assert.doesNotThrow(() =>
    enforceAlphaEmailAllowlist({ email: "reader@example.com" }, environment),
  );
  assert.throws(
    () =>
      enforceAlphaEmailAllowlist(
        { email: "someone-else@example.com" },
        environment,
      ),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 403 &&
      error.code === "alpha_access_required",
  );
});

test("local development can omit the production allowlist", () => {
  assert.doesNotThrow(() =>
    enforceAlphaEmailAllowlist(
      { email: "developer@example.com" },
      { NODE_ENV: "development" },
    ),
  );
});
