import "server-only";

import { and, asc, desc, eq, inArray, lte } from "drizzle-orm";
import {
  publicStarterArticleSchema,
  publicStarterEditionSchema,
  sharedArticleSnapshotSchema,
  type PublicStarterEdition,
  type PublishPublicStarterEditionRequest,
} from "@edison/contracts";
import {
  getDb,
  publicStarterEditionArticles,
  publicStarterEditions,
  withPublicDb,
  type UserTransaction,
} from "@edison/db";
import { HttpError } from "../http/errors";
import { newsEditionDateIsInFutureUtc } from "./news-editions";
import { fingerprintRequest } from "./request-fingerprint";

type StarterEditionForPresentation = Pick<
  typeof publicStarterEditions.$inferSelect,
  "id" | "section" | "editionDate" | "label" | "publishedAt"
>;

async function presentEdition(
  transaction: UserTransaction,
  edition: StarterEditionForPresentation,
): Promise<PublicStarterEdition> {
  const items = await transaction
    .select({
      id: publicStarterEditionArticles.id,
      position: publicStarterEditionArticles.position,
      reason: publicStarterEditionArticles.reason,
      snapshot: publicStarterEditionArticles.snapshot,
    })
    .from(publicStarterEditionArticles)
    .where(eq(publicStarterEditionArticles.editionId, edition.id))
    .orderBy(asc(publicStarterEditionArticles.position));

  return publicStarterEditionSchema.parse({
    id: edition.id,
    section: edition.section,
    editionDate: edition.editionDate,
    label: edition.label,
    publishedAt: edition.publishedAt?.toISOString(),
    itemCount: items.length,
    items: items.map((item) => ({
      id: item.id,
      position: item.position,
      reason: item.reason,
      article: sharedArticleSnapshotSchema.parse(item.snapshot),
    })),
  });
}

export async function getCurrentPublicNewsEdition() {
  return withPublicDb(async (transaction) => {
    const [edition] = await transaction
      .select({
        id: publicStarterEditions.id,
        section: publicStarterEditions.section,
        editionDate: publicStarterEditions.editionDate,
        label: publicStarterEditions.label,
        publishedAt: publicStarterEditions.publishedAt,
      })
      .from(publicStarterEditions)
      .where(
        and(
          eq(publicStarterEditions.section, "news"),
          eq(publicStarterEditions.status, "published"),
          lte(publicStarterEditions.publishedAt, new Date()),
        ),
      )
      .orderBy(
        desc(publicStarterEditions.editionDate),
        desc(publicStarterEditions.publishedAt),
      )
      .limit(1);

    if (!edition) {
      throw new HttpError(
        404,
        "starter_edition_unavailable",
        "A public starter edition has not been published yet.",
      );
    }
    return presentEdition(transaction, edition);
  });
}

export async function getPublicStarterArticle(articleId: string) {
  return withPublicDb(async (transaction) => {
    const [item] = await transaction
      .select({
        id: publicStarterEditionArticles.id,
        position: publicStarterEditionArticles.position,
        reason: publicStarterEditionArticles.reason,
        snapshot: publicStarterEditionArticles.snapshot,
      })
      .from(publicStarterEditionArticles)
      .innerJoin(
        publicStarterEditions,
        eq(publicStarterEditions.id, publicStarterEditionArticles.editionId),
      )
      .where(
        and(
          eq(publicStarterEditionArticles.id, articleId),
          inArray(publicStarterEditions.status, ["published", "archived"]),
          lte(publicStarterEditions.publishedAt, new Date()),
        ),
      )
      .limit(1);

    if (!item) {
      throw new HttpError(
        404,
        "public_article_not_found",
        "That public Edison article is not available.",
      );
    }

    return publicStarterArticleSchema.parse({
      id: item.id,
      position: item.position,
      reason: item.reason,
      article: sharedArticleSnapshotSchema.parse(item.snapshot),
    });
  });
}

export async function publishPublicNewsEdition(
  input: PublishPublicStarterEditionRequest,
) {
  if (newsEditionDateIsInFutureUtc(input.editionDate)) {
    throw new HttpError(
      400,
      "starter_edition_date_in_future",
      "A starter News edition cannot be published before its UTC date.",
    );
  }

  const fingerprint = fingerprintRequest([
    "publish-public-news-edition",
    input.editionDate,
    input.label,
    input.items,
  ]);
  const database = getDb();

  return database.transaction(async (transaction) => {
    const [existingByKey] = await transaction
      .select()
      .from(publicStarterEditions)
      .where(eq(publicStarterEditions.idempotencyKey, input.idempotencyKey))
      .limit(1);
    if (existingByKey) {
      if (existingByKey.requestFingerprint !== fingerprint) {
        throw new HttpError(
          409,
          "idempotency_key_reused",
          "That idempotency key was already used for a different starter edition.",
        );
      }
      if (existingByKey.status !== "published") {
        throw new HttpError(
          409,
          "starter_edition_publication_incomplete",
          "That starter-edition publication did not finish and requires operator review.",
        );
      }
      return {
        edition: await presentEdition(transaction, existingByKey),
        replayed: true,
      };
    }

    const [existingForDate] = await transaction
      .select({ id: publicStarterEditions.id })
      .from(publicStarterEditions)
      .where(
        and(
          eq(publicStarterEditions.section, "news"),
          eq(publicStarterEditions.editionDate, input.editionDate),
        ),
      )
      .limit(1);
    if (existingForDate) {
      throw new HttpError(
        409,
        "starter_edition_date_exists",
        "A starter News edition already exists for that date.",
      );
    }

    const editionId = crypto.randomUUID();
    const [created] = await transaction
      .insert(publicStarterEditions)
      .values({
        id: editionId,
        section: "news",
        editionDate: input.editionDate,
        label: input.label,
        status: "draft",
        publishedAt: null,
        idempotencyKey: input.idempotencyKey,
        requestFingerprint: fingerprint,
      })
      .onConflictDoNothing()
      .returning();
    if (!created) {
      const [racedByKey] = await transaction
        .select()
        .from(publicStarterEditions)
        .where(eq(publicStarterEditions.idempotencyKey, input.idempotencyKey))
        .limit(1);
      if (racedByKey) {
        if (racedByKey.requestFingerprint !== fingerprint) {
          throw new HttpError(
            409,
            "idempotency_key_reused",
            "That idempotency key was already used for a different starter edition.",
          );
        }
        if (racedByKey.status === "published") {
          return {
            edition: await presentEdition(transaction, racedByKey),
            replayed: true,
          };
        }
      }
      throw new HttpError(
        409,
        "starter_edition_publication_conflict",
        "A concurrent starter-edition publication used that date or idempotency key.",
      );
    }

    await transaction.insert(publicStarterEditionArticles).values(
      input.items.map((item, index) => ({
        editionId,
        position: index + 1,
        reason: item.reason,
        snapshot: item.article,
      })),
    );

    const [published] = await transaction
      .update(publicStarterEditions)
      .set({ status: "published", publishedAt: new Date() })
      .where(
        and(
          eq(publicStarterEditions.id, editionId),
          eq(publicStarterEditions.status, "draft"),
        ),
      )
      .returning();
    if (!published) {
      throw new HttpError(
        500,
        "starter_edition_publication_failed",
        "The starter edition could not be published.",
      );
    }

    return {
      edition: await presentEdition(transaction, published),
      replayed: false,
    };
  });
}
