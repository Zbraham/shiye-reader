import { describe, expect, it } from 'vitest'
import { migrate, SCHEMA_VERSION } from '@main/db/schema'
import { openDatabase } from '@main/db/sqlite'

/** The three tables touched by the v1 -> v2 migration, with v1 columns. */
const V1_SQL = `
CREATE TABLE projects (
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
CREATE TABLE chapters (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
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
  updated_at INTEGER NOT NULL
);
CREATE TABLE directives (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  scope TEXT NOT NULL,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL,
  applied_chapter INTEGER,
  expires_chapter INTEGER
);
INSERT INTO projects (id, title, created_at, updated_at) VALUES ('p1', '旧书', 1, 1);
INSERT INTO chapters (id, project_id, idx, title, content, updated_at)
  VALUES ('c1', 'p1', 1, '第1章', '旧正文', 1);
INSERT INTO directives (id, project_id, scope, content, created_at)
  VALUES ('d1', 'p1', '本章', '旧指令', 1);
`

describe('schema migration', () => {
  it('upgrades a v1 database without losing rows and fills new defaults', () => {
    const db = openDatabase(':memory:')
    try {
      db.exec(V1_SQL)
      db.exec('PRAGMA user_version = 1')

      migrate(db)

      const rows = db.queryPragma('user_version') as unknown[]
      const first = rows[0]
      const version =
        first && typeof first === 'object'
          ? Object.values(first as Record<string, unknown>)[0]
          : first
      expect(Number(version)).toBe(SCHEMA_VERSION)

      const project = db
        .prepare('SELECT source, imported_at, original_file FROM projects WHERE id = ?')
        .get('p1') as Record<string, unknown>
      expect(project.source).toBe('generated')
      expect(project.imported_at).toBeNull()
      expect(project.original_file).toBe('')

      const chapter = db
        .prepare('SELECT seed_prefix, content FROM chapters WHERE id = ?')
        .get('c1') as Record<string, unknown>
      expect(chapter.seed_prefix).toBe('')
      expect(chapter.content).toBe('旧正文')

      const directive = db
        .prepare('SELECT starts_chapter, origin FROM directives WHERE id = ?')
        .get('d1') as Record<string, unknown>
      expect(directive.starts_chapter).toBeNull()
      expect(directive.origin).toBe('user')

      // Running migrate again on a current database is a no-op.
      migrate(db)
    } finally {
      db.close()
    }
  })
})
