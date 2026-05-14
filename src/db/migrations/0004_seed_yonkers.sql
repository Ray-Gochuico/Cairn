-- 0004_seed_yonkers.sql
-- Yonkers, NY local income tax. Yonkers residents pay a 16.75% surcharge on
-- their NY state income tax. Bracket math is linear, so this is mathematically
-- equivalent to brackets = NY state brackets with each rate × 0.1675.
-- Migration 0002 originally skipped Yonkers because its tax base is "state tax"
-- not direct income; this migration encodes it as the equivalent direct-income
-- scaled-bracket form.
INSERT OR IGNORE INTO tax_rules (year, jurisdiction_type, jurisdiction_code, filing_status, brackets, standard_deduction) VALUES
(2026, 'CITY', 'NY_YONKERS', 'SINGLE',
 '[{"min":0,"max":8500,"rate":0.0065325},{"min":8500,"max":11700,"rate":0.00737},{"min":11700,"max":13900,"rate":0.00862625},{"min":13900,"max":80650,"rate":0.009045},{"min":80650,"max":215400,"rate":0.0098825},{"min":215400,"max":1077550,"rate":0.01147375},{"min":1077550,"max":5000000,"rate":0.01616375},{"min":5000000,"max":25000000,"rate":0.01725625},{"min":25000000,"max":null,"rate":0.01825725}]',
 0),
(2026, 'CITY', 'NY_YONKERS', 'MFJ',
 '[{"min":0,"max":17150,"rate":0.0065325},{"min":17150,"max":23600,"rate":0.00737},{"min":23600,"max":27900,"rate":0.00862625},{"min":27900,"max":161550,"rate":0.009045},{"min":161550,"max":323200,"rate":0.0098825},{"min":323200,"max":2155350,"rate":0.01147375},{"min":2155350,"max":5000000,"rate":0.01616375},{"min":5000000,"max":25000000,"rate":0.01725625},{"min":25000000,"max":null,"rate":0.01825725}]',
 0),
(2026, 'CITY', 'NY_YONKERS', 'MFS',
 '[{"min":0,"max":8500,"rate":0.0065325},{"min":8500,"max":11700,"rate":0.00737},{"min":11700,"max":13900,"rate":0.00862625},{"min":13900,"max":80650,"rate":0.009045},{"min":80650,"max":215400,"rate":0.0098825},{"min":215400,"max":1077550,"rate":0.01147375},{"min":1077550,"max":5000000,"rate":0.01616375},{"min":5000000,"max":25000000,"rate":0.01725625},{"min":25000000,"max":null,"rate":0.01825725}]',
 0),
(2026, 'CITY', 'NY_YONKERS', 'HOH',
 '[{"min":0,"max":8500,"rate":0.0065325},{"min":8500,"max":11700,"rate":0.00737},{"min":11700,"max":13900,"rate":0.00862625},{"min":13900,"max":80650,"rate":0.009045},{"min":80650,"max":215400,"rate":0.0098825},{"min":215400,"max":1077550,"rate":0.01147375},{"min":1077550,"max":5000000,"rate":0.01616375},{"min":5000000,"max":25000000,"rate":0.01725625},{"min":25000000,"max":null,"rate":0.01825725}]',
 0);
