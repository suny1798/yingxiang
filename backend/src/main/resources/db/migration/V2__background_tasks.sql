-- M17：持久后台任务、租约与故障门禁；不改V1既有业务表语义。
CREATE TABLE background_tasks (
	id VARCHAR NOT NULL,
	type VARCHAR NOT NULL,
	user_id VARCHAR NOT NULL,
	resource_id VARCHAR NOT NULL,
	dedupe_key VARCHAR NOT NULL,
	state VARCHAR NOT NULL,
	attempts INTEGER DEFAULT '0' NOT NULL,
	max_attempts INTEGER DEFAULT '3' NOT NULL,
	next_run_at BIGINT NOT NULL,
	lease_owner VARCHAR,
	lease_until BIGINT,
	lease_generation BIGINT DEFAULT '0' NOT NULL,
	last_error_code VARCHAR,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT pk_background_tasks PRIMARY KEY (id),
	CONSTRAINT uq_background_tasks_dedupe UNIQUE (dedupe_key),
	CONSTRAINT ck_background_tasks_type CHECK (type IN ('video-save','capture-finish','cleanup')),
	CONSTRAINT ck_background_tasks_state CHECK (state IN ('pending','running','succeeded','failed','cancelled')),
	CONSTRAINT ck_background_tasks_attempts CHECK (attempts >= 0 AND max_attempts > 0 AND lease_generation >= 0),
	CONSTRAINT fk_background_tasks_user_id_users FOREIGN KEY(user_id) REFERENCES users (id)
);

CREATE INDEX ix_background_tasks_claim ON background_tasks (state, next_run_at);

CREATE INDEX ix_background_tasks_resource ON background_tasks (type, resource_id);

CREATE TABLE rate_limit_shadows (
	key VARCHAR NOT NULL,
	count INTEGER NOT NULL,
	until BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT pk_rate_limit_shadows PRIMARY KEY (key),
	CONSTRAINT ck_rate_limit_shadows_count CHECK (count >= 0)
);

CREATE TABLE rate_limit_gates (
	key VARCHAR NOT NULL,
	until BIGINT NOT NULL,
	reason VARCHAR NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT pk_rate_limit_gates PRIMARY KEY (key)
);

CREATE TABLE upload_slots (
	id VARCHAR NOT NULL,
	owner VARCHAR NOT NULL,
	lease_generation BIGINT DEFAULT '0' NOT NULL,
	lease_until BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT pk_upload_slots PRIMARY KEY (id),
	CONSTRAINT ck_upload_slots_generation CHECK (lease_generation >= 0)
);
