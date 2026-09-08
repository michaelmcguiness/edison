import { safeDemandAuthReturnPath } from "@/lib/demand-auth-continuation";
import { uuidSchema } from "@edison/contracts";

export const authReturnStorageKey = "edison:invited-reading-destination";
export const signInRetryStorageKey = "edison:signin-retry-at";
export const signInRetryDelayMs = 60_000;
const destinationLifetimeMs = 30 * 60_000;
type StorageAccess = Pick<Storage, "getItem" | "setItem" | "removeItem">;
type StorageGetter = () => StorageAccess;

export function rememberAuthReturn(path: string, storage: StorageGetter = () => sessionStorage, now = Date.now()) {
  const next = safeDemandAuthReturnPath(path);
  if (next === "/") return;
  try { storage().setItem(authReturnStorageKey, JSON.stringify({ path: next, createdAt: now })); } catch { /* The explicit URL context remains authoritative. */ }
}
export function readAuthReturn(storage: StorageGetter = () => sessionStorage, now = Date.now()) {
  try {
    const device = storage();
    const raw = device.getItem(authReturnStorageKey);
    if (!raw) return "/";
    let value: unknown = null;
    try { value = raw.length <= 1600 ? JSON.parse(raw) : null; } catch { /* Remove obsolete raw-string records below. */ }
    if (value && typeof value === "object" && "path" in value && "createdAt" in value && Object.keys(value).length === 2 &&
      typeof value.path === "string" && Number.isSafeInteger(value.createdAt)) {
      const age = now - Number(value.createdAt);
      const path = safeDemandAuthReturnPath(value.path);
      if (age >= 0 && age <= destinationLifetimeMs && path !== "/" && path === value.path) return path;
    }
    device.removeItem(authReturnStorageKey);
  } catch { /* Missing, old-format or denied storage is not a return destination. */ }
  return "/";
}
export function acceptanceDestination(explicit: string, saved: string) {
  const context = safeDemandAuthReturnPath(explicit);
  return context !== "/" ? context : safeDemandAuthReturnPath(saved);
}
export function clearAuthReturn(path: string, storage: StorageGetter = () => sessionStorage) {
  try { const device = storage(); if (readAuthReturn(() => device) === path) device.removeItem(authReturnStorageKey); } catch { /* Persistence is optional. */ }
}
export function readSignInRetryAt(storage: StorageGetter = () => sessionStorage, now = Date.now()) {
  try {
    const value = Number(storage().getItem(signInRetryStorageKey));
    return Number.isSafeInteger(value) && value > now && value <= now + signInRetryDelayMs ? value : 0;
  } catch { return 0; }
}
export function signInAttemptAllowed(pending: boolean, retryAt: number, now = Date.now()) { return !pending && now >= retryAt; }
export function signInCallbackUrl(returnPath: string, browserOrigin: string, authOrigin?: string, invitationId?: string) {
  if (authOrigin !== undefined && authOrigin !== "https://edisonreader.com") throw new Error("The sign-in destination is unavailable.");
  const callback = new URL("/auth/confirm", authOrigin ?? browserOrigin);
  callback.searchParams.set("next", safeDemandAuthReturnPath(returnPath));
  if (invitationId !== undefined) callback.searchParams.set("invitation", uuidSchema.parse(invitationId));
  return callback.href;
}

export type AcceptancePreview = { state: "available" | "expired" | "unavailable" | "unconfirmed" | "accepted" | "wrong_account"; maskedEmail?: string; expiresAt?: string };
export function acceptanceView(input: { hasContext: boolean; invitation: boolean; preview: AcceptancePreview["state"]; error?: string }) {
  const { hasContext, invitation, preview, error } = input;
  const kind = invitation ? "invitation" : "sign-in link";
  const wrongAccount = { title: "Use the email this invitation was sent to.", message: "Use another account to continue with this invitation.", action: null };
  const unavailable = { title: `This ${kind} is no longer available.`, message: invitation ? "Ask the person who invited you for a new invitation, or sign in if you’re already a member." : "Request a new sign-in link to continue.", action: null };
  if (!hasContext) return { title: "This link is no longer available.", message: "Open the latest link in your email, or sign in if you’re already a member.", action: null };
  if (preview === "accepted") return { title: "You’re ready to read", message: "Your invitation has been accepted.", action: "continue" as const };
  if (preview === "expired") return { title: `This ${kind} has expired.`, message: invitation ? "Ask the person who invited you to send a new invitation." : "Request a new sign-in link to continue.", action: null };
  // Fresh server state outranks an earlier Auth failure retained in the URL.
  if (preview === "wrong_account") return wrongAccount;
  if (preview === "unavailable") return unavailable;
  if (preview === "unconfirmed" && error === "expired") return { title: "We couldn’t check this invitation.", message: "Check status before requesting a new sign-in link. Your invitation has not been changed.", action: "refresh" as const };
  if (error === "expired") return { title: "This sign-in link has expired.", message: invitation ? "Get a new sign-in link to continue with this same invitation." : "Request a new sign-in link to continue.", action: null };
  if (error === "wrong_account") return wrongAccount;
  if (error === "invite_required") return { title: "An invitation is needed.", message: "Edison is invite-only. Open the invitation sent to this email, or ask a member to invite you.", action: null };
  if (error === "unavailable" || error === "interrupted") return unavailable;
  if (preview === "unconfirmed" || error === "unconfirmed") return { title: "We couldn’t confirm this yet.", message: "Check status to continue the same request.", action: "recover" as const };
  return invitation ? { title: "You’re invited", message: "Continue with the email address that received this invitation.", action: "accept" as const }
    : { title: "Sign in to Edison", message: "Continue to finish signing in securely.", action: "signin" as const };
}
export function invitationExpiryLabel(value: string, locale = "en-US", timeZone = "UTC") {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { year: "numeric", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short", timeZone }).format(date);
}
