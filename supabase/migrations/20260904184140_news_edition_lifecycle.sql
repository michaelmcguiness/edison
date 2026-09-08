ALTER TABLE "editorial_direction_states" ADD COLUMN "current_edition_date" date;--> statement-breakpoint
ALTER TABLE "feed_items" ADD COLUMN "edition_id" uuid;--> statement-breakpoint
CREATE INDEX "feed_items_user_edition_category_rank_idx" ON "feed_items" USING btree ("user_id","edition_id","category","rank");
--> statement-breakpoint
-- Preserve the most recent pre-lifecycle feed as the current News edition.
-- Older feed rows and their articles remain readable from history/library but
-- cannot be mislabeled as part of the current finite edition.
UPDATE public.editorial_direction_states AS state
SET current_edition_date = latest.edition_date
FROM (
	SELECT user_id, max(edition_date) AS edition_date
	FROM public.feed_items
	GROUP BY user_id
) AS latest
WHERE state.user_id = latest.user_id
	AND state.section = 'news'
	AND state.current_edition_date IS NULL;
--> statement-breakpoint
UPDATE public.feed_items AS item
SET edition_id = state.current_edition_id
FROM public.editorial_direction_states AS state
WHERE state.user_id = item.user_id
	AND state.section = 'news'
	AND state.current_edition_date = item.edition_date
	AND item.edition_id IS NULL;
--> statement-breakpoint
-- Published starter snapshots are immutable. Keep archived issues readable so
-- bookmarked public article links survive rotation; the current-edition route
-- still explicitly selects status = 'published'.
DROP POLICY "public_starter_editions_read_published"
ON public.public_starter_editions;
--> statement-breakpoint
CREATE POLICY "public_starter_editions_read_public_history"
ON public.public_starter_editions FOR SELECT TO edison_public
USING (status IN ('published', 'archived') AND published_at <= now());
--> statement-breakpoint
DROP POLICY "public_starter_edition_articles_read_published"
ON public.public_starter_edition_articles;
--> statement-breakpoint
CREATE POLICY "public_starter_edition_articles_read_public_history"
ON public.public_starter_edition_articles FOR SELECT TO edison_public
USING (
	EXISTS (
		SELECT 1
		FROM public.public_starter_editions AS edition
		WHERE edition.id = public_starter_edition_articles.edition_id
			AND edition.status IN ('published', 'archived')
			AND edition.published_at <= now()
	)
);
