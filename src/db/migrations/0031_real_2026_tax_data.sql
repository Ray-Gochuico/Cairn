-- 0031_real_2026_tax_data.sql
--
-- Fix the stale "2026" federal tax data that was actually Rev. Proc. 2023-34
-- (tax year 2024). Migration 0002 was labeled "2026" but seeded the prior-
-- prior-year numbers; this migration updates the federal rows to actual
-- 2026 figures.
--
-- Sources (verified 2026-05-27):
--   Federal brackets + std deductions: IRS Rev. Proc. 2025-32 (Oct 2025),
--     mirrored at Tax Foundation https://taxfoundation.org/data/all/federal/2026-tax-brackets/
--   SS wage base: see src/lib/contribution-limits.ts (constants moved separately).
--
-- 2026 standard deductions: SINGLE $16,100 / MFJ $32,200 / MFS $16,100 / HOH $24,150.
-- 2026 federal brackets — top sentinels:
--   SINGLE: 10% top $12,400; 22% top $105,700; 37% bottom $640,600.
--   MFJ:    10% top $24,800; 22% top $211,400; 37% bottom $768,700.
--   HOH:    10% top $17,700; 12% top $67,450; 37% bottom $640,600.
--   MFS shares the SINGLE schedule up through 35%, with 37% bottom at
--   half the MFJ value ($384,350) — IRS convention.

UPDATE tax_rules
SET brackets = '[{"min":0,"max":12400,"rate":0.10},{"min":12400,"max":50400,"rate":0.12},{"min":50400,"max":105700,"rate":0.22},{"min":105700,"max":201775,"rate":0.24},{"min":201775,"max":256225,"rate":0.32},{"min":256225,"max":640600,"rate":0.35},{"min":640600,"max":null,"rate":0.37}]',
    standard_deduction = 16100
WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND jurisdiction_code = 'US' AND filing_status = 'SINGLE';

UPDATE tax_rules
SET brackets = '[{"min":0,"max":24800,"rate":0.10},{"min":24800,"max":100800,"rate":0.12},{"min":100800,"max":211400,"rate":0.22},{"min":211400,"max":403550,"rate":0.24},{"min":403550,"max":512450,"rate":0.32},{"min":512450,"max":768700,"rate":0.35},{"min":768700,"max":null,"rate":0.37}]',
    standard_deduction = 32200
WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND jurisdiction_code = 'US' AND filing_status = 'MFJ';

UPDATE tax_rules
SET brackets = '[{"min":0,"max":12400,"rate":0.10},{"min":12400,"max":50400,"rate":0.12},{"min":50400,"max":105700,"rate":0.22},{"min":105700,"max":201775,"rate":0.24},{"min":201775,"max":256225,"rate":0.32},{"min":256225,"max":384350,"rate":0.35},{"min":384350,"max":null,"rate":0.37}]',
    standard_deduction = 16100
WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND jurisdiction_code = 'US' AND filing_status = 'MFS';

UPDATE tax_rules
SET brackets = '[{"min":0,"max":17700,"rate":0.10},{"min":17700,"max":67450,"rate":0.12},{"min":67450,"max":105700,"rate":0.22},{"min":105700,"max":201775,"rate":0.24},{"min":201775,"max":256200,"rate":0.32},{"min":256200,"max":640600,"rate":0.35},{"min":640600,"max":null,"rate":0.37}]',
    standard_deduction = 24150
WHERE year = 2026 AND jurisdiction_type = 'FEDERAL' AND jurisdiction_code = 'US' AND filing_status = 'HOH';
