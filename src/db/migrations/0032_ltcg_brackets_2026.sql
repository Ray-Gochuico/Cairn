-- 0032_ltcg_brackets_2026.sql
--
-- Seeds the 2026 long-term capital gains (LTCG) / qualified-dividend
-- bracket schedule (0% / 15% / 20%) into `tax_rules`.
--
-- Approach: reuse the existing tax_rules table, with a NEW jurisdiction_type
-- value 'FEDERAL_LTCG' that sits beside the existing 'FEDERAL' rows. This
-- avoids an ALTER TABLE migration to add a tax_type column while
-- preserving the unique constraint
-- `UNIQUE(year, jurisdiction_type, jurisdiction_code, filing_status)`.
--
-- The `standard_deduction` column is unused for LTCG rows (the LTCG
-- schedule has no separate SD — it stacks on top of ordinary income's
-- post-SD federal taxable amount). Seeded as 0 to satisfy NOT NULL.
--
-- Sources (verified 2026-05-27 via Tax Foundation 2026 brackets table,
-- which mirrors IRS Rev. Proc. 2025-32):
--   https://taxfoundation.org/data/all/federal/2026-tax-brackets/
--
-- 2026 LTCG breakpoints:
--   Single: 0% to $49,450 ; 15% to $545,500 ; 20% above.
--   MFJ:    0% to $98,900 ; 15% to $613,700 ; 20% above.
--   HOH:    0% to $66,200 ; 15% to $579,600 ; 20% above.
--   MFS:    half-MFJ convention (Tax Foundation publishes Single/MFJ/HOH
--           only). 0% to $49,450 ; 15% to $306,850 ; 20% above.

INSERT OR IGNORE INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES
(2026, 'FEDERAL_LTCG', 'US', 'SINGLE',
 '[{"min":0,"max":49450,"rate":0.0},{"min":49450,"max":545500,"rate":0.15},{"min":545500,"max":null,"rate":0.20}]',
 0),
(2026, 'FEDERAL_LTCG', 'US', 'MFJ',
 '[{"min":0,"max":98900,"rate":0.0},{"min":98900,"max":613700,"rate":0.15},{"min":613700,"max":null,"rate":0.20}]',
 0),
(2026, 'FEDERAL_LTCG', 'US', 'MFS',
 '[{"min":0,"max":49450,"rate":0.0},{"min":49450,"max":306850,"rate":0.15},{"min":306850,"max":null,"rate":0.20}]',
 0),
(2026, 'FEDERAL_LTCG', 'US', 'HOH',
 '[{"min":0,"max":66200,"rate":0.0},{"min":66200,"max":579600,"rate":0.15},{"min":579600,"max":null,"rate":0.20}]',
 0);
