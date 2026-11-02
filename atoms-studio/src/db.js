import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';

const DATA_DIR = process.env.DATA_DIR || path.resolve('data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'atoms.db');

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');
db.exec('PRAGMA busy_timeout = 5000;');

db.exec(`
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  prompt TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  emoji TEXT NOT NULL DEFAULT '✦',
  accent TEXT NOT NULL DEFAULT '#5B5BD6',
  category TEXT NOT NULL DEFAULT '应用',
  status TEXT NOT NULL DEFAULT 'draft',
  current_version INTEGER NOT NULL DEFAULT 0,
  share_enabled INTEGER NOT NULL DEFAULT 1,
  is_seed INTEGER NOT NULL DEFAULT 0,
  workspace_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS versions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  number INTEGER NOT NULL,
  files TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  plan TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL DEFAULT '',
  model TEXT NOT NULL DEFAULT '',
  usage TEXT NOT NULL DEFAULT '{}',
  checks TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  UNIQUE(project_id, number)
);

CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  version INTEGER,
  kind TEXT NOT NULL DEFAULT 'text',
  meta TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'generate',
  status TEXT NOT NULL DEFAULT 'queued',
  prompt TEXT NOT NULL DEFAULT '',
  steps TEXT NOT NULL DEFAULT '[]',
  stream_tail TEXT NOT NULL DEFAULT '',
  error TEXT NOT NULL DEFAULT '',
  version INTEGER,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS artifacts (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'ready',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(project_id, version, kind)
);

CREATE TABLE IF NOT EXISTS app_store (
  project_id TEXT NOT NULL,
  key TEXT NOT NULL,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY(project_id, key)
);

CREATE TABLE IF NOT EXISTS llm_calls (
  id TEXT PRIMARY KEY,
  project_id TEXT,
  purpose TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_ms INTEGER NOT NULL DEFAULT 0,
  ok INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_versions_project ON versions(project_id, number DESC);
CREATE INDEX IF NOT EXISTS idx_messages_project ON messages(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON jobs(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_artifacts_project ON artifacts(project_id, version, kind);
`);

// Any job left running when the process died is no longer recoverable.
db.prepare(`UPDATE jobs SET status = 'error', error = '服务重启，任务已中断', updated_at = ? WHERE status IN ('queued','running')`).run(
  new Date().toISOString(),
);

export function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
export function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
export function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
export function transaction(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function newId(prefix = '') {
  return prefix + crypto.randomBytes(9).toString('hex');
}

export function jsonParse(value, fallback) {
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function recordLlmCall({ projectId, purpose, model, promptTokens = 0, completionTokens = 0, latencyMs = 0, ok = true }) {
  run(
    `INSERT INTO llm_calls (id, project_id, purpose, model, prompt_tokens, completion_tokens, latency_ms, ok, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    newId('llm_'),
    projectId || null,
    purpose,
    model,
    promptTokens,
    completionTokens,
    latencyMs,
    ok ? 1 : 0,
    new Date().toISOString(),
  );
}

export { DATA_DIR, DB_PATH };
