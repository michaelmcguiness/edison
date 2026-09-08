-- Additive late-response evidence. Existing bills remain NULL; no backfill,
-- default, grants or terminal-stage/append-only trigger changes.
ALTER TABLE private.demand_usage ADD COLUMN observed_usage jsonb;

ALTER TABLE private.demand_usage
  ADD CONSTRAINT demand_usage_observed_usage_valid CHECK (
    observed_usage IS NULL OR (
      jsonb_typeof(observed_usage) = 'object'
      AND pg_column_size(observed_usage) <= 4096
      AND observed_usage - ARRAY[
        'providerResponseId', 'model', 'inputTokens', 'cachedInputTokens',
        'outputTokens', 'webSearchCalls', 'webSearchToolCalls',
        'webSearchPricingStatus', 'serviceTier'
      ]::text[] = '{}'::jsonb
      AND observed_usage @> jsonb_build_object(
        'providerResponseId', response_id, 'model', model,
        'inputTokens', input_tokens, 'cachedInputTokens', cached_input_tokens,
        'outputTokens', output_tokens
      )
    )
  );
