import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import config from '../config';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS stories (
    id TEXT PRIMARY KEY,
    status TEXT NOT NULL DEFAULT 'collecting',
    story_text TEXT,
    created_at TEXT NOT NULL,
    generated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS story_figures (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    story_id TEXT NOT NULL,
    uid TEXT NOT NULL,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    added_at TEXT NOT NULL,
    FOREIGN KEY (story_id) REFERENCES stories(id)
  );

  CREATE INDEX IF NOT EXISTS idx_story_figures_story_id ON story_figures(story_id);
`);

export default db;
