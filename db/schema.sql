-- MCQs
CREATE TABLE IF NOT EXISTS mcqs (
  id TEXT PRIMARY KEY,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL,
  difficulty TEXT DEFAULT 'medium',
  question TEXT NOT NULL,
  option_a TEXT NOT NULL,
  option_b TEXT NOT NULL,
  option_c TEXT NOT NULL,
  option_d TEXT NOT NULL,
  answer INTEGER NOT NULL,
  explanation TEXT,
  hash TEXT UNIQUE NOT NULL,
  quality_score INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_subject ON mcqs(subject);
CREATE INDEX IF NOT EXISTS idx_chapter ON mcqs(chapter);
CREATE INDEX IF NOT EXISTS idx_created ON mcqs(created_at);

-- Generation tasks
CREATE TABLE IF NOT EXISTS generation_tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject TEXT NOT NULL,
  chapter TEXT NOT NULL,
  target_count INTEGER NOT NULL,
  generated_count INTEGER DEFAULT 0,
  status TEXT DEFAULT 'pending',
  retry_count INTEGER DEFAULT 0,
  last_error TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Audit log
CREATE TABLE IF NOT EXISTS audit_log (
  id TEXT PRIMARY KEY,
  event TEXT NOT NULL,
  ip_hash TEXT NOT NULL,
  details TEXT,
  timestamp INTEGER NOT NULL
);

-- 🆕 Bundle storage (replaces filesystem)
CREATE TABLE IF NOT EXISTS bundles (
  chapter TEXT PRIMARY KEY,
  version INTEGER NOT NULL DEFAULT 1,
  data BLOB NOT NULL,           -- gzip compressed JSON
  checksum TEXT,                -- SHA-256 of uncompressed JSON (for integrity)
  created_at INTEGER NOT NULL
);
