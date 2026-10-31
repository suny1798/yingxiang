-- 新映想积分独立记账：1秒=1积分；旧人民币余额与历史积分不自动换算。
ALTER TABLE orders DROP CONSTRAINT ck_orders_product;
ALTER TABLE orders ADD CONSTRAINT ck_orders_product CHECK (
  amount > 0 AND (
    (currency='cny' AND (
      (plan_id IS NULL AND credits IS NULL AND seconds IS NOT NULL AND count IS NOT NULL AND seconds IN (15,30,60) AND count IN (1,5,10)) OR
      (plan_id IS NOT NULL AND credits IS NOT NULL AND plan_id IN ('light','creator','plus') AND credits > 0 AND seconds IS NULL AND count IS NULL) OR
      (sku IN ('wallet-v2-light','wallet-v2-creator','wallet-v2-plus') AND plan_id IS NULL AND credits IS NULL AND seconds IS NULL AND count IS NULL)
    )) OR
    (currency='usd' AND plan_id IS NOT NULL AND plan_id IN ('light','creator','plus') AND sku='credits-v2-' || plan_id
      AND credits IS NOT NULL AND credits > 0 AND seconds IS NULL AND count IS NULL)
  )
);

CREATE TABLE billing_credit_wallets (
  user_id VARCHAR NOT NULL REFERENCES users(id),
  environment VARCHAR NOT NULL CHECK (environment IN ('real_usage','stripe_sandbox')),
  available_credits BIGINT NOT NULL DEFAULT 0 CHECK (available_credits >= 0),
  reserved_credits BIGINT NOT NULL DEFAULT 0 CHECK (reserved_credits >= 0),
  spent_credits BIGINT NOT NULL DEFAULT 0 CHECK (spent_credits >= 0),
  PRIMARY KEY (user_id, environment)
);
CREATE TABLE billing_credit_charges (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  environment VARCHAR NOT NULL,
  scene VARCHAR NOT NULL CHECK (scene IN ('studio','video','prompt')),
  version VARCHAR NOT NULL CHECK (version='credits-v2'),
  reserved_ms BIGINT NOT NULL CHECK (reserved_ms > 0 AND reserved_ms <= 30000),
  reserved_credits BIGINT NOT NULL CHECK (reserved_credits > 0),
  settled_ms BIGINT CHECK (settled_ms >= 0 AND settled_ms <= reserved_ms),
  charged_credits BIGINT CHECK (charged_credits >= 0 AND charged_credits <= reserved_credits),
  state VARCHAR NOT NULL CHECK (state IN ('reserved','review','settled','released')),
  created_at BIGINT NOT NULL,
  settled_at BIGINT,
  FOREIGN KEY (user_id, environment) REFERENCES billing_credit_wallets(user_id, environment)
);
CREATE INDEX ix_billing_credit_charges_user ON billing_credit_charges(user_id, environment, created_at DESC);
CREATE TABLE billing_credit_entries (
  operation_key VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  environment VARCHAR NOT NULL,
  kind VARCHAR NOT NULL CHECK (kind IN ('topup','reserve','settle','release')),
  available_credits_delta BIGINT NOT NULL,
  reserved_credits_delta BIGINT NOT NULL,
  spent_credits_delta BIGINT NOT NULL,
  paid_minor BIGINT,
  currency VARCHAR NOT NULL CHECK (currency='usd'),
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id, environment) REFERENCES billing_credit_wallets(user_id, environment)
);
