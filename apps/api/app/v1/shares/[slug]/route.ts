import { and, eq, isNull } from "drizzle-orm";
import {
  publicArticleShareSchema,
  sharedArticleSnapshotSchema,
  shareSlugSchema,
} from "@edison/contracts";
import { alphaMemberships, articleShares, getDb } from "@edison/db";
import {
  json,
  publicApiHandler,
} from "../../../../src/http/api-handler";
import { HttpError } from "../../../../src/http/errors";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(request: Request, context: RouteContext) {
  return publicApiHandler(request, async () => {
    const { slug: rawSlug } = await context.params;
    const slug = shareSlugSchema.parse(rawSlug);

    const [share] = await getDb()
      .select({
        id: articleShares.id,
        slug: articleShares.slug,
        snapshot: articleShares.snapshot,
        createdAt: articleShares.createdAt,
      })
      .from(articleShares)
      .innerJoin(
        alphaMemberships,
        and(
          eq(alphaMemberships.userId, articleShares.userId),
          eq(alphaMemberships.status, "active"),
        ),
      )
      .where(
        and(eq(articleShares.slug, slug), isNull(articleShares.revokedAt)),
      )
      .limit(1);

    if (!share) {
      throw new HttpError(404, "share_not_found", "That article share was not found.");
    }

    return json(
      publicArticleShareSchema.parse({
        shareId: share.id,
        slug: share.slug,
        createdAt: share.createdAt.toISOString(),
        article: sharedArticleSnapshotSchema.parse(share.snapshot),
      }),
    );
  });
}

export async function OPTIONS(request: Request) {
  return publicApiHandler(request, async () =>
    new Response(null, { status: 204 }),
  );
}
