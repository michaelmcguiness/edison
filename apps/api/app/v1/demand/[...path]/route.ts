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
} from "@edison/contracts";
import { resolveDemandPrincipal } from "../../../../src/auth/verify-demand-principal";
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
    await dispatchDemandRequest(request.id, principal.id);
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
    const route = matchDemandRoute(request.method, path);
    if (!route) {
      throw new HttpError(
        404,
        "not_found",
        "That reading resource was not found.",
      );
    }
    const params = new URL(request.url).searchParams;
    if (params.size && route.kind !== "history" && route.kind !== "conversation") {
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

    const { principal } = await resolveDemandPrincipal(request);
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
