import { and, eq, inArray, sql } from "drizzle-orm";
import {
  createExplicitInterestRequestSchema,
  explicitInterestSchema,
  explicitInterestsResponseSchema,
} from "@edison/contracts";
import { normalizeInterestTopic } from "@edison/domain";
import { userInterests } from "@edison/db";
import { apiHandler, json } from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";
import {
  presentExplicitInterest,
  presentExplicitInterests,
} from "../../../../src/presenters/interest";
import { withActiveMember } from "../../../../src/services/members";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) =>
    withActiveMember(claims, async ({ transaction }) => {
      const interests = await transaction
        .select()
        .from(userInterests)
        .where(
          and(
            eq(userInterests.userId, claims.sub),
            eq(userInterests.kind, "explicit"),
            inArray(userInterests.status, ["active", "muted"]),
          ),
        );

      return json(
        explicitInterestsResponseSchema.parse({
          items: presentExplicitInterests(interests),
        }),
      );
    }),
  );
}

export async function POST(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = createExplicitInterestRequestSchema.parse(await request.json());

    return withActiveMember(claims, async ({ transaction }) => {
      await transaction.execute(sql`
        select pg_advisory_xact_lock(
          hashtextextended(${`edison-interests:${claims.sub}`}, 0)
        )
      `);

      const interests = await transaction
        .select()
        .from(userInterests)
        .where(
          and(
            eq(userInterests.userId, claims.sub),
            eq(userInterests.kind, "explicit"),
          ),
        )
        .for("update");
      const normalizedTopic = normalizeInterestTopic(input.topic);
      const existing = interests.find(
        (interest) => normalizeInterestTopic(interest.topic) === normalizedTopic,
      );
      const retainedCount = interests.filter(
        (interest) => interest.status !== "deleted",
      ).length;

      if (existing) {
        if (existing.status !== "active") {
          if (existing.status === "deleted" && retainedCount >= 50) {
            throw new HttpError(
              409,
              "interest_limit_reached",
              "Remove an interest before adding another one.",
            );
          }

          const [reactivated] = await transaction
            .update(userInterests)
            .set({ status: "active" })
            .where(
              and(
                eq(userInterests.id, existing.id),
                eq(userInterests.userId, claims.sub),
                eq(userInterests.kind, "explicit"),
              ),
            )
            .returning();
          const presented = reactivated
            ? presentExplicitInterest(reactivated)
            : null;
          if (!presented) {
            throw new HttpError(
              500,
              "interest_update_failed",
              "Edison could not restore that interest.",
            );
          }
          return json(explicitInterestSchema.parse(presented));
        }

        const presented = presentExplicitInterest(existing);
        if (!presented) {
          throw new HttpError(
            500,
            "interest_read_failed",
            "Edison could not read that interest.",
          );
        }
        return json(explicitInterestSchema.parse(presented));
      }

      if (retainedCount >= 50) {
        throw new HttpError(
          409,
          "interest_limit_reached",
          "Remove an interest before adding another one.",
        );
      }

      const [created] = await transaction
        .insert(userInterests)
        .values({
          userId: claims.sub,
          topic: input.topic,
          kind: "explicit",
          status: "active",
          evidence: { source: "profile-control" },
        })
        .onConflictDoUpdate({
          target: [
            userInterests.userId,
            userInterests.topic,
            userInterests.kind,
          ],
          set: { status: "active" },
        })
        .returning();
      const presented = created ? presentExplicitInterest(created) : null;
      if (!presented) {
        throw new HttpError(
          500,
          "interest_create_failed",
          "Edison could not add that interest.",
        );
      }

      return json(explicitInterestSchema.parse(presented), { status: 201 });
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
