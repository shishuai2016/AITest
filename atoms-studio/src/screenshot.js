import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './db.js';

const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

function shotPath(projectId, version) {
  return path.join(DATA_DIR, 'shots', projectId, `${version}.png`);
}

export function getShotPath(projectId, version) {
  const file = shotPath(projectId, version);
  return fs.existsSync(file) && fs.statSync(file).size > 1000 ? file : null;
}

export async function captureProjectShot(projectId, version, baseUrl) {
  const out = shotPath(projectId, version);
  fs.mkdirSync(path.dirname(out), { recursive: true });
  if (fs.existsSync(out) && fs.statSync(out).size > 1000) return out;
  if (!fs.existsSync(CHROME)) throw new Error('CHROME_NOT_FOUND');
  const url = `${baseUrl}/preview/${projectId}/${version}/?shot=1`;
  const profile = path.join(DATA_DIR, 'chrome-profile', `${projectId}-${version}-${Date.now()}`);
  fs.mkdirSync(profile, { recursive: true });
  const args = [
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--force-device-scale-factor=1',
    '--window-size=1280,800',
    `--user-data-dir=${profile}`,
    '--virtual-time-budget=2200',
    `--screenshot=${out}`,
    url,
  ];
  await new Promise((resolve, reject) => {
    execFile(CHROME, args, { timeout: 30000 }, (error, stdout, stderr) => {
      try {
        fs.rmSync(profile, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      if (error) return reject(new Error(`SCREENSHOT_FAILED: ${String(stderr || error.message).slice(0, 200)}`));
      resolve();
    });
  });
  if (!fs.existsSync(out)) throw new Error('SCREENSHOT_MISSING');
  return out;
}
