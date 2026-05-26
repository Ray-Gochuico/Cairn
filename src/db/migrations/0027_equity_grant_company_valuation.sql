-- Adds optional company-valuation snapshot fields to equity_grants.
-- All three are nullable REALs used by the in-form FMV calculator
-- (see src/lib/equity-value.ts:computeFmvFromCompanyValuation). The
-- engine does not consume these columns; they're metadata so the user
-- can revisit + edit the breakdown that produced their per-share FMV.
ALTER TABLE equity_grants ADD COLUMN company_valuation REAL;
ALTER TABLE equity_grants ADD COLUMN company_outstanding_shares REAL;
ALTER TABLE equity_grants ADD COLUMN company_total_debt REAL;
