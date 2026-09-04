import { and, eq, inArray, sql } from "drizzle-orm";
import {
  profileSchema,
  removeInferredPreferenceRequestSchema,
} from "@edison/contracts";
import { feedPreferences, userInterests } from "@edison/db";
import { apiHandler, json } from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";
import { presentProfile } from "../../../../src/presenters/profile";
import { withActiveMember } from "../../../../src/services/members";

export const dynamic = "force-dynamic";

export async function DELETE(request: Request) {
  return apiHandler(request, async ({ claims }) => {
    const input = removeInferredPreferenceRequestSchema.parse(
      await request.json(),
    );

    return withActiveMember(claims, async ({ transaction, profile }) => {
      // The expression operates on the row's current value, so concurrent
      // removals compose safely. Repeating this DELETE is naturally idempotent.
      const [preferences] = await transaction
        .update(feedPreferences)
        .set({
          inferredPreferences: sql`${feedPreferences.inferredPreferences} - ${input.preference}::text`,
        })
        .where(eq(feedPreferences.userId, claims.sub))
        .returning();

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
    });
  });
}

export async function OPTIONS(request: Request) {
  return apiHandler(request, async () => new Response(null, { status: 204 }));
}
