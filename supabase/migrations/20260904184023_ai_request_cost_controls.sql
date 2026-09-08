CREATE TABLE "private"."ai_request_reservations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"operation" text NOT NULL,
	"resource_id" uuid NOT NULL,
	"idempotency_key" text NOT NULL,
	"request_fingerprint" text NOT NULL,
	"status" text DEFAULT 'reserved' NOT NULL,
	"attempt_count" smallint DEFAULT 0 NOT NULL,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"provider_response_id" text,
	"last_error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ai_request_reservations_operation_valid" CHECK ("private"."ai_request_reservations"."operation" in ('article_qa', 'preference_command')),
	CONSTRAINT "ai_request_reservations_status_valid" CHECK ("private"."ai_request_reservations"."status" in ('reserved', 'in_progress', 'succeeded', 'failed')),
	CONSTRAINT "ai_request_reservations_idempotency_key_valid" CHECK (char_length("private"."ai_request_reservations"."idempotency_key") between 8 and 128 and "private"."ai_request_reservations"."idempotency_key" ~ '^[A-Za-z0-9._:-]+$'),
	CONSTRAINT "ai_request_reservations_fingerprint_length" CHECK (char_length("private"."ai_request_reservations"."request_fingerprint") = 64),
	CONSTRAINT "ai_request_reservations_attempt_range" CHECK ("private"."ai_request_reservations"."attempt_count" between 0 and 3),
	CONSTRAINT "ai_request_reservations_lease_consistent" CHECK ((
        ("private"."ai_request_reservations"."status" = 'in_progress' and "private"."ai_request_reservations"."lease_owner" is not null and "private"."ai_request_reservations"."lease_expires_at" is not null)
        or
        ("private"."ai_request_reservations"."status" <> 'in_progress' and "private"."ai_request_reservations"."lease_owner" is null and "private"."ai_request_reservations"."lease_expires_at" is null)
      )),
	CONSTRAINT "ai_request_reservations_finish_consistent" CHECK ((
        ("private"."ai_request_reservations"."status" in ('reserved', 'in_progress') and "private"."ai_request_reservations"."finished_at" is null)
        or
        ("private"."ai_request_reservations"."status" in ('succeeded', 'failed') and "private"."ai_request_reservations"."finished_at" is not null)
      )),
	CONSTRAINT "ai_request_reservations_success_has_provider_response" CHECK ("private"."ai_request_reservations"."status" <> 'succeeded' or "private"."ai_request_reservations"."provider_response_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD COLUMN "ai_request_reservation_id" uuid;--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD COLUMN "provider_response_id" text;--> statement-breakpoint
ALTER TABLE "private"."ai_request_reservations" ADD CONSTRAINT "ai_request_reservations_user_id_profiles_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."profiles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ai_request_reservations_user_operation_key_unique" ON "private"."ai_request_reservations" USING btree ("user_id","operation","idempotency_key");--> statement-breakpoint
CREATE INDEX "ai_request_reservations_user_operation_created_idx" ON "private"."ai_request_reservations" USING btree ("user_id","operation","created_at");--> statement-breakpoint
CREATE INDEX "ai_request_reservations_claim_idx" ON "private"."ai_request_reservations" USING btree ("status","next_attempt_at","lease_expires_at");--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD CONSTRAINT "usage_ledger_ai_request_reservation_id_ai_request_reservations_id_fk" FOREIGN KEY ("ai_request_reservation_id") REFERENCES "private"."ai_request_reservations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "usage_ledger_ai_request_idx" ON "private"."usage_ledger" USING btree ("ai_request_reservation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "usage_ledger_provider_response_unique" ON "private"."usage_ledger" USING btree ("provider","provider_response_id") WHERE "private"."usage_ledger"."provider_response_id" is not null;--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD CONSTRAINT "usage_ledger_ai_request_has_provider_response" CHECK ("private"."usage_ledger"."ai_request_reservation_id" is null or "private"."usage_ledger"."provider_response_id" is not null);
--> statement-breakpoint
CREATE TRIGGER "ai_request_reservations_touch_updated_at"
BEFORE UPDATE ON private.ai_request_reservations
FOR EACH ROW EXECUTE FUNCTION private.touch_updated_at();
--> statement-breakpoint
ALTER TABLE private.ai_request_reservations ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY "ai_request_reservations_select_own"
ON private.ai_request_reservations FOR SELECT TO edison_api
USING ((SELECT auth.uid()) = user_id);
CREATE POLICY "ai_request_reservations_insert_own"
ON private.ai_request_reservations FOR INSERT TO edison_api
WITH CHECK ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
REVOKE ALL ON TABLE private.ai_request_reservations
FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT USAGE ON SCHEMA private TO edison_api;
GRANT SELECT, INSERT ON private.ai_request_reservations TO edison_api;
GRANT SELECT, INSERT, UPDATE ON private.ai_request_reservations TO service_role;
