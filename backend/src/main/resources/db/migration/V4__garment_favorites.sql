-- 仅保存本人收藏的公开衣装ID；不复制图像或影响生成权益。
CREATE TABLE garment_favorites (
    user_id VARCHAR NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    garment_id VARCHAR(16) NOT NULL,
    created_at BIGINT NOT NULL,
    PRIMARY KEY (user_id, garment_id),
    CONSTRAINT ck_garment_favorites_id CHECK (garment_id ~ '^(SPR|SUM|AUT|WIN)-[0-9]{4}$')
);
