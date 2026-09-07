import { createHash, randomBytes } from "node:crypto";
import { sql } from "drizzle-orm";
import { demandArticleSchema, uuidSchema } from "@edison/contracts";
import {
  createDemandArticleShareSchema, demandArticleShareReceiptSchema, demandSharedArticleSchema,
  demandShareTokenSchema, publicDemandArticleShareSchema,
  type CreateDemandArticleShare, type DemandArticleShareReceipt,
} from "../../../../packages/contracts/src/demand-sharing";
import { withDemandWorkerDb, withPublicDb } from "@edison/db";
import type { DemandPrincipal } from "../auth/verify-demand-principal";
import { HttpError } from "../http/errors";

export const DEMAND_SHARES_PER_DAY = 20;
export const DEMAND_SHARE_OPERATIONS_PER_DAY = 200;

function notFound(): never {
  throw new HttpError(404, "article_not_found", "That completed article was not found.");
}
function shareUnavailable(): never {
  throw new HttpError(404, "share_not_found", "That public article is no longer available.");
}
function iso(value: Date | string) { return new Date(value).toISOString(); }

/** Whitelist the displayed version, never spread a private result or context. */
export function demandShareSnapshot(value: unknown, articleId: string, publishedAt: Date | string) {
  const article = demandArticleSchema.parse(value);
  if (article.id !== articleId) notFound();
  return demandSharedArticleSchema.parse({
    version: 1, title: article.title, deck: article.deck,
    body: article.body, sources: article.sources, sourceCount: article.sourceCount,
    basis: article.basis, researchedAt: article.researchedAt,
    readingMinutes: article.readingMinutes, publishedAt: iso(publishedAt),
    correction: article.correction ?? null,
  });
}

type SavedShare = { id: string; articleRequestId: string; token: string; createdAt: Date | string; revokedAt: Date | string | null };
function receipt(share: SavedShare, created: boolean): DemandArticleShareReceipt {
  if (share.revokedAt !== null) shareUnavailable();
  return demandArticleShareReceiptSchema.parse({ token: share.token, createdAt: iso(share.createdAt), created });
}

/** Only resolved guest/account identity is accepted; never a browser principal ID.
 * Lock principal then article, matching the existing generation lock order.
 * No model, workflow, generation reservation or reading event is created. */
export async function createDemandArticleShare(
  principal: DemandPrincipal,
  articleId: string,
  rawInput: CreateDemandArticleShare,
  dependencies: { transaction?: typeof withDemandWorkerDb; token?: () => string } = {},
): Promise<DemandArticleShareReceipt> {
  uuidSchema.parse(principal.id); uuidSchema.parse(articleId);
  const input = createDemandArticleShareSchema.parse(rawInput);
  return (dependencies.transaction ?? withDemandWorkerDb)(async (tx) => {
    const [owner] = await tx.execute<{ id: string }>(sql`
      select id from private.demand_principals where id = ${principal.id}::uuid for update
    `);
    const [access] = await tx.execute<{ active: boolean }>(sql`
      select private.demand_principal_is_active(${principal.id}::uuid) as active
    `);
    if (!owner || access?.active !== true) {
      throw new HttpError(401, "reading_session_expired", "This reading session is no longer available.");
    }
    // Every operation key is recorded, including a new key reusing a share.
    // Lost responses can recover the same committed identity without publishing again.
    const [operation] = await tx.execute<SavedShare>(sql`
      select s.id, s.article_request_id as "articleRequestId", s.token,
        s.created_at as "createdAt", s.revoked_at as "revokedAt"
      from private.demand_share_operations o join private.demand_public_shares s
        on (s.principal_id, s.article_request_id, s.id) = (o.principal_id, o.article_request_id, o.share_id)
      where o.principal_id = ${principal.id}::uuid and o.idempotency_key = ${input.idempotencyKey}
    `);
    if (operation) {
      if (operation.articleRequestId !== articleId) {
        throw new HttpError(409, "idempotency_key_reused", "That sharing operation belongs to a different article.");
      }
      return receipt(operation, false);
    }
    const [request] = await tx.execute<{ id: string; kind: string; status: string;
      result: Record<string, unknown> | null; updatedAt: Date | string }>(sql`
      select id, kind, status, result, updated_at as "updatedAt" from private.demand_requests
      where id = ${articleId}::uuid and principal_id = ${principal.id}::uuid for update
    `);
    if (!request || request.kind !== "article" || request.status !== "succeeded" || !request.result?.article) notFound();
    const [counts] = await tx.execute<{ shares: number; operations: number }>(sql`
      select (select count(*)::integer from private.demand_public_shares
        where principal_id = ${principal.id}::uuid and created_at >= statement_timestamp() - interval '24 hours') as shares,
      (select count(*)::integer from private.demand_share_operations
        where principal_id = ${principal.id}::uuid and created_at >= statement_timestamp() - interval '24 hours') as operations
    `);
    if (!counts || counts.operations >= DEMAND_SHARE_OPERATIONS_PER_DAY) {
      throw new HttpError(429, "sharing_rate_limit", "Sharing is temporarily at capacity. Existing public links still work.");
    }
    let [share] = await tx.execute<SavedShare>(sql`
      select id, article_request_id as "articleRequestId", token,
        created_at as "createdAt", revoked_at as "revokedAt" from private.demand_public_shares
      where principal_id = ${principal.id}::uuid and article_request_id = ${articleId}::uuid
    `);
    const created = !share;
    if (share?.revokedAt) shareUnavailable();
    if (!share) {
      if (counts.shares >= DEMAND_SHARES_PER_DAY) {
        throw new HttpError(429, "sharing_rate_limit", "Sharing is temporarily at capacity. Existing public links still work.");
      }
      const snapshot = demandShareSnapshot(request.result.article, articleId, request.updatedAt);
      const serialized = JSON.stringify(snapshot);
      const token = demandShareTokenSchema.parse((dependencies.token ?? (() => randomBytes(32).toString("hex")))());
      const fingerprint = createHash("sha256").update(serialized).digest("hex");
      [share] = await tx.execute<SavedShare>(sql`
        insert into private.demand_public_shares(principal_id, article_request_id, token, snapshot, snapshot_fingerprint)
        values (${principal.id}::uuid, ${articleId}::uuid, ${token}, ${serialized}::jsonb, ${fingerprint})
        returning id, article_request_id as "articleRequestId", token, created_at as "createdAt", revoked_at as "revokedAt"
      `);
    }
    if (!share) throw new Error("share_not_created");
    await tx.execute(sql`
      insert into private.demand_share_operations(principal_id, article_request_id, share_id, idempotency_key)
      values (${principal.id}::uuid, ${articleId}::uuid, ${share.id}::uuid, ${input.idempotencyKey})
    `);
    return receipt(share, created);
  });
}

/** Anonymous access uses only the narrow function, never the private tables. */
export async function getDemandArticleShare(token: string, dependencies: { transaction?: typeof withPublicDb } = {}) {
  if (!demandShareTokenSchema.safeParse(token).success) return null;
  const [share] = await (dependencies.transaction ?? withPublicDb)((tx) => tx.execute<{
    token: string; createdAt: Date | string; snapshot: unknown;
  }>(sql`select token, created_at as "createdAt", snapshot from edison_public_api.read_demand_article_share(${token})`));
  if (!share) return null;
  return publicDemandArticleShareSchema.parse({ token: share.token, createdAt: iso(share.createdAt), article: share.snapshot });
}
