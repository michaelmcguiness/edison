import {
  createDemandLoopSchema,
  demandEventSchema,
  demandFeedbackSchema,
  demandQuestionSchema,
  demandResultSchema,
  demandWorkspaceSchema,
  parseDemandHistoryQuery,
  requestDemandArticleSchema,
  requestDemandIdeasSchema,
  editDemandLoopSchema, archiveDemandLoopSchema, createDemandArticleShareSchema, parseDemandConversationQuery,
  resetDemandAllowanceSchema, demandAllowanceResetReceiptSchema, parseDemandLoopsQuery, demandLoopsSchema,
  createDemandInvitationSchema, demandInvitationActionSchema, demandInvitationMutationSchema,
  demandInvitationsSchema, demandInvitationRedemptionSchema, uuidSchema,
} from "@edison/contracts";
import { resolveDemandPrincipal, resolveDemandResourcePrincipal } from "../../../../src/auth/verify-demand-principal";
import {
  json,
  publicApiHandler,
  readJsonBody,
} from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";
import {
  dispatchDemandRequest,
  matchDemandRoute,
  retryDemandRequest,
} from "../../../../src/services/demand-dispatch";
import {
  createDemandLoop,
  demandRequestResult,
  demandWorkspace,
  recordDemandEvent,
  requestDemandArticle,
  requestDemandFeedback,
  requestDemandIdeas,
  requestDemandQuestion,
  type DemandRequestRow,
} from "../../../../src/services/demand-reading";
import type { DemandPrincipal } from "../../../../src/auth/verify-demand-principal";
import { demandHistory, demandIdeaResult } from "../../../../src/services/demand-history";
import { demandArticleResult, demandConversation } from "../../../../src/services/demand-conversation";
import { editDemandLoop, archiveDemandLoop } from "../../../../src/services/demand-loop-management";
import { createDemandArticleShare } from "../../../../src/services/demand-sharing";
import { resetDemandAllowance } from "../../../../src/services/demand-allowance";
import { demandLoopPage, demandLoopResult } from "../../../../src/services/demand-loop-list";
import { verifyAccessToken } from "../../../../src/auth/verify-access-token";
import { withActiveMember } from "../../../../src/services/members";
import { createDemandInvitation, listDemandInvitations, previewDemandInvitation, redeemDemandInvitation, resendDemandInvitation, revokeDemandInvitation } from "../../../../src/services/demand-invitations";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_DEMAND_BODY_BYTES = 8_192;

type RouteContext = { params: Promise<{ path: string[] }> };

async function parsedBody(request: Request) {
  return readJsonBody(request, MAX_DEMAND_BODY_BYTES);
}

async function mutationResponse(
  principal: DemandPrincipal,
  request: DemandRequestRow,
) {
  if (request.status === "queued") {
    await dispatchDemandRequest(request.id, request.principalId);
  }
  const workspace = demandWorkspaceSchema.parse(
    await demandWorkspace(principal),
  );
  return json(
    { workspace, requestId: request.id },
    { status: request.status === "succeeded" ? 200 : 202 },
  );
}

