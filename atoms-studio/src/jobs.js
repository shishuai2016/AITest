import { get, jsonParse, newId, run } from './db.js';

/**
 * In-process event hub for generation jobs. Events are replayed to clients that
 * subscribe late (e.g. after a page refresh), and the step list is mirrored to
 * SQLite so job progress survives a page reload.
 */
const live = new Map();

export function createJob({ projectId, kind = 'generate', prompt = '' }) {
  const id = newId('job_');
  const at = new Date().toISOString();
  run(
    `INSERT INTO jobs (id, project_id, kind, status, prompt, steps, created_at, updated_at)
     VALUES (?, ?, ?, 'queued', ?, '[]', ?, ?)`,
    id,
    projectId,
    kind,
    prompt,
    at,
    at,
  );
  live.set(id, { id, projectId, kind, status: 'queued', events: [], subscribers: new Set(), steps: [] });
  return id;
}

export function getLiveJob(id) {
  return live.get(id) || null;
}

export function getJobRow(id) {
  return get('SELECT * FROM jobs WHERE id = ?', id);
}

export function activeJobForProject(projectId) {
  for (const job of live.values()) {
    if (job.projectId === projectId && (job.status === 'queued' || job.status === 'running')) return job.id;
  }
  const row = get(
    `SELECT id FROM jobs WHERE project_id = ? AND status IN ('queued','running') ORDER BY created_at DESC LIMIT 1`,
    projectId,
  );
  return row?.id || null;
}

function writeEvent(job, event) {
  const enriched = { ...event, at: new Date().toISOString() };
  job.events.push(enriched);
  const payload = JSON.stringify(enriched);
  for (const res of job.subscribers) {
    try {
      res.write(`id: ${job.events.length}\n`);
      res.write(`data: ${payload}\n\n`);
    } catch {
      job.subscribers.delete(res);
    }
  }
  return enriched;
}

export function emitJobEvent(jobId, event) {
  const job = live.get(jobId);
  if (!job) return;
  if (event.type === 'steps') {
    job.steps = event.steps;
    run(
      'UPDATE jobs SET steps = ?, status = ?, updated_at = ? WHERE id = ?',
      JSON.stringify(event.steps),
      event.status || job.status,
      new Date().toISOString(),
      jobId,
    );
  }
  if (event.type === 'status' && event.status) {
    job.status = event.status;
    run('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?', event.status, new Date().toISOString(), jobId);
  }
  if (event.type === 'delta' && event.text) {
    // Keep a short tail in SQLite so a refreshed UI can show what was streaming.
    const tail = (job.streamTail || '') + event.text;
    job.streamTail = tail.slice(-4000);
    if (!job.lastTailWrite || Date.now() - job.lastTailWrite > 1500) {
      job.lastTailWrite = Date.now();
      run('UPDATE jobs SET stream_tail = ?, updated_at = ? WHERE id = ?', job.streamTail, new Date().toISOString(), jobId);
    }
  }
  writeEvent(job, event);
}

export function finishJob(jobId, status, extra = {}) {
  const job = live.get(jobId);
  if (!job) return;
  job.status = status;
  const at = new Date().toISOString();
  const versionNumber = typeof extra.version === 'object' && extra.version !== null ? extra.version.number || null : extra.version || null;
  run(
    'UPDATE jobs SET status = ?, error = ?, version = ?, updated_at = ? WHERE id = ?',
    status,
    extra.error || '',
    versionNumber,
    at,
    jobId,
  );
  const event = status === 'done' ? { type: 'done', ...extra } : { type: 'error', message: extra.error || '生成失败' };
  writeEvent(job, event);
  for (const res of job.subscribers) {
    try {
      res.end();
    } catch {
      /* ignore */
    }
  }
  job.subscribers.clear();
  // Keep the event history around long enough for late subscribers.
  setTimeout(() => live.delete(jobId), 60 * 60 * 1000).unref?.();
}

export function subscribeJob(jobId, req, res) {
  const job = live.get(jobId);
  if (!job) {
    const row = getJobRow(jobId);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const status = row?.status || 'error';
    const steps = jsonParse(row?.steps || '[]', []);
    res.write(`data: ${JSON.stringify({ type: 'steps', steps, status })}\n\n`);
    if (status === 'done') {
      res.write(`data: ${JSON.stringify({ type: 'done', version: { number: row.version }, replay: true })}\n\n`);
    } else if (status === 'error') {
      res.write(`data: ${JSON.stringify({ type: 'error', message: row.error || '任务已结束' })}\n\n`);
    }
    res.end();
    return;
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write('retry: 2000\n\n');

  // Replay everything that happened before this subscriber connected.
  job.events.forEach((event, index) => {
    res.write(`id: ${index + 1}\n`);
    res.write(`data: ${JSON.stringify(event)}\n\n`);
  });

  if (job.status === 'done' || job.status === 'error') {
    res.end();
    return;
  }

  job.subscribers.add(res);
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    job.subscribers.delete(res);
  };
  req.on('close', cleanup);
  res.on('close', cleanup);
}
