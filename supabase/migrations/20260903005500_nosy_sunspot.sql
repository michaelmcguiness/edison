ALTER TYPE "public"."command_status" ADD VALUE 'no-op' BEFORE 'failed';--> statement-breakpoint
ALTER TABLE "feed_commands" ADD COLUMN "workflow_run_id" text;--> statement-breakpoint
ALTER TABLE "feed_commands" ADD COLUMN "lease_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "feed_commands" ADD COLUMN "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
CREATE INDEX "feed_commands_status_next_attempt_idx" ON "feed_commands" USING btree ("status","next_attempt_at");
