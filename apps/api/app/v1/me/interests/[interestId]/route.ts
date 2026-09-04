import { and, eq, inArray } from "drizzle-orm";
import {
  explicitInterestSchema,
  updateExplicitInterestRequestSchema,
  uuidSchema,
} from "@edison/contracts";
import { userInterests } from "@edison/db";
import { apiHandler, json } from "../../../../../src/http/api-handler";
import { HttpError } from "../../../../../src/http/errors";
import { presentExplicitInterest } from "../../../../../src/presenters/interest";
import { withActiveMember } from "../../../../../src/services/members";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ interestId: string }> };

export async function PATCH(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { interestId: rawInterestId } = await context.params;
    const interestId = uuidSchema.parse(rawInterestId);
    const input = updateExplicitInterestRequestSchema.parse(await request.json());

    return withActiveMember(claims, async ({ transaction }) => {
      const [updated] = await transaction
        .update(userInterests)
        .set({ status: input.status })
        .where(
          and(
            eq(userInterests.id, interestId),
            eq(userInterests.userId, claims.sub),
            eq(userInterests.kind, "explicit"),
            inArray(userInterests.status, ["active", "muted"]),
          ),
        )
        .returning();
      const presented = updated ? presentExplicitInterest(updated) : null;
      if (!presented) {
        throw new HttpError(
          404,
          "interest_not_found",
          "That explicit interest was not found.",
        );
      }

      return json(explicitInterestSchema.parse(presented));
    });
  });
}

export async function DELETE(request: Request, context: RouteContext) {
  return apiHandler(request, async ({ claims }) => {
    const { interestId: rawInterestId } = await context.params;
    const interestId = uuidSchema.parse(rawInterestId);

    return withActiveMember(claims, async ({ transaction }) => {
      const [deleted] = await transaction
        .update(userInterests)
        .set({ status: "deleted" })
        .where(
          and(
            eq(userInterests.id, interestId),
            eq(userInterests.userId, claims.sub),
            eq(userInterests.kind, "explicit"),
            inArray(userInterests.status, ["active", "muted"]),
          ),
        )
        .returning({ id: userInterests.id });
      if (!deleted) {
        throw new HttpError(
          404,
          "interest_not_found",
          "That explicit interest was not found.",
        );
      }

      return new Response(null, { status: 204 });
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
