ALTER TABLE video_jobs ADD COLUMN result_duration_ms BIGINT;
ALTER TABLE video_jobs ADD CONSTRAINT ck_video_result_duration CHECK (result_duration_ms IS NULL OR result_duration_ms > 0);
