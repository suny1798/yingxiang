-- 旧次数、积分和订单保持原值；新钱包以整数分计价，沙盒与真实用量隔离。
ALTER TABLE orders DROP CONSTRAINT ck_orders_product;
ALTER TABLE orders ADD CONSTRAINT ck_orders_product CHECK (
  amount > 0 AND currency='cny' AND (
    (plan_id IS NULL AND credits IS NULL AND seconds IS NOT NULL AND count IS NOT NULL AND seconds IN (15,30,60) AND count IN (1,5,10)) OR
    (plan_id IS NOT NULL AND credits IS NOT NULL AND plan_id IN ('light','creator','plus') AND credits > 0 AND seconds IS NULL AND count IS NULL) OR
    (sku IN ('wallet-v2-light','wallet-v2-creator','wallet-v2-plus') AND plan_id IS NULL
      AND credits IS NULL AND seconds IS NULL AND count IS NULL)
  )
);

CREATE TABLE billing_wallets (
  user_id VARCHAR NOT NULL REFERENCES users(id),
  environment VARCHAR NOT NULL CHECK (environment IN ('real_usage','stripe_sandbox')),
  available_fen BIGINT NOT NULL DEFAULT 0 CHECK (available_fen >= 0),
  reserved_fen BIGINT NOT NULL DEFAULT 0 CHECK (reserved_fen >= 0),
  spent_fen BIGINT NOT NULL DEFAULT 0 CHECK (spent_fen >= 0),
  PRIMARY KEY (user_id, environment)
);
CREATE TABLE billing_charges (
  id VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  environment VARCHAR NOT NULL,
  scene VARCHAR NOT NULL CHECK (scene IN ('studio','video','prompt')),
  version VARCHAR NOT NULL CHECK (version='wallet-v2'),
  reserved_ms BIGINT NOT NULL CHECK (reserved_ms > 0 AND reserved_ms <= 30000),
  reserved_fen BIGINT NOT NULL CHECK (reserved_fen > 0),
  settled_ms BIGINT CHECK (settled_ms >= 0 AND settled_ms <= reserved_ms),
  charged_fen BIGINT CHECK (charged_fen >= 0 AND charged_fen <= reserved_fen),
  state VARCHAR NOT NULL CHECK (state IN ('reserved','review','settled','released')),
  created_at BIGINT NOT NULL,
  settled_at BIGINT,
  FOREIGN KEY (user_id, environment) REFERENCES billing_wallets(user_id, environment)
);
CREATE INDEX ix_billing_charges_user ON billing_charges(user_id, environment, created_at DESC);
CREATE TABLE billing_entries (
  operation_key VARCHAR PRIMARY KEY,
  user_id VARCHAR NOT NULL,
  environment VARCHAR NOT NULL,
  kind VARCHAR NOT NULL CHECK (kind IN ('topup','reserve','settle','release')),
  available_delta BIGINT NOT NULL,
  reserved_delta BIGINT NOT NULL,
  spent_delta BIGINT NOT NULL,
  paid_fen BIGINT,
  bonus_fen BIGINT,
  created_at BIGINT NOT NULL,
  FOREIGN KEY (user_id, environment) REFERENCES billing_wallets(user_id, environment)
);
