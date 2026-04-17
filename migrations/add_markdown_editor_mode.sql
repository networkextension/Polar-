-- Add editor_mode hint column to markdown_entries.
-- The column records which front-end editor wrote the entry
-- ('markdown' for the source editor, 'rich' for the WYSIWYG editor).
-- Storage stays uniform (markdown text); this is just a UI hint.
-- Safe to run multiple times.

ALTER TABLE markdown_entries
    ADD COLUMN IF NOT EXISTS editor_mode TEXT NOT NULL DEFAULT 'markdown';
