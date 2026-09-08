ALTER TABLE "private"."usage_ledger" DROP CONSTRAINT "usage_ledger_tokens_nonnegative";--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ALTER COLUMN "cost_microusd" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ALTER COLUMN "cost_microusd" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD COLUMN "pricing_status" text DEFAULT 'priced' NOT NULL;--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD CONSTRAINT "usage_ledger_pricing_consistent" CHECK ((
        ("private"."usage_ledger"."pricing_status" = 'priced' and "private"."usage_ledger"."cost_microusd" is not null)
        or
        ("private"."usage_ledger"."pricing_status" = 'unpriced' and "private"."usage_ledger"."cost_microusd" is null)
      ));--> statement-breakpoint
ALTER TABLE "private"."usage_ledger" ADD CONSTRAINT "usage_ledger_tokens_nonnegative" CHECK (
      "private"."usage_ledger"."input_tokens" >= 0 and
      "private"."usage_ledger"."cached_input_tokens" >= 0 and
      "private"."usage_ledger"."output_tokens" >= 0 and
      "private"."usage_ledger"."web_search_calls" >= 0 and
      ("private"."usage_ledger"."cost_microusd" is null or "private"."usage_ledger"."cost_microusd" >= 0)
    );