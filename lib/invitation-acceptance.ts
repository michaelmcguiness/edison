import { z } from "zod";
import { uuidSchema } from "@edison/contracts";
import { safeDemandAuthReturnPath } from "./demand-auth-continuation";

export const invitationAcceptanceSchema = z.object({
  // Supabase Auth prefixes browser PKCE magic-link hashes with "pkce_".
  // Preserve the exact provider value; accepting its shape never verifies it.
  nonce: uuidSchema, tokenHash: z.string().regex(/^(?:pkce_)?[a-f0-9]{64}$/i),
  type: z.enum(["invite", "email"]), invitationId: uuidSchema.nullable(),
  returnPath: z.string().max(600), createdAt: z.number().int().nonnegative(),
}).strict();
export type InvitationAcceptance = z.infer<typeof invitationAcceptanceSchema>;
export const invitationAcceptanceCookie = (production: boolean) => production ? "__Host-edison_acceptance" : "edison_acceptance_dev";
export function decodeInvitationAcceptance(raw: string | undefined, now = Date.now()): InvitationAcceptance | null {
  if (!raw || raw.length > 4096) return null;
  try {
    const parsed = invitationAcceptanceSchema.parse(JSON.parse(Buffer.from(raw, "base64url").toString("utf8")));
    const age = now - parsed.createdAt;
    return age >= 0 && age <= 60 * 60 * 1000 ? { ...parsed, returnPath: safeDemandAuthReturnPath(parsed.returnPath) } : null;
  } catch { return null; }
}
