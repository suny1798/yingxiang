-- M21-a：跨库全量导入批次与对象指纹；独立于旧 migration_imports，不改既有业务表。
CREATE TABLE import_batches (
	id VARCHAR NOT NULL,
	source_fingerprint VARCHAR NOT NULL,
	importer_version VARCHAR NOT NULL,
	status VARCHAR NOT NULL,
	source_manifest TEXT NOT NULL,
	summary TEXT NOT NULL,
	created_at BIGINT NOT NULL,
	updated_at BIGINT NOT NULL,
	CONSTRAINT pk_import_batches PRIMARY KEY (id),
	CONSTRAINT ck_import_batches_status CHECK (status IN ('importing','imported','verified','sealed','failed'))
);

CREATE INDEX ix_import_batches_fingerprint ON import_batches (source_fingerprint);

CREATE TABLE import_batch_objects (
	batch_id VARCHAR NOT NULL,
	kind VARCHAR NOT NULL,
	object_key VARCHAR NOT NULL,
	rows BIGINT,
	bytes BIGINT,
	sha256 VARCHAR NOT NULL,
	CONSTRAINT pk_import_batch_objects PRIMARY KEY (batch_id, kind, object_key),
	CONSTRAINT ck_import_batch_objects_kind CHECK (kind IN ('table','file')),
	CONSTRAINT fk_import_batch_objects_batch_id_import_batches FOREIGN KEY(batch_id) REFERENCES import_batches (id)
);
