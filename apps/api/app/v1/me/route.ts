import { and, eq, inArray } from "drizzle-orm";
import {
  profileSchema,
  updatePreferencesRequestSchema,
} from "@edison/contracts";
import {
  feedPreferences as feedPreferencesTable,
  userInterests,
} from "@edison/db";
import { apiHandler, json } from "../../../src/http/api-handler";
import { HttpError } from "../../../src/http/errors";
import { presentProfile } from "../../../src/presenters/profile";
import { withActiveMember } from "../../../src/services/members";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return apiHandler(request, async ({ claims }) =>
    withActiveMember(claims, async ({ transaction, profile }) => {
      const [preferences] = await transaction
        .select()
        .from(feedPreferencesTable)
        .where(eq(feedPreferencesTable.userId, claims.sub))
        .limit(1);

      if (!preferences) {
        throw new HttpError(
          500,
          "profile_incomplete",
          "The reader profile is missing its feed preferences.",
        );
      }

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
        profileSchema.parse(presentProfile(profile, preferences, interests)),
      );
    }),
  );
}

export async function PATCH(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = updatePreferencesRequestSchema.parse(await request.json());

    return withActiveMember(claims, async ({ transaction, profile }) => {
      const updates: Partial<typeof feedPreferencesTable.$inferInsert> = {};
      if (input.articleLength !== undefined) updates.articleLength = input.articleLength;
      if (input.depth !== undefined) updates.depth = input.depth;
      if (input.novelty !== undefined) updates.novelty = input.novelty;
      if (input.categories !== undefined) {
        updates.categoryVisibility = Object.fromEntries(
          input.categories.map(({ category, visible }) => [category, visible]),
        );
        updates.categoryOrder = [...input.categories]
          .sort((left, right) => left.position - right.position)
          .map(({ category }) => category);
      }

      if (Object.keys(updates).length) {
        await transaction
          .update(feedPreferencesTable)
          .set(updates)
          .where(eq(feedPreferencesTable.userId, claims.sub));
      }

      const [preferences] = await transaction
        .select()
        .from(feedPreferencesTable)
        .where(eq(feedPreferencesTable.userId, claims.sub))
        .limit(1);

      if (!preferences) {
        throw new HttpError(500, "profile_incomplete", "Feed preferences are missing.");
      }

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
        profileSchema.parse(presentProfile(profile, preferences, interests)),
      );
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
