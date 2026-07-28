import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve as resolveFixture } from './fixtures.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..');
const FRONTEND_DIR = path.join(REPO_ROOT, 'vane', 'frontend');
const DIST_DIR = path.join(FRONTEND_DIR, 'dist');

const FROZEN_MS = new Date('2026-05-28T10:00:00Z').getTime();

const VIEWPORT = { width: 1440, height: 900 };

const CAPTURES = {
  dashboard: { path: '/', ready: 'Record Health' },
  hosts: { path: '/hosts', ready: 'home.example.com' },
  tokens: { path: '/tokens', ready: 'Cloudflare API Tokens' },
  logs: { path: '/logs', ready: 'vpn.example.com' },
  settings: { path: '/settings', ready: 'Appearance' },
  backup: { path: '/backup', ready: 'Backup & Restore' },
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

function parseArgs(argv) {
  const args = { out: path.join(REPO_ROOT, 'screenshots'), only: [], port: 0, headed: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') args.out = path.resolve(argv[++i]);
    else if (a === '--only') args.only.push(argv[++i]);
    else if (a === '--port') args.port = Number(argv[++i]);
    else if (a === '--headed') args.headed = true;
    else throw new Error(`Unknown argument: ${a}`);
  }
  return args;
}

function ensureBuild() {
  if (fs.existsSync(path.join(DIST_DIR, 'index.html'))) return;
  console.log('No frontend build found; building (npm install && npm run build)...');
  execSync('npm install', { cwd: FRONTEND_DIR, stdio: 'inherit' });
  execSync('npm run build', { cwd: FRONTEND_DIR, stdio: 'inherit' });
}

function startServer(port) {
  const server = http.createServer((req, res) => {
    const urlPath = decodeURIComponent((req.url || '/').split('?')[0]);
    let filePath = path.join(DIST_DIR, urlPath);
    if (!path.extname(filePath) || !fs.existsSync(filePath)) {
      filePath = path.join(DIST_DIR, 'index.html');
    }
    fs.readFile(filePath, (err, data) => {
      if (err) {
        res.writeHead(404);
        res.end('Not found');
        return;
      }
      res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
      res.end(data);
    });
  });
  return new Promise((resolve) => {
    server.listen(port, '127.0.0.1', () => resolve(server));
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const names = args.only.length ? args.only : Object.keys(CAPTURES);
  for (const name of names) {
    if (!CAPTURES[name]) throw new Error(`Unknown capture "${name}". Known: ${Object.keys(CAPTURES).join(', ')}`);
  }

  ensureBuild();
  fs.mkdirSync(args.out, { recursive: true });

  const server = await startServer(args.port);
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  console.log(`Serving ${DIST_DIR} at ${baseUrl}`);

  const browser = await chromium.launch({ headless: !args.headed });
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2,
    colorScheme: 'dark',
  });

  await context.addInitScript(`(() => {
    const OriginalDate = Date;
    const FROZEN = ${FROZEN_MS};
    class FrozenDate extends OriginalDate {
      constructor(...args) {
        if (args.length === 0) { super(FROZEN); } else { super(...args); }
      }
      static now() { return FROZEN; }
    }
    globalThis.Date = FrozenDate;
  })();`);

  await context.route('**/api/**', (route) => {
    const url = new URL(route.request().url());
    const body = resolveFixture(url.pathname, url.searchParams);
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body ?? {}),
    });
  });

  for (const name of names) {
    const { path: routePath, ready } = CAPTURES[name];
    const page = await context.newPage();
    await page.goto(`${baseUrl}${routePath}`, { waitUntil: 'networkidle' });
    if (ready) await page.getByText(ready, { exact: false }).first().waitFor({ state: 'visible', timeout: 15000 });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(250);
    const out = path.join(args.out, `${name}.png`);
    await page.screenshot({ path: out, fullPage: true });
    console.log(`captured ${name} -> ${out}`);
    await page.close();
  }

  await browser.close();
  server.close();
  console.log(`Done. ${names.length} screenshot(s) written to ${args.out}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
