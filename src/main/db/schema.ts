import type { DatabaseHandle } from './sqlite'

export const SCHEMA_VERSION = 3

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
  chapter_max INTEGER NOT NULL DEFAULT 2600,
  source TEXT NOT NULL DEFAULT 'generated',
  imported_at INTEGER,
  original_file TEXT NOT NULL DEFAULT '',
  author TEXT NOT NULL DEFAULT '',
  series TEXT NOT NULL DEFAULT '',
  publisher TEXT NOT NULL DEFAULT '',
  language TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  rating INTEGER NOT NULL DEFAULT 0,
  read_status TEXT NOT NULL DEFAULT 'none',
  cover_data TEXT NOT NULL DEFAULT ''
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
  seed_prefix TEXT NOT NULL DEFAULT '',
  html TEXT NOT NULL DEFAULT '',
  volume TEXT NOT NULL DEFAULT '',
  level INTEGER NOT NULL DEFAULT 1,
  last_offset_ratio REAL NOT NULL DEFAULT 0,
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
  expires_chapter INTEGER,
  starts_chapter INTEGER,
  origin TEXT NOT NULL DEFAULT 'user'
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

CREATE TABLE IF NOT EXISTS bookmarks (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_id TEXT NOT NULL REFERENCES chapters(id) ON DELETE CASCADE,
  chapter_idx INTEGER NOT NULL,
  ratio REAL NOT NULL DEFAULT 0,
  label TEXT NOT NULL DEFAULT '',
  excerpt TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bookmarks_project ON bookmarks(project_id, chapter_idx, ratio);

CREATE TABLE IF NOT EXISTS reading_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id TEXT NOT NULL DEFAULT '',
  day TEXT NOT NULL,
  seconds INTEGER NOT NULL DEFAULT 0,
  words INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  UNIQUE(project_id, day)
);

CREATE INDEX IF NOT EXISTS idx_reading_log_day ON reading_log(day);

CREATE TABLE IF NOT EXISTS shelves (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS shelf_books (
  shelf_id TEXT NOT NULL REFERENCES shelves(id) ON DELETE CASCADE,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  PRIMARY KEY (shelf_id, project_id)
);

CREATE INDEX IF NOT EXISTS idx_shelf_books_project ON shelf_books(project_id);

CREATE TABLE IF NOT EXISTS analysis_events (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_idx INTEGER NOT NULL,
  story_time TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  detail TEXT NOT NULL DEFAULT '',
  characters_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_events_project ON analysis_events(project_id, chapter_idx);

CREATE TABLE IF NOT EXISTS analysis_knowledge (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_idx INTEGER NOT NULL,
  character TEXT NOT NULL DEFAULT '',
  fact TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_knowledge_project ON analysis_knowledge(project_id, chapter_idx);

CREATE TABLE IF NOT EXISTS analysis_issues (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_idx INTEGER NOT NULL,
  type TEXT NOT NULL DEFAULT 'logic',
  detail TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_issues_project ON analysis_issues(project_id, status);

CREATE TABLE IF NOT EXISTS analysis_foreshadows (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  planted_chapter INTEGER NOT NULL,
  payoff_chapter INTEGER,
  text TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_analysis_foreshadows_project ON analysis_foreshadows(project_id, status);

CREATE TABLE IF NOT EXISTS analysis_chapters (
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  chapter_idx INTEGER NOT NULL,
  analyzed_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, chapter_idx)
);
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
    return
  }

  if (version < 2) {
    db.exec(`
      ALTER TABLE projects ADD COLUMN source TEXT NOT NULL DEFAULT 'generated';
      ALTER TABLE projects ADD COLUMN imported_at INTEGER;
      ALTER TABLE projects ADD COLUMN original_file TEXT NOT NULL DEFAULT '';
      ALTER TABLE chapters ADD COLUMN seed_prefix TEXT NOT NULL DEFAULT '';
      ALTER TABLE directives ADD COLUMN starts_chapter INTEGER;
      ALTER TABLE directives ADD COLUMN origin TEXT NOT NULL DEFAULT 'user';
    `)
    version = 2
    db.exec('PRAGMA user_version = 2')
  }

  if (version < 3) {
    db.exec(`
      ALTER TABLE projects ADD COLUMN author TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN series TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN publisher TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN language TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN description TEXT NOT NULL DEFAULT '';
      ALTER TABLE projects ADD COLUMN tags_json TEXT NOT NULL DEFAULT '[]';
      ALTER TABLE projects ADD COLUMN rating INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE projects ADD COLUMN read_status TEXT NOT NULL DEFAULT 'none';
      ALTER TABLE projects ADD COLUMN cover_data TEXT NOT NULL DEFAULT '';
      ALTER TABLE chapters ADD COLUMN html TEXT NOT NULL DEFAULT '';
      ALTER TABLE chapters ADD COLUMN volume TEXT NOT NULL DEFAULT '';
      ALTER TABLE chapters ADD COLUMN level INTEGER NOT NULL DEFAULT 1;
      ALTER TABLE chapters ADD COLUMN last_offset_ratio REAL NOT NULL DEFAULT 0;
    `)
    // New tables use IF NOT EXISTS so the same script also upgrades v2 data.
    db.exec(SCHEMA_SQL)
    version = 3
    db.exec('PRAGMA user_version = 3')
  }

  if (version > SCHEMA_VERSION) {
    throw new Error('数据库版本高于当前应用版本')
  }
}
