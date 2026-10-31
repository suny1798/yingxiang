-- 管理员调整积分使用独立流水类型，保留原有充值、预留、结算与返还记录。
ALTER TABLE billing_credit_entries DROP CONSTRAINT billing_credit_entries_kind_check;
ALTER TABLE billing_credit_entries ADD CONSTRAINT billing_credit_entries_kind_check
  CHECK (kind IN ('topup','reserve','settle','release','adjust'));
