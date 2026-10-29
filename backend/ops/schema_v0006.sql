-- 旧SQLite revision 0006 的冻结结构，仅用于 M21-a 合成源与导入/恢复工具测试。
-- 来源：backend/data/yingxiang.sqlite3 的 sqlite_master（只读导出），不新增业务表。
-- FastAPI/Alembic 运行时已在 M25 退役；本文件是该版本的只读结构快照。

CREATE TABLE alembic_version (
	version_num VARCHAR(32) NOT NULL, 
	CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);
CREATE TABLE users (
	id VARCHAR NOT NULL, 
	username VARCHAR NOT NULL, 
	salt VARCHAR NOT NULL, 
	password_hash VARCHAR NOT NULL, 
	algorithm VARCHAR DEFAULT 'scrypt-n16384-r8-p1-dk64' NOT NULL, 
	created_at BIGINT NOT NULL, role VARCHAR NOT NULL DEFAULT 'user' CONSTRAINT ck_users_role CHECK (role IN ('user','admin')), disabled INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_users_disabled CHECK (disabled IN (0,1)), 
	CONSTRAINT pk_users PRIMARY KEY (id), 
	CONSTRAINT uq_users_username UNIQUE (username)
);
CREATE TABLE auth_rate_limits (
	"key" VARCHAR NOT NULL, 
	count INTEGER NOT NULL, 
	until BIGINT NOT NULL, 
	CONSTRAINT pk_auth_rate_limits PRIMARY KEY ("key"), 
	CONSTRAINT ck_auth_rate_limits_count CHECK (count >= 0)
);
CREATE TABLE budget_campaigns (
	scene VARCHAR NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_budget_campaigns PRIMARY KEY (scene), 
	CONSTRAINT ck_budget_campaigns_scene CHECK (scene IN ('prompt','video'))
);
CREATE TABLE migration_imports (
	fingerprint VARCHAR NOT NULL, 
	importer_version VARCHAR NOT NULL, 
	manifest TEXT NOT NULL, 
	summary TEXT NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_migration_imports PRIMARY KEY (fingerprint)
);
CREATE TABLE scene_access (
	scene VARCHAR NOT NULL, 
	value VARCHAR NOT NULL, 
	CONSTRAINT pk_scene_access PRIMARY KEY (scene)
);
CREATE TABLE auth_sessions (
	hash VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	expires_at BIGINT NOT NULL, 
	CONSTRAINT pk_auth_sessions PRIMARY KEY (hash), 
	CONSTRAINT fk_auth_sessions_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE entitlement_grants (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	seconds INTEGER NOT NULL, 
	environment VARCHAR NOT NULL, 
	source VARCHAR NOT NULL, 
	source_key VARCHAR NOT NULL, 
	total INTEGER NOT NULL, 
	reserved INTEGER DEFAULT '0' NOT NULL, 
	used INTEGER DEFAULT '0' NOT NULL, 
	revoked INTEGER DEFAULT '0' NOT NULL, 
	CONSTRAINT pk_entitlement_grants PRIMARY KEY (id), 
	CONSTRAINT ck_entitlement_grants_duration CHECK (seconds IN (15,30,60)), 
	CONSTRAINT ck_entitlement_grants_environment CHECK (environment IN ('real_usage','stripe_sandbox')), 
	CONSTRAINT ck_entitlement_grants_balance CHECK (total >= 0 AND reserved >= 0 AND used >= 0 AND revoked >= 0 AND reserved+used+revoked <= total), 
	CONSTRAINT fk_entitlement_grants_user_id_users FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT uq_entitlement_grants_source_key UNIQUE (source_key)
);
CREATE TABLE budget_reservations (
	id VARCHAR NOT NULL, 
	scene VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	micro_usd BIGINT NOT NULL, 
	lease_until BIGINT NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_budget_reservations PRIMARY KEY (id), 
	CONSTRAINT ck_budget_reservations_amount CHECK (micro_usd > 0), 
	CONSTRAINT fk_budget_reservations_scene_budget_campaigns FOREIGN KEY(scene) REFERENCES budget_campaigns (scene), 
	CONSTRAINT fk_budget_reservations_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE video_jobs (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	state VARCHAR NOT NULL, 
	created_at BIGINT NOT NULL, 
	expires_at BIGINT NOT NULL, 
	seconds_milli INTEGER NOT NULL, 
	micro_usd BIGINT NOT NULL, 
	provider_id VARCHAR, 
	checked_at BIGINT, 
	CONSTRAINT pk_video_jobs PRIMARY KEY (id), 
	CONSTRAINT ck_video_jobs_state CHECK (state IN ('submitting','unknown','pending','processing','completed','failed')), 
	CONSTRAINT fk_video_jobs_user_id_users FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT uq_video_jobs_provider_id UNIQUE (provider_id)
);
CREATE TABLE entitlement_entries (
	id VARCHAR NOT NULL, 
	grant_id VARCHAR NOT NULL, 
	operation_key VARCHAR NOT NULL, 
	kind VARCHAR NOT NULL, 
	quantity INTEGER NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_entitlement_entries PRIMARY KEY (id), 
	CONSTRAINT ck_entitlement_entries_kind CHECK (kind IN ('grant','reserve','consume','revoke')), 
	CONSTRAINT ck_entitlement_entries_quantity CHECK (quantity > 0), 
	CONSTRAINT fk_entitlement_entries_grant_id_entitlement_grants FOREIGN KEY(grant_id) REFERENCES entitlement_grants (id), 
	CONSTRAINT uq_entitlement_entries_operation_key UNIQUE (operation_key)
);
CREATE TABLE usage_attempts (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	grant_id VARCHAR, 
	scene VARCHAR NOT NULL, 
	seconds INTEGER NOT NULL, 
	state VARCHAR NOT NULL, 
	account_state VARCHAR, 
	created_at BIGINT NOT NULL, 
	updated_at BIGINT, 
	observation TEXT, 
	outcome VARCHAR, 
	CONSTRAINT pk_usage_attempts PRIMARY KEY (id), 
	CONSTRAINT ck_usage_attempts_scene CHECK (scene IN ('studio','prompt')), 
	CONSTRAINT ck_usage_attempts_state CHECK (state IN ('reserved','unknown','issued','finished')), 
	CONSTRAINT ck_usage_attempts_account_state CHECK (account_state IS NULL OR account_state IN ('review','used')), 
	CONSTRAINT fk_usage_attempts_user_id_users FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT fk_usage_attempts_grant_id_entitlement_grants FOREIGN KEY(grant_id) REFERENCES entitlement_grants (id)
);
CREATE TABLE video_history (
	job_id VARCHAR NOT NULL, 
	title VARCHAR(60) NOT NULL, 
	archived INTEGER DEFAULT '0' NOT NULL, 
	updated_at BIGINT NOT NULL, 
	CONSTRAINT pk_video_history PRIMARY KEY (job_id), 
	CONSTRAINT ck_video_history_ck_video_history_title CHECK (length(title) BETWEEN 1 AND 60), 
	CONSTRAINT ck_video_history_ck_video_history_archived CHECK (archived IN (0,1)), 
	CONSTRAINT fk_video_history_job_id_video_jobs FOREIGN KEY(job_id) REFERENCES video_jobs (id)
);
CREATE TABLE "orders" (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	request_id VARCHAR NOT NULL, 
	sku VARCHAR NOT NULL, 
	seconds INTEGER, 
	count INTEGER, 
	amount INTEGER NOT NULL, 
	currency VARCHAR NOT NULL, 
	state VARCHAR NOT NULL, 
	created_at BIGINT NOT NULL, 
	session_id VARCHAR, 
	checkout_url TEXT, 
	expires_at BIGINT, 
	fulfilled_at BIGINT, 
	request_snapshot TEXT, 
	template_version VARCHAR DEFAULT 'node-v1' NOT NULL, 
	plan_id VARCHAR, 
	credits INTEGER, 
	CONSTRAINT pk_orders PRIMARY KEY (id), 
	CONSTRAINT uq_orders_user_id UNIQUE (user_id, request_id), 
	CONSTRAINT ck_orders_state CHECK (state IN ('creating','pending','paid','failed','expired')), 
	CONSTRAINT fk_orders_user_id_users FOREIGN KEY(user_id) REFERENCES users (id), 
	CONSTRAINT uq_orders_session_id UNIQUE (session_id), 
	CONSTRAINT ck_orders_product CHECK (amount > 0 AND currency='cny' AND ((plan_id IS NULL AND credits IS NULL AND seconds IS NOT NULL AND count IS NOT NULL AND seconds IN (15,30,60) AND count IN (1,5,10)) OR (plan_id IS NOT NULL AND plan_id IN ('light','creator','plus') AND credits IS NOT NULL AND credits > 0 AND seconds IS NULL AND count IS NULL)))
);
CREATE TABLE payment_events (
	id VARCHAR NOT NULL, 
	order_id VARCHAR, 
	source VARCHAR NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_payment_events PRIMARY KEY (id), 
	CONSTRAINT fk_payment_events_order_id_orders FOREIGN KEY(order_id) REFERENCES orders (id)
);
CREATE TABLE sandbox_credit_packs (
	order_id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	plan_id VARCHAR NOT NULL, 
	credits INTEGER NOT NULL, 
	scenes TEXT NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_sandbox_credit_packs PRIMARY KEY (order_id), 
	CONSTRAINT ck_sandbox_credit_packs_ck_sandbox_credit_packs_credits CHECK (credits > 0), 
	CONSTRAINT fk_sandbox_credit_packs_order_id_orders FOREIGN KEY(order_id) REFERENCES orders (id), 
	CONSTRAINT fk_sandbox_credit_packs_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE admin_audit (
	id VARCHAR NOT NULL, 
	request_id VARCHAR NOT NULL, 
	actor_id VARCHAR NOT NULL, 
	action VARCHAR NOT NULL, 
	target VARCHAR NOT NULL, 
	reason VARCHAR NOT NULL, 
	changes TEXT NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_admin_audit PRIMARY KEY (id), 
	CONSTRAINT uq_admin_audit_request_id UNIQUE (request_id), 
	CONSTRAINT fk_admin_audit_actor_id_users FOREIGN KEY(actor_id) REFERENCES users (id)
);
CREATE TABLE admin_settings (
	"key" VARCHAR NOT NULL, 
	value TEXT NOT NULL, 
	version INTEGER DEFAULT '0' NOT NULL, 
	CONSTRAINT pk_admin_settings PRIMARY KEY ("key")
);
CREATE TABLE works (
	id VARCHAR NOT NULL, 
	user_id VARCHAR NOT NULL, 
	kind VARCHAR NOT NULL, 
	source_id VARCHAR, 
	title VARCHAR(60) NOT NULL, 
	state VARCHAR NOT NULL, 
	mime VARCHAR NOT NULL, 
	extension VARCHAR NOT NULL, 
	bytes BIGINT DEFAULT '0' NOT NULL, 
	chunks INTEGER DEFAULT '0' NOT NULL, 
	duration_ms INTEGER DEFAULT '0' NOT NULL, 
	created_at BIGINT NOT NULL, 
	updated_at BIGINT NOT NULL, 
	error_code VARCHAR, 
	retries INTEGER DEFAULT '0' NOT NULL, favorite INTEGER NOT NULL DEFAULT 0 CONSTRAINT ck_works_favorite CHECK (favorite IN (0,1)), 
	CONSTRAINT pk_works PRIMARY KEY (id), 
	CONSTRAINT uq_works_kind UNIQUE (kind, source_id), 
	CONSTRAINT ck_works_kind CHECK (kind IN ('realtime','video','edit')), 
	CONSTRAINT ck_works_state CHECK (state IN ('capturing','waiting','saving','ready','failed','deleted')), 
	CONSTRAINT ck_works_media CHECK (extension IN ('mp4','webm') AND bytes >= 0 AND chunks >= 0), 
	CONSTRAINT fk_works_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);
CREATE TABLE work_references (
	id VARCHAR NOT NULL, 
	work_id VARCHAR NOT NULL, 
	mime VARCHAR NOT NULL, 
	extension VARCHAR NOT NULL, 
	bytes BIGINT NOT NULL, 
	created_at BIGINT NOT NULL, 
	CONSTRAINT pk_work_references PRIMARY KEY (id), 
	CONSTRAINT fk_work_references_work_id_works FOREIGN KEY(work_id) REFERENCES works (id)
);
CREATE INDEX ix_auth_sessions_user_id ON auth_sessions (user_id);
CREATE INDEX ix_entitlement_grants_user_id ON entitlement_grants (user_id);
CREATE INDEX ix_sandbox_credit_packs_user_id ON sandbox_credit_packs (user_id);
CREATE INDEX ix_works_user_id ON works (user_id);
CREATE INDEX ix_work_references_work_id ON work_references (work_id);
CREATE INDEX ix_works_user_favorite_created ON works (user_id, favorite, created_at);
