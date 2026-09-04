import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
} from "jose";
import { HttpError } from "../http/errors";

export type EdisonClaims = JWTPayload & {
  sub: string;
  role: "authenticated";
  email?: string;
  is_anonymous?: boolean;
};

let cachedIssuer: string | undefined;
let cachedJwks: ReturnType<typeof createRemoteJWKSet> | undefined;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function authConfiguration() {
  const rawUrl = process.env.SUPABASE_URL;
  if (!rawUrl) {
    throw new HttpError(
      503,
      "auth_not_configured",
      "Supabase authentication is not configured.",
    );
  }

  const issuer = `${rawUrl.replace(/\/$/, "")}/auth/v1`;
  if (!cachedJwks || cachedIssuer !== issuer) {
    cachedIssuer = issuer;
    cachedJwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }

  return {
    issuer,
    audience: process.env.SUPABASE_JWT_AUDIENCE ?? "authenticated",
    jwks: cachedJwks,
  };
}

function developmentClaims(): EdisonClaims | null {
  if (process.env.NODE_ENV === "production") return null;
  const sub = process.env.EDISON_DEV_USER_ID;
  const email = process.env.EDISON_DEV_USER_EMAIL;
  if (!sub || !email) return null;

  return {
    sub,
    email,
    role: "authenticated",
    aud: "authenticated",
    exp: Math.floor(Date.now() / 1000) + 3600,
  };
}

export function enforceAlphaEmailAllowlist(
  claims: Pick<EdisonClaims, "email">,
  environment: Readonly<Record<string, string | undefined>> = process.env,
) {
  const configured = environment.EDISON_ALLOWED_EMAILS?.trim() ?? "";
  if (!configured && environment.NODE_ENV !== "production") return;

  const entries = configured
    .split(",")
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
  if (
    !entries.length ||
    entries.some((email) => !EMAIL_PATTERN.test(email)) ||
    new Set(entries).size !== entries.length
  ) {
    throw new HttpError(
      503,
      "alpha_allowlist_not_configured",
      "Private-alpha access is unavailable because its allowlist is invalid.",
    );
  }
  const allowed = new Set(entries);

  if (!claims.email || !allowed.has(claims.email.toLowerCase())) {
    throw new HttpError(
      403,
      "alpha_access_required",
      "This account is not part of the Edison private alpha.",
    );
  }
}

export async function verifyAccessToken(
  authorization: string | null,
): Promise<EdisonClaims> {
  if (!authorization?.startsWith("Bearer ")) {
    const claims = developmentClaims();
    if (claims) return claims;
    throw new HttpError(401, "missing_token", "A bearer token is required.");
  }

  const token = authorization.slice("Bearer ".length).trim();
  if (!token) {
    throw new HttpError(401, "missing_token", "A bearer token is required.");
  }

  try {
    const { issuer, audience, jwks } = authConfiguration();
    const { payload } = await jwtVerify(token, jwks, { issuer, audience });

    if (
      typeof payload.sub !== "string" ||
      payload.role !== "authenticated" ||
      payload.is_anonymous === true
    ) {
      throw new Error("invalid_claims");
    }

    const claims = payload as EdisonClaims;
    enforceAlphaEmailAllowlist(claims);
    return claims;
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(401, "invalid_token", "The access token is not valid.");
  }
}
