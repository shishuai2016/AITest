import { all, get, run, newId, transaction, jsonParse } from './db.js';
import { slugify } from './util.js';

export const DEFAULT_ACCENTS = ['#5B5BD6', '#E0562B', '#0F766E', '#B4457A', '#1D4ED8', '#D97706'];

export function mapProject(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    prompt: row.prompt,
    summary: row.summary,
    emoji: row.emoji,
    accent: row.accent,
    category: row.category,
    status: row.status,
    currentVersion: row.current_version,
    shareEnabled: Boolean(row.share_enabled),
    isSeed: Boolean(row.is_seed),
    workspaceId: row.workspace_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    thumb: row.current_version
      ? `/shots/${row.id}/${row.current_version}.png?v=${encodeURIComponent(row.updated_at)}`
      : '',
  };
}

export function projectCard(row, artifacts = []) {
  const project = mapProject(row);
  if (!project) return null;
  return {
    ...project,
    artifactKinds: artifacts.filter((a) => a.version === project.currentVersion).map((a) => a.kind),
  };
}

export function getProject(id) {
  return get('SELECT * FROM projects WHERE id = ?', id);
}

export function getProjectBySlug(slug) {
  return get('SELECT * FROM projects WHERE slug = ?', slug);
}

export function getVersion(projectId, number) {
  return get('SELECT * FROM versions WHERE project_id = ? AND number = ?', projectId, number);
}

export function listVersionMeta(projectId) {
  return all(
    'SELECT number, summary, prompt, model, usage, checks, created_at FROM versions WHERE project_id = ? ORDER BY number DESC',
    projectId,
  ).map((row) => ({
    number: row.number,
    summary: row.summary,
    prompt: row.prompt,
    model: row.model,
    usage: jsonParse(row.usage, {}),
    checks: jsonParse(row.checks, []),
    createdAt: row.created_at,
  }));
}

export function listMessages(projectId) {
  return all('SELECT * FROM messages WHERE project_id = ? ORDER BY created_at ASC, rowid ASC', projectId).map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    version: row.version,
    kind: row.kind,
    meta: jsonParse(row.meta, {}),
    createdAt: row.created_at,
  }));
}

export function addMessage({ projectId, role, content, version = null, kind = 'text', meta = {} }) {
  const at = new Date().toISOString();
  const id = newId('msg_');
  run(
    'INSERT INTO messages (id, project_id, role, content, version, kind, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    projectId,
    role,
    content,
    version,
    kind,
    JSON.stringify(meta),
    at,
  );
  return { id, role, content, version, kind, meta, createdAt: at };
}

export function createProject({ prompt, workspaceId = '', isSeed = false, name, summary = '', emoji = '✦', accent = DEFAULT_ACCENTS[0], category = '应用', slug = '', status = 'draft', shareEnabled = true }) {
  const at = new Date().toISOString();
  const id = newId('app_');
  const finalName = (name || shortName(prompt)).slice(0, 40);
  let finalSlug = slug || slugify(finalName);
  while (get('SELECT id FROM projects WHERE slug = ?', finalSlug)) {
    finalSlug = slugify(finalName);
  }
  run(
    `INSERT INTO projects (id, name, slug, prompt, summary, emoji, accent, category, status, current_version, share_enabled, is_seed, workspace_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`,
    id,
    finalName,
    finalSlug,
    prompt,
    summary,
    emoji,
    accent,
    category,
    status,
    shareEnabled ? 1 : 0,
    isSeed ? 1 : 0,
    workspaceId,
    at,
    at,
  );
  return get('SELECT * FROM projects WHERE id = ?', id);
}

export function shortName(prompt) {
  const clean = String(prompt || '新应用')
    .replace(/\s+/g, ' ')
    .replace(/^(帮我|请|我想要|我想|做一个|生成一个|创建一个|设计一个)/, '')
    .trim();
  return (clean.slice(0, 14) || '新应用').replace(/[，。,.!?！？].*$/, '') || '新应用';
}

export function maxVersion(projectId) {
  const row = get('SELECT MAX(number) AS n FROM versions WHERE project_id = ?', projectId);
  return row?.n || 0;
}

