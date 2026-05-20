-- 0011_seed_payment_categories.sql
-- Adds "Debt Payment" (TRANSFER) and "Business Expense" (WANT) categories
-- and seeds CC-payment description patterns -> Transfer (41) and loan-servicer
-- patterns -> Debt Payment (43) so they auto-categorise and stay out of spending totals.

INSERT OR IGNORE INTO categories
  (id, name, parent_category_id, color, icon, type, is_capital, system_managed) VALUES
  (43, 'Debt Payment',     NULL, '#bab0ac', '💳', 'TRANSFER', 0, 0),
  (44, 'Business Expense', NULL, '#9d755d', '💼', 'WANT',     0, 0);

INSERT OR IGNORE INTO merchant_seed_mapping (merchant_pattern, category_id) VALUES
  ('PAYMENT THANK YOU', 41),
  ('AUTOPAY', 41),
  ('AUTOMATIC PAYMENT', 41),
  ('ONLINE PAYMENT', 41),
  ('ELECTRONIC PAYMENT', 41),
  ('MOBILE PAYMENT', 41),
  ('ACH PAYMENT', 41),
  ('WEB PAYMENT', 41),
  ('INTERNET PAYMENT', 41),
  ('PAYMENT RECEIVED', 41),
  ('CARDMEMBER PAYMENT', 41),
  ('AUTOPMT', 41),
  ('BILL PAYMENT', 41),
  ('EPAY', 41),
  ('PYMT RECEIVED', 41),
  ('STUDENT LOAN', 43),
  ('STUDENT LN', 43),
  ('LOAN PAYMENT', 43),
  ('LOAN PYMT', 43),
  ('NELNET', 43),
  ('MOHELA', 43),
  ('AIDVANTAGE', 43),
  ('NAVIENT', 43),
  ('SALLIE MAE', 43),
  ('GREAT LAKES', 43),
  ('EDFINANCIAL', 43);
