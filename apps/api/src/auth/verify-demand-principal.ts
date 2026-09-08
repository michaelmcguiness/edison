import { createHash } from "node:crypto";
import { count, eq, gte, sql } from "drizzle-orm";
import { demandIdeas, demandLoops, demandPrincipals, demandRequests, withDemandWorkerDb, type DemandTransaction } from "@edison/db";
import { verifyAccessToken } from "./verify-access-token";
import { withActiveMember } from "../services/members";
import { HttpError } from "../http/errors";
import { demandLimits, requireDemandEnabled } from "../services/demand-configuration";
import { carryDemandAllowance, currentDemandGrant } from "../services/demand-allowance";

export type DemandPrincipal = typeof demandPrincipals.$inferSelect & {
  /** Canonical account workspace; id remains the immutable resource owner. */
  workspaceId?: string;
  ownerPrincipalIds?: string[];
};
export const DEMAND_TOKEN_HEADER = "x-edison-demand-token";
export const demandWorkspaceId = (principal: DemandPrincipal) => principal.workspaceId ?? principal.id;
export const demandOwnerIds = (principal: DemandPrincipal) => principal.ownerPrincipalIds ?? [principal.id];
export function hashDemandToken(token: string) {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new HttpError(401,"guest_session_invalid","This browser's reading session is not valid.");
  return createHash("sha256").update(token).digest("hex");
}
export function assertDemandPrincipalActive(principal: Pick<DemandPrincipal,"revokedAt"|"expiresAt">, now = new Date()) {
  if (principal.revokedAt || (principal.expiresAt && principal.expiresAt <= now)) throw new HttpError(401,"reading_session_expired","This reading session is no longer available.");
}
async function ownedPrincipal(tx: DemandTransaction, principal: typeof demandPrincipals.$inferSelect): Promise<DemandPrincipal> {
  assertDemandPrincipalActive(principal);
  const rows = await tx.execute<{id:string}>(sql`select p.id from private.demand_principals p
    where private.demand_reader_id(p.id)=${principal.id}::uuid and private.demand_principal_is_active(p.id)`);
  if(!rows.some(row=>row.id===principal.id)) throw new HttpError(401,"reading_session_expired","This reading session is no longer available.");
  return {...principal,workspaceId:principal.id,ownerPrincipalIds:rows.map((row)=>row.id)};
}

/** Caller holds global admission lock. Claim preserves every history, provider
 * stage and spend identity, including still-pending guest requests. */
export async function claimDemandGuest(tx: DemandTransaction, accountUserId:string, tokenHash:string) {
  const [claimed] = await tx.execute<{account_principal_id:string}>(sql`select account_principal_id from private.demand_principal_claims where guest_token_hash=${tokenHash}`);
  const [account] = await tx.select().from(demandPrincipals).where(eq(demandPrincipals.accountUserId,accountUserId)).for("update").limit(1);
  if (claimed) {
    if (!account || account.id!==claimed.account_principal_id) throw new HttpError(409,"guest_already_claimed","This browser's reading was already attached to another account.");
    return ownedPrincipal(tx,account);
  }
  const [guest] = await tx.select().from(demandPrincipals).where(eq(demandPrincipals.guestTokenHash,tokenHash)).for("update").limit(1);
  if (!guest) throw new HttpError(401,"guest_session_invalid","This browser's reading session is not valid.");
  assertDemandPrincipalActive(guest);
  if (account) {
    assertDemandPrincipalActive(account);
    await carryDemandAllowance(tx,guest.id,account.id);
    await tx.execute(sql`insert into private.demand_principal_claims(principal_id,account_principal_id,guest_token_hash)
      values(${guest.id}::uuid,${account.id}::uuid,${tokenHash})`);
    return ownedPrincipal(tx,account);
  }
  await currentDemandGrant(tx,guest.id);
  const [converted] = await tx.update(demandPrincipals).set({accountUserId,guestTokenHash:null,expiresAt:null}).where(eq(demandPrincipals.id,guest.id)).returning();
  await tx.execute(sql`insert into private.demand_principal_claims(principal_id,account_principal_id,guest_token_hash)
    values(${guest.id}::uuid,${guest.id}::uuid,${tokenHash})`);
  return ownedPrincipal(tx,converted);
}

/** Never accepts caller-supplied principal IDs or downgrades rejected accounts. */
export async function resolveDemandPrincipal(request:Request,create=false):Promise<{principal:DemandPrincipal;newGuestToken?:string;guestClaimed?:boolean}> {
  requireDemandEnabled();
  const authorization=request.headers.get("authorization");
  if(!authorization) throw new HttpError(401,"invitation_required","Sign in with an invited account to use Edison.");
  const claims=await verifyAccessToken(authorization,{demand:true});
  await withActiveMember(claims,async()=>undefined);
  const accountUserId=claims.sub;
  const token=request.headers.get(DEMAND_TOKEN_HEADER);
  const tokenHash=token?hashDemandToken(token):null;
  return withDemandWorkerDb(async(tx)=>{
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended('edison-demand-admission',0))`);
    if (tokenHash) {
      if (!create) throw new HttpError(409,"reading_claim_required","Finish attaching this browser's reading to your account first.");
      return {principal:await claimDemandGuest(tx,accountUserId,tokenHash),guestClaimed:true};
    }
    const [existing]=await tx.select().from(demandPrincipals).where(eq(demandPrincipals.accountUserId,accountUserId)).limit(1);
    if (existing) return {principal:await ownedPrincipal(tx,existing)};
    if (!create) throw new HttpError(401,"reading_session_required","Start a reading session to continue.");
    const [{recent}]=await tx.select({recent:count()}).from(demandPrincipals).where(gte(demandPrincipals.createdAt,new Date(Date.now()-86_400_000)));
    if (recent>=demandLimits().dailySessions) throw new HttpError(429,"reading_session_limit","New reading sessions are at capacity. Please try later.");
    const [principal]=await tx.insert(demandPrincipals).values({accountUserId,guestTokenHash:null,expiresAt:null}).returning();
    if (!principal) throw new Error("demand_principal_not_created");
    return {principal:await ownedPrincipal(tx,principal)};
  });
}

/** Resolve a route resource to its immutable original owner only after checking
 * the verified reader group. Existing mutation predicates remain exact. */
export async function resolveDemandResourcePrincipal(principal:DemandPrincipal,resource:{loopId?:string;ideaId?:string;articleId?:string;requestId?:string}) {
  const entries=Object.entries(resource).filter(([,value])=>value!==undefined);
  if (entries.length!==1) throw new Error("demand_resource_identity_invalid");
  const [kind,id]=entries[0];
  return withDemandWorkerDb(async(tx)=>{
    const table=kind==="loopId"?demandLoops:kind==="ideaId"?demandIdeas:demandRequests;
    const [row]=await tx.select({principalId:table.principalId}).from(table).where(eq(table.id,id!)).limit(1);
    if (!row || !demandOwnerIds(principal).includes(row.principalId)) throw new HttpError(404,"reading_not_found","That reading was not found.");
    const [owner]=await tx.select().from(demandPrincipals).where(eq(demandPrincipals.id,row.principalId)).limit(1);
    const [active]=await tx.execute<{active:boolean}>(sql`select private.demand_principal_is_active(${row.principalId}::uuid) as active`);
    if (!owner||!active?.active) throw new HttpError(401,"reading_session_expired","This reading session is no longer available.");
    return {...owner,accountUserId:principal.accountUserId,expiresAt:principal.expiresAt,
      workspaceId:demandWorkspaceId(principal),ownerPrincipalIds:demandOwnerIds(principal)};
  });
}
