import assert from "node:assert/strict";
import test from "node:test";

import { HttpError } from "../http/errors";
import { assertDemandVerifiedUser, enforceAlphaEmailAllowlist } from "./verify-access-token";

test("demand signup requires confirmed provider user identity; user metadata cannot self-confirm",()=>{
  const claims={sub:"11111111-1111-4111-8111-111111111111",email:"reader@example.com"};
  const user={id:claims.sub,email:claims.email,is_anonymous:false,email_confirmed_at:"2026-09-07T00:00:00Z"};
  assert.doesNotThrow(()=>assertDemandVerifiedUser(claims,user));
  for(const changed of [null,{}, {...user,id:"another-user"},{...user,email:"someone@example.com"},{...user,is_anonymous:true},
    {...user,email_confirmed_at:null,user_metadata:{email_verified:true,email_confirmed_at:"2026-09-07T00:00:00Z"}},
    {...user,email_confirmed_at:"not-a-date"},{...user,is_anonymous:undefined}]) assert.throws(()=>assertDemandVerifiedUser(claims,changed),
      (e:unknown)=>e instanceof HttpError&&e.code==="verified_account_required");
});

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
