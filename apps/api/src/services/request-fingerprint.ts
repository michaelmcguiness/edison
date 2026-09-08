import { createHash } from "node:crypto";

export function fingerprintRequest(parts: readonly unknown[]) {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex");
}
