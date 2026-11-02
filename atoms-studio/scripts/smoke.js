#!/usr/bin/env node
/**
 * Black-box smoke test for a running Atoms Studio instance.
 * Usage: node scripts/smoke.js [baseUrl]
 */
const BASE = (process.argv[2] || process.env.BASE_URL || 'http://127.0.0.1:4318').replace(/\/$/, '');
let passed = 0;
let failed = 0;
const results = [];

async function check(name, fn) {
  try {
    const detail = await fn();
    passed += 1;
    results.push({ name, ok: true, detail });
  } catch (error) {
    failed += 1;
    results.push({ name, ok: false, detail: String(error.message || error) });
  }
}

function expect(condition, message) {
  if (!condition) throw new Error(message);
}

const health = await fetch(`${BASE}/api/health`).then((r) => r.json());
await check('health endpoint', async () => {
  expect(health.ok === true, 'health not ok');
  return `uptime=${health.uptime}s llm=${health.llm?.enabled ? 'enabled' : 'fallback'}`;
});

const home = await fetch(`${BASE}/api/home`).then((r) => r.json());
await check('home data + seeds', async () => {
  expect(Array.isArray(home.seeds) && home.seeds.length >= 3, 'missing seeds');
  expect(home.templates?.length >= 6, 'missing templates');
  return `${home.seeds.length} seeds, ${home.templates.length} templates, quota ${home.llm?.usedToday}/${home.llm?.dailyLimit}`;
});

const seed = home.seeds[0];
await check('share page', async () => {
  const response = await fetch(`${BASE}/s/${seed.slug}`);
  const html = await response.text();
  expect(response.status === 200, `status ${response.status}`);
  expect(html.includes('<iframe') && html.includes(`/preview/${seed.id}/`), 'share page iframe missing');
  return `${seed.slug} -> HTTP ${response.status}`;
});

await check('preview + runtime injection', async () => {
  const response = await fetch(`${BASE}/preview/${seed.id}/${seed.currentVersion}/`);
  const html = await response.text();
  expect(response.status === 200, `status ${response.status}`);
  expect(html.includes('__ATOMS_APP__') && html.includes('/atoms-runtime.js'), 'runtime not injected');
  return `${(html.length / 1024).toFixed(1)} KB`;
});

await check('generated app store round-trip', async () => {
  const key = `smoke_${Date.now()}`;
  const put = await fetch(`${BASE}/api/apps/${seed.id}/store/${key}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ value: { ok: true, at: Date.now() } }),
  });
  const read = await fetch(`${BASE}/api/apps/${seed.id}/store/${key}`).then((r) => r.json());
  const del = await fetch(`${BASE}/api/apps/${seed.id}/store/${key}`, { method: 'DELETE' });
  expect(put.ok && read.value?.ok === true && del.ok, 'round-trip failed');
  return 'write -> read -> delete';
});

await check('artifact download (PRD + deck)', async () => {
  const artifacts = (await fetch(`${BASE}/api/projects/${seed.id}/artifacts`).then((r) => r.json())).artifacts;
  const prd = artifacts.find((a) => a.kind === 'prd');
  const slides = artifacts.find((a) => a.kind === 'slides');
  expect(prd && slides, 'artifacts missing');
  const prdRes = await fetch(`${BASE}/api/artifacts/${prd.id}/download`);
  const text = await prdRes.text();
  expect(prdRes.status === 200 && text.length > 500, 'PRD download failed');
  const pptxRes = await fetch(`${BASE}/api/artifacts/${slides.id}/download?format=pptx`);
  const bytes = (await pptxRes.arrayBuffer()).byteLength;
  expect(pptxRes.status === 200 && bytes > 10000, 'PPTX download failed');
  return `PRD ${(text.length / 1024).toFixed(1)} KB, PPTX ${(bytes / 1024).toFixed(0)} KB`;
});

await check('single-file HTML download', async () => {
  const response = await fetch(`${BASE}/api/projects/${seed.id}/versions/${seed.currentVersion}/download`);
  const html = await response.text();
  expect(response.status === 200 && html.includes('<style>'), 'bundle missing inlined css');
  expect(!html.includes('href="styles.css"'), 'bundle still references styles.css');
  return `${(html.length / 1024).toFixed(1)} KB inlined`;
});

await check('screenshot endpoint', async () => {
  const response = await fetch(`${BASE}/shots/${seed.id}/${seed.currentVersion}.png`);
  const bytes = (await response.arrayBuffer()).byteLength;
  expect(response.status === 200 && bytes > 1000, 'screenshot missing');
  return `${(bytes / 1024).toFixed(0)} KB`;
});

console.log(JSON.stringify({ base: BASE, passed, failed, results }, null, 2));
process.exit(failed ? 1 : 0);
