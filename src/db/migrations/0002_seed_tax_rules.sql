-- 0002_seed_tax_rules.sql
-- Tax year 2026 brackets. Federal source: IRS Rev. Proc. 2024-40 + 2025 inflation adjustment.
-- Cross-checked against Tax Foundation 2026 federal brackets.
-- States and cities added in subsequent migrations (Tasks 9-10).
-- NOTE: FICA is NOT seeded. It is constants-only in src/lib/tax.ts. The JurisdictionType.FICA
-- enum value is retained for future use but no rows are inserted here.

-- FEDERAL — 4 filing statuses
INSERT INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES
(2026, 'FEDERAL', 'US', 'SINGLE',
 '[{"min":0,"max":11600,"rate":0.10},{"min":11600,"max":47150,"rate":0.12},{"min":47150,"max":100525,"rate":0.22},{"min":100525,"max":191950,"rate":0.24},{"min":191950,"max":243725,"rate":0.32},{"min":243725,"max":609350,"rate":0.35},{"min":609350,"max":null,"rate":0.37}]',
 14600),
(2026, 'FEDERAL', 'US', 'MFJ',
 '[{"min":0,"max":23200,"rate":0.10},{"min":23200,"max":94300,"rate":0.12},{"min":94300,"max":201050,"rate":0.22},{"min":201050,"max":383900,"rate":0.24},{"min":383900,"max":487450,"rate":0.32},{"min":487450,"max":731200,"rate":0.35},{"min":731200,"max":null,"rate":0.37}]',
 29200),
(2026, 'FEDERAL', 'US', 'MFS',
 '[{"min":0,"max":11600,"rate":0.10},{"min":11600,"max":47150,"rate":0.12},{"min":47150,"max":100525,"rate":0.22},{"min":100525,"max":191950,"rate":0.24},{"min":191950,"max":243725,"rate":0.32},{"min":243725,"max":365600,"rate":0.35},{"min":365600,"max":null,"rate":0.37}]',
 14600),
(2026, 'FEDERAL', 'US', 'HOH',
 '[{"min":0,"max":16550,"rate":0.10},{"min":16550,"max":63100,"rate":0.12},{"min":63100,"max":100500,"rate":0.22},{"min":100500,"max":191950,"rate":0.24},{"min":191950,"max":243700,"rate":0.32},{"min":243700,"max":609350,"rate":0.35},{"min":609350,"max":null,"rate":0.37}]',
 21900);