async function handleDemandRoute(request: Request, context: RouteContext) {
  return publicApiHandler(request, async () => {
    const { path } = await context.params;
    if (request.method === "GET" && path.length === 1 && path[0] === "access") {
      if (new URL(request.url).search) throw new HttpError(400, "invalid_request", "Query parameters are not supported here.");
      const claims = await verifyAccessToken(request.headers.get("authorization"), { demand: true });
      return withActiveMember(claims, async () => json({ member: true }));
    }
    if (path[0] === "invitations") {
      const params = new URL(request.url).searchParams;
      const list = path.length === 1 && request.method === "GET";
      const create = path.length === 1 && request.method === "POST";
      const exact = path.length === 3 && uuidSchema.safeParse(path[1]).success;
      const preview = exact && path[2] === "preview" && request.method === "GET";
      const redeem = exact && path[2] === "redeem" && request.method === "POST";
      const resend = exact && path[2] === "resend" && request.method === "POST";
      const revoke = exact && path[2] === "revoke" && request.method === "POST";
      if (params.size || !(list || create || preview || redeem || resend || revoke)) throw new HttpError(404, "not_found", "That invitation resource was not found.");
      const headers = { "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow" };
      if (preview) {
        const authorization = request.headers.get("authorization");
        const claims = authorization ? await verifyAccessToken(authorization, { demand: true }) : null;
        return json(await previewDemandInvitation(path[1], { verifiedUserId: claims?.sub }), { headers });
      }
      const claims = await verifyAccessToken(request.headers.get("authorization"), { demand: true });
      // Redemption is the sole verified-but-not-yet-member mutation. The
      // transaction checks the exact recipient email and invitation itself.
      if (redeem) return json(demandInvitationRedemptionSchema.parse(await redeemDemandInvitation(claims.sub, path[1], demandInvitationActionSchema.parse(await parsedBody(request)))), { headers });
      // These services open their own worker transactions and recheck the active
      // actor there. Release this gate's sole pooled connection before calling them.
      await withActiveMember(claims, async () => undefined);
      if (list) return json(demandInvitationsSchema.parse(await listDemandInvitations(claims.sub)), { headers });
      const result = create ? await createDemandInvitation(claims.sub, createDemandInvitationSchema.parse(await parsedBody(request)))
        : resend ? await resendDemandInvitation(claims.sub, path[1], demandInvitationActionSchema.parse(await parsedBody(request)))
          : await revokeDemandInvitation(claims.sub, path[1], demandInvitationActionSchema.parse(await parsedBody(request)));
      return json(demandInvitationMutationSchema.parse(result), { headers });
    }
    const route = matchDemandRoute(request.method, path);
    if (!route) {
      throw new HttpError(
        404,
        "not_found",
        "That reading resource was not found.",
      );
    }
    const params = new URL(request.url).searchParams;
    if (params.size && route.kind !== "history" && route.kind !== "conversation" && route.kind !== "loops") {
      throw new HttpError(400, "invalid_request", "Query parameters are not supported here.");
    }

    if (route.kind === "session") {
      const { principal, newGuestToken } = await resolveDemandPrincipal(
        request,
        true,
      );
      const workspace = demandWorkspaceSchema.parse(
        await demandWorkspace(principal),
      );
      return json(
        {
          workspace,
          ...(newGuestToken ? { newGuestToken } : {}),
        },
        { status: newGuestToken ? 201 : 200 },
      );
    }

    const { principal: accountPrincipal } = await resolveDemandPrincipal(request);
    // Resource IDs are locators, never caller-selected owners. Resolve only
    // within this authenticated reader's canonical workspace/claimed aliases.
    const resource = "loopId" in route ? { loopId: route.loopId }
      : "ideaId" in route ? { ideaId: route.ideaId }
      : "articleId" in route ? { articleId: route.articleId }
      : "requestId" in route ? { requestId: route.requestId } : null;
    const principal = resource ? await resolveDemandResourcePrincipal(accountPrincipal, resource) : accountPrincipal;
    if (route.kind === "loop-result") return json(demandLoopsSchema.parse(await demandLoopResult(principal, route.loopId)));
    if (route.kind === "reset-allowance") {
      const input = resetDemandAllowanceSchema.parse(await parsedBody(request));
      const receipt = demandAllowanceResetReceiptSchema.parse(await resetDemandAllowance(principal, input));
      return json({ workspace: demandWorkspaceSchema.parse(await demandWorkspace(principal)), receipt });
    }
    if (route.kind === "loops") {
      let input;
      try { input = parseDemandLoopsQuery(params); }
      catch { throw new HttpError(400, "invalid_request", "That loop list request is not valid."); }
      return json(demandLoopsSchema.parse(await demandLoopPage(principal, input)));
    }
    if (route.kind === "article-result") return json(await demandArticleResult(principal, route.articleId));
    if (route.kind === "conversation") {
      let input;
      try { input = parseDemandConversationQuery(params); }
      catch { throw new HttpError(400, "invalid_request", "That conversation request is not valid."); }
      return json(await demandConversation(principal, route.articleId, input));
    }
    if (route.kind === "share") {
      const result = await createDemandArticleShare(principal, route.articleId, createDemandArticleShareSchema.parse(await parsedBody(request)));
      return json(result, { status: result.created ? 201 : 200 });
    }
    if (route.kind === "edit-loop" || route.kind === "archive-loop") {
      if (route.kind === "edit-loop") await editDemandLoop(principal, route.loopId, editDemandLoopSchema.parse(await parsedBody(request)));
      else await archiveDemandLoop(principal, route.loopId, archiveDemandLoopSchema.parse(await parsedBody(request)));
      // Replays return current workspace rather than an old receipt snapshot.
      return json({ workspace: await demandWorkspace(principal) });
    }
    if (route.kind === "history") {
      let input;
      try { input = parseDemandHistoryQuery(params); }
      catch { throw new HttpError(400, "invalid_request", "That reading history request is not valid."); }
      return json(await demandHistory(principal, input));
    }
    if (route.kind === "idea-result") {
      return json(await demandIdeaResult(principal, route.ideaId));
    }
    if (route.kind === "workspace") {
      return json({
        workspace: demandWorkspaceSchema.parse(
          await demandWorkspace(principal),
        ),
      });
    }
    if (route.kind === "result") {
      return json(
        demandResultSchema.parse(
          await demandRequestResult(principal, route.requestId),
        ),
      );
    }
    if (route.kind === "retry") {
      await retryDemandRequest(principal.id, route.requestId);
      return json(
        {
          workspace: demandWorkspaceSchema.parse(
            await demandWorkspace(principal),
          ),
          requestId: route.requestId,
        },
        { status: 202 },
      );
    }
    if (route.kind === "create-loop") {
      const input = createDemandLoopSchema.parse(await parsedBody(request));
      return mutationResponse(principal, await createDemandLoop(principal, input));
    }
    if (route.kind === "ideas") {
      const input = requestDemandIdeasSchema.parse(await parsedBody(request));
      return mutationResponse(
        principal,
        await requestDemandIdeas(principal, route.loopId, input),
      );
    }
    if (route.kind === "feedback") {
      const input = demandFeedbackSchema.parse(await parsedBody(request));
      return mutationResponse(
        principal,
        await requestDemandFeedback(principal, route.loopId, input),
      );
    }
    if (route.kind === "article") {
      const input = requestDemandArticleSchema.parse(await parsedBody(request));
      return mutationResponse(
        principal,
        await requestDemandArticle(principal, route.ideaId, input),
      );
    }
    if (route.kind === "questions") {
      const input = demandQuestionSchema.parse(await parsedBody(request));
      return mutationResponse(
        principal,
        await requestDemandQuestion(principal, route.ideaId, input),
      );
    }

    const input = demandEventSchema.parse(await parsedBody(request));
    await recordDemandEvent(principal, route.ideaId, input);
    return json({
      workspace: demandWorkspaceSchema.parse(await demandWorkspace(principal)),
    });
  });
}

export const GET = handleDemandRoute;
export const POST = handleDemandRoute;
export const PUT = handleDemandRoute;

export async function OPTIONS(request: Request) {
  return publicApiHandler(
    request,
    async () => new Response(null, { status: 204 }),
  );
}
