export type AllowanceResetAttempt = { idempotencyKey: string; expectedRevision: number; fingerprint: string; periodStart: string };
export function validResetAttempt(value: unknown): value is AllowanceResetAttempt {
  if (!value || typeof value !== "object") return false;
  if (Object.keys(value).some((key) => !["idempotencyKey", "expectedRevision", "fingerprint", "periodStart"].includes(key))) return false;
  const item = value as Partial<AllowanceResetAttempt>;
  return typeof item.idempotencyKey === "string" && /^allowance:[0-9a-f-]{36}$/.test(item.idempotencyKey) &&
    Number.isSafeInteger(item.expectedRevision) && Number(item.expectedRevision) >= 0 && typeof item.fingerprint === "string" && /^[0-9a-f]{64}$/.test(item.fingerprint) &&
    typeof item.periodStart === "string" && Number.isFinite(Date.parse(item.periodStart));
}
export function definitiveResetRejection(failure: unknown) {
  return Boolean(failure && typeof failure === "object" && "status" in failure && typeof failure.status === "number" && failure.status >= 400 && failure.status < 500 && failure.status !== 408);
}
export function clearMatchingResetAttempt(storage: Pick<Storage, "getItem" | "removeItem"> | (() => Pick<Storage, "getItem" | "removeItem">), key: string, id: string) {
  try {
    const device = typeof storage === "function" ? storage() : storage;
    const value: unknown = JSON.parse(device.getItem(key) ?? "null");
    if (validResetAttempt(value) && value.idempotencyKey === id) device.removeItem(key);
  } catch { /* Optional device recovery, including denial of the storage getter. */ }
}
export async function resetPasswordFingerprint(password: string) {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(password));
  return Array.from(new Uint8Array(bytes), (value) => value.toString(16).padStart(2, "0")).join("");
}
