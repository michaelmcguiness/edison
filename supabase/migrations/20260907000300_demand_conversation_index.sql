-- Display pagination is independent of the smaller model-context/workspace
-- windows. Immutable creation time + UUID provides a stable keyset ordering.
create index demand_requests_conversation_idx on private.demand_requests
  (principal_id, idea_id, created_at desc, id desc) where kind = 'question';
