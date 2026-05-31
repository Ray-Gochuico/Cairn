-- 0044_equity_grant_type.sql
-- Add an equity grant-type discriminator (RSU / ISO / NSO). Additive +
-- reversible: existing rows back-fill to 'RSU' via the DEFAULT (the historical
-- default — most modeled grants are RSUs). The CHECK mirrors the GrantType
-- enum (src/types/enums.ts) + the Zod nativeEnum on EquityGrantSchema; keep all
-- three in lock-step (any new value must be added to all three).
ALTER TABLE equity_grants
  ADD COLUMN grant_type TEXT NOT NULL DEFAULT 'RSU'
    CHECK (grant_type IN ('RSU', 'ISO', 'NSO'));
