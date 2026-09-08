import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { DEMAND_LOOP_PAGE_SIZE, demandLoopsSchema, type DemandLoopsQuery } from "@edison/contracts";
import { demandIdeas, demandLoops, demandRequests, withDemandDb, type DemandTransaction } from "@edison/db";
import { demandOwnerIds, demandWorkspaceId, type DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";
import { demandIdeaDto, demandIdeaSummarySelection, demandLoopDto, demandRequestDto, demandRequestSummarySelection, type DemandLoopRow } from "./demand-reading";

const cursorSchema=z.object({version:z.literal(1),workspaceId:z.string().uuid(),anchorId:z.string().uuid()}).strict();
export function decodeDemandLoopCursor(cursor:string,workspaceId:string) {
  try {
    const decoded=Buffer.from(cursor,"base64url");
    if(decoded.toString("base64url")!==cursor) throw new Error("encoding");
    const value=cursorSchema.parse(JSON.parse(decoded.toString("utf8")));
    if(value.workspaceId!==workspaceId) throw new Error("owner");
    return value;
  } catch {throw new HttpError(400,"invalid_loop_cursor","That loop page is not valid for this reading account.");}
}
export function encodeDemandLoopCursor(workspaceId:string,anchorId:string) {
  return Buffer.from(JSON.stringify(cursorSchema.parse({version:1,workspaceId,anchorId}))).toString("base64url");
}

async function loopPayload(tx:DemandTransaction,principal:DemandPrincipal,loops:DemandLoopRow[],nextCursor:string|null) {
  const loopIds=loops.map(loop=>loop.id);
  const batches=loopIds.length?await tx.execute<{loop_id:string;id:string}>(sql`
    select distinct on (r.loop_id) r.loop_id,r.id from private.demand_requests r
    where r.loop_id in (${sql.join(loopIds.map(id=>sql`${id}::uuid`),sql`,`)}) and r.kind='ideas' and r.status='succeeded'
      and exists(select 1 from private.demand_ideas i where i.batch_request_id=r.id)
    order by r.loop_id,r.created_at desc,r.id desc`):[];
  const batchIds=batches.map(batch=>batch.id);
  const ideas=batchIds.length?await tx.select(demandIdeaSummarySelection).from(demandIdeas)
    .where(inArray(demandIdeas.batchRequestId,batchIds)).orderBy(asc(demandIdeas.rank)):[];
  const latest=loopIds.length?await tx.execute<{id:string}>(sql`select distinct on(loop_id) id from private.demand_requests
    where loop_id in (${sql.join(loopIds.map(id=>sql`${id}::uuid`),sql`,`)}) and kind='ideas' order by loop_id,created_at desc,id desc`):[];
  const requestIds=[...new Set([...batchIds,...latest.map(row=>row.id),...ideas.flatMap(idea=>idea.articleRequestId?[idea.articleRequestId]:[])])];
  const requests=requestIds.length?await tx.select(demandRequestSummarySelection).from(demandRequests).where(inArray(demandRequests.id,requestIds)).orderBy(desc(demandRequests.createdAt)):[];
  return demandLoopsSchema.parse({workspaceId:demandWorkspaceId(principal),
    loops:loops.map(loop=>demandLoopDto(loop,batches.find(batch=>batch.loop_id===loop.id)?.id??null)),
    ideas:ideas.map(demandIdeaDto),requests:requests.map(demandRequestDto),nextCursor});
}
/** Stable DB tuple pagination preserves PostgreSQL timestamp precision. */
export async function demandLoopPage(principal:DemandPrincipal,input:DemandLoopsQuery) {
  return withDemandDb(principal.id,async(tx)=>{
    const cursor=input.cursor?decodeDemandLoopCursor(input.cursor,demandWorkspaceId(principal)):null;
    if(cursor) {
      const [anchor]=await tx.select({id:demandLoops.id}).from(demandLoops).where(and(eq(demandLoops.id,cursor.anchorId),inArray(demandLoops.principalId,demandOwnerIds(principal))));
      if(!anchor) throw new HttpError(400,"invalid_loop_cursor","That loop page is no longer available.");
    }
    const rows=await tx.select().from(demandLoops).where(and(inArray(demandLoops.principalId,demandOwnerIds(principal)),isNull(demandLoops.archivedAt),
      cursor?sql`(${demandLoops.createdAt},${demandLoops.id})>(select created_at,id from private.demand_loops where id=${cursor.anchorId}::uuid)`:undefined))
      .orderBy(asc(demandLoops.createdAt),asc(demandLoops.id)).limit(DEMAND_LOOP_PAGE_SIZE+1);
    const loops=rows.slice(0,DEMAND_LOOP_PAGE_SIZE);
    return loopPayload(tx,principal,loops,rows.length>DEMAND_LOOP_PAGE_SIZE?encodeDemandLoopCursor(demandWorkspaceId(principal),loops.at(-1)!.id):null);
  });
}
export async function demandLoopResult(principal:DemandPrincipal,loopId:string) {
  return withDemandDb(principal.id,async(tx)=>{
    const [loop]=await tx.select().from(demandLoops).where(and(eq(demandLoops.id,loopId),inArray(demandLoops.principalId,demandOwnerIds(principal))));
    if(!loop) throw new HttpError(404,"loop_not_found","That loop was not found.");
    return loopPayload(tx,principal,[loop],null);
  });
}
