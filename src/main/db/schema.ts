import type { DatabaseHandle } from './sqlite'

export const SCHEMA_VERSION = 1

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  theme_prompt TEXT NOT NULL DEFAULT '',
  genre TEXT NOT NULL DEFAULT '',
  tone TEXT NOT NULL DEFAULT '',
  pov TEXT NOT NULL DEFAULT '',
  style_guide TEXT NOT NULL DEFAULT '',
  style_sample TEXT NOT NULL DEFAULT '',
  target_len_per_chapter INTEGER NOT NULL DEFAULT 2000,
  synopsis TEXT NOT NULL DEFAULT '',
  selling_point TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_chapter_idx INTEGER NOT NULL DEFAULT 1,
  last_offset_ratio REAL NOT NULL DEFAULT 0,
  buffer INTEGER NOT NULL DEFAULT 2,
  chapter_min INTEGER NOT NULL DEFAULT 1800,
  chapter_max INTEGER NOT NULL DEFAULT 2600
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'outline',
  content TEXT NOT NULL DEFAULT '',
  word_count INTEGER NOT NULL DEFAULT 0,
  summary_l1 TEXT NOT NULL DEFAULT '',
  summary_l2 TEXT NOT NULL DEFAULT '',
  outline_json TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 0,
  generated_at INTEGER,
  stale_reason TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  issues_json TEXT NOT NULL DEFAULT '[]',
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, idx)
);

CREATE INDEX IF NOT EXISTS idx_chapters_project ON chapters(project_id, idx);
CREATE INDEX IF NOT EXISTS idx_chapters_status ON chapters(project_id, status);

CREATE TABLE IF NOT EXISTS chunks (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  idx INTEGER NOT NULL,
  start_off INTEGER NOT NULL,
  end_off INTEGER NOT NULL,
  text TEXT NOT NULL,
  role_tag TEXT NOT NULL,
  hash TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chunks_chapter ON chunks(chapter_id, idx);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  aliases_json TEXT NOT NULL DEFAULT '[]',
  profile TEXT NOT NULL DEFAULT '',
  state_json TEXT NOT NULL DEFAULT '{}',
  first_chapter INTEGER NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS idx_characters_project ON characters(project_id);

CREATE TABLE IF NOT EXISTS story_state (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, key)
);

CREATE TABLE IF NOT EXISTS directives (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  applied_chapter INTEGER,
  expires_chapter INTEGER
);

CREATE INDEX IF NOT EXISTS idx_directives_project ON directives(project_id, status);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  content TEXT NOT NULL,
  diff_json TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  before_word_count INTEGER NOT NULL DEFAULT 0,
  after_word_count INTEGER NOT NULL DEFAULT 0,
  UNIQUE(chapter_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_versions_chapter ON versions(chapter_id, seq);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  project_id TEXT NOT NULL DEFAULT '',
  chapter_id TEXT,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',
  progress REAL NOT NULL DEFAULT 0,
  error TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs(created_at);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL DEFAULT '',
  chapter_idx INTEGER NOT NULL DEFAULT 0,
  task TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_log(created_at);
`

export function migrate(db: DatabaseHandle): void {
  const rows = db.queryPragma('user_version')
  const first = rows[0]
  let version = 0
  if (first && typeof first === 'object') {
    const value = Object.values(first)[0]
    version = Number(value) || 0
  } else {
    version = Number(first) || 0
  }

  if (version < 1) {
    db.exec(SCHEMA_SQL)
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`)
  }
  if (version > SCHEMA_VERSION) {
    throw new Error('数据库版本高于当前应用版本')
  }
}