export function saveVersion({ projectId, files, summary, plan, prompt, model, usage, checks, design = {} }) {
  return transaction(() => {
    const next = maxVersion(projectId) + 1;
    const at = new Date().toISOString();
    const id = newId('v_');
    run(
      `INSERT INTO versions (id, project_id, number, files, summary, plan, prompt, model, usage, checks, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      projectId,
      next,
      JSON.stringify(files),
      summary || '',
      plan || '',
      prompt || '',
      model || '',
      JSON.stringify(usage || {}),
      JSON.stringify(checks || []),
      at,
    );
    const current = getProject(projectId);
    const name = design.name && current.current_version === 0 ? design.name.slice(0, 40) : current.name;
    const emoji = design.emoji || current.emoji;
    const accent = design.accent && /^#[0-9a-f]{6}$/i.test(design.accent) ? design.accent : current.accent;
    const category = design.category || current.category;
    const projectSummary = summary || current.summary;
    run(
      `UPDATE projects SET name = ?, summary = ?, emoji = ?, accent = ?, category = ?, status = 'ready',
       current_version = ?, updated_at = ? WHERE id = ?`,
      name,
      projectSummary,
      emoji,
      accent,
      category,
      next,
      at,
      projectId,
    );
    return get('SELECT * FROM versions WHERE id = ?', id);
  });
}

export function updateProjectStatus(projectId, status) {
  run('UPDATE projects SET status = ?, updated_at = ? WHERE id = ?', status, new Date().toISOString(), projectId);
}

export function updateProjectMeta(projectId, fields) {
  const parts = [];
  const values = [];
  for (const [key, value] of Object.entries(fields)) {
    if (['name', 'summary', 'emoji', 'accent', 'category', 'share_enabled', 'status'].includes(key)) {
      parts.push(`${key} = ?`);
      values.push(typeof value === 'boolean' ? (value ? 1 : 0) : value);
    }
  }
  if (!parts.length) return;
  parts.push('updated_at = ?');
  values.push(new Date().toISOString(), projectId);
  run(`UPDATE projects SET ${parts.join(', ')} WHERE id = ?`, ...values);
}

export function upsertArtifact({ projectId, version, kind, title, content, status = 'ready' }) {
  const at = new Date().toISOString();
  const existing = get('SELECT id FROM artifacts WHERE project_id = ? AND version = ? AND kind = ?', projectId, version, kind);
  if (existing) {
    run('UPDATE artifacts SET title = ?, content = ?, status = ?, updated_at = ? WHERE id = ?', title, JSON.stringify(content), status, at, existing.id);
    return get('SELECT * FROM artifacts WHERE id = ?', existing.id);
  }
  const id = newId('art_');
  run(
    'INSERT INTO artifacts (id, project_id, version, kind, title, content, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id,
    projectId,
    version,
    kind,
    title,
    JSON.stringify(content),
    status,
    at,
    at,
  );
  return get('SELECT * FROM artifacts WHERE id = ?', id);
}

export function getArtifacts(projectId, version = null) {
  const rows = version
    ? all('SELECT * FROM artifacts WHERE project_id = ? AND version = ? ORDER BY created_at', projectId, version)
    : all('SELECT * FROM artifacts WHERE project_id = ? ORDER BY version DESC, created_at', projectId);
  return rows.map((row) => ({
    id: row.id,
    projectId: row.project_id,
    version: row.version,
    kind: row.kind,
    title: row.title,
    status: row.status,
    content: jsonParse(row.content, {}),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

export function listProjectCards({ seeds = false, limit = 30 } = {}) {
  const rows = seeds
    ? all('SELECT * FROM projects WHERE is_seed = 1 ORDER BY created_at ASC LIMIT ?', limit)
    : all('SELECT * FROM projects WHERE is_seed = 0 AND status = ? ORDER BY updated_at DESC LIMIT ?', 'ready', limit);
  return rows.map((row) => {
    const artifacts = getArtifacts(row.id, row.current_version);
    return projectCard(row, artifacts);
  });
}

export function projectStats() {
  const projects = get('SELECT COUNT(*) AS n FROM projects WHERE is_seed = 0')?.n || 0;
  const seeds = get('SELECT COUNT(*) AS n FROM projects WHERE is_seed = 1')?.n || 0;
  const versions = get('SELECT COUNT(*) AS n FROM versions')?.n || 0;
  const artifacts = get('SELECT COUNT(*) AS n FROM artifacts')?.n || 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayProjects = get('SELECT COUNT(*) AS n FROM projects WHERE is_seed = 0 AND created_at >= ?', today.toISOString())?.n || 0;
  return { projects, seeds, versions, artifacts, todayProjects, totalProjects: projects + seeds };
}

export function deleteProject(projectId) {
  transaction(() => {
    run('DELETE FROM versions WHERE project_id = ?', projectId);
    run('DELETE FROM messages WHERE project_id = ?', projectId);
    run('DELETE FROM jobs WHERE project_id = ?', projectId);
    run('DELETE FROM artifacts WHERE project_id = ?', projectId);
    run('DELETE FROM app_store WHERE project_id = ?', projectId);
    run('DELETE FROM projects WHERE id = ?', projectId);
  });
}
