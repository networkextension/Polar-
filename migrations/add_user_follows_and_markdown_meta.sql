-- Add user_follows table and markdown_entries meta columns.
-- Safe to run multiple times.

CREATE TABLE IF NOT EXISTS user_follows (
    follower_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    followee_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL,
    PRIMARY KEY (follower_user_id, followee_user_id),
    CHECK (follower_user_id <> followee_user_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_followee
    ON user_follows (followee_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_user_follows_follower
    ON user_follows (follower_user_id, created_at DESC);

ALTER TABLE markdown_entries
    ADD COLUMN IF NOT EXISTS summary TEXT NOT NULL DEFAULT '';
ALTER TABLE markdown_entries
    ADD COLUMN IF NOT EXISTS cover_url TEXT NOT NULL DEFAULT '';
