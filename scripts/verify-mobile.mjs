import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { chromium } from 'playwright-core';

const DIST_DIR = path.resolve('dist');
const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR
  ? path.resolve(process.env.SCREENSHOT_DIR)
  : path.resolve('.verify-screenshots');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(
    process.env.HOME || '',
    'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'
  ),
];

async function findExecutable() {
  for (const c of CHROME_CANDIDATES) {
    try {
      await fs.access(c);
      return c;
    } catch {
      // continue
    }
  }
  throw new Error('Aucun binaire Chromium/Chrome trouvé.');
}

function startStaticServer() {
  return new Promise((resolve) => {
    const server = http.createServer(async (req, res) => {
      try {
        const reqUrl = new URL(req.url || '/', 'http://127.0.0.1');
        let rel = decodeURIComponent(reqUrl.pathname);
        if (rel === '/' || rel === '') rel = '/index.html';
        const filePath = path.join(DIST_DIR, rel);
        const data = await fs.readFile(filePath);
        const ext = path.extname(filePath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end('Not found');
      }
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/` });
    });
  });
}

async function auditLayout(page, label, maxW, maxH) {
  const report = await page.evaluate(
    ({ maxW, maxH }) => {
      const docOverflowX = document.documentElement.scrollWidth > maxW + 1;
      const bodyOverflowX = document.body.scrollWidth > maxW + 1;
      const appRect = document.getElementById('app')?.getBoundingClientRect();
      const clipped = [];

      const interactive = document.querySelectorAll('button, .stat-pill, h1, h2');
      for (const el of interactive) {
        const style = getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden') continue;
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;
        if (rect.left < -1 || rect.right > maxW + 1) {
          clipped.push({
            text: (el.textContent || el.getAttribute('aria-label') || el.id).trim().slice(0, 32),
            left: Math.round(rect.left),
            right: Math.round(rect.right),
          });
        }
      }

      // Check sibling overlap inside key bars
      const overlaps = [];
      for (const containerSel of ['.hud-stats', '.hud-actions', '.build-palette', '.inspector-actions']) {
        const container = document.querySelector(containerSel);
        if (!container || getComputedStyle(container).display === 'none') continue;
        const children = Array.from(container.children).filter((c) => {
          const r = c.getBoundingClientRect();
          return r.width > 0 && r.height > 0 && getComputedStyle(c).display !== 'none';
        });
        for (let i = 0; i < children.length; i++) {
          const a = children[i].getBoundingClientRect();
          for (let j = i + 1; j < children.length; j++) {
            const b = children[j].getBoundingClientRect();
            const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
            const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
            if (ox > 1 && oy > 1) {
              overlaps.push({ container: containerSel, i, j, ox: Math.round(ox), oy: Math.round(oy) });
            }
          }
        }
      }

      return {
        docOverflowX,
        bodyOverflowX,
        scrollWidth: document.documentElement.scrollWidth,
        scrollHeight: document.documentElement.scrollHeight,
        appHeight: appRect ? Math.round(appRect.height) : 0,
        clipped,
        overlaps,
        maxH,
      };
    },
    { maxW, maxH }
  );

  console.log(`[Layout ${label}]`, JSON.stringify(report));
  if (report.docOverflowX || report.bodyOverflowX) {
    throw new Error(`Débordement horizontal détecté (${label}): scrollWidth=${report.scrollWidth} > ${maxW}`);
  }
  if (report.clipped.length > 0) {
    throw new Error(`Éléments coupés hors écran (${label}): ${JSON.stringify(report.clipped)}`);
  }
  if (report.overlaps.length > 0) {
    throw new Error(`Chevauchement détecté (${label}): ${JSON.stringify(report.overlaps)}`);
  }
}

async function tapGridTile(page, col, row) {
  const pt = await page.evaluate(({ col, row }) => window.__citadelleDebug.gridToClient(col, row), { col, row });
  await page.mouse.click(pt.x, pt.y);
}

async function main() {
  await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
  const { server, url } = await startStaticServer();
  const executablePath = await findExecutable();
  const browser = await chromium.launch({ executablePath, headless: true });

  const consoleErrors = [];
  const pageErrors = [];

  try {
    const context = await browser.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      locale: 'fr-FR',
    });

    const page = await context.newPage();
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });
    page.on('pageerror', (err) => pageErrors.push(err.message));

    console.log(`Loading ${url} at 390x844...`);
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.waitForTimeout(450);

    // 1. Verify Service Worker registers cleanly
    const swStatus = await page.evaluate(async () => {
      if (!('serviceWorker' in navigator)) return 'unsupported';
      const reg = await navigator.serviceWorker.ready;
      return reg.active ? reg.active.state : 'pending';
    });
    console.log('[PWA Service Worker]', swStatus);

    // 2. Title screen check + screenshot
    await auditLayout(page, 'Title 390x844', 390, 844);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '01-title-390x844.png') });

    // Switch to seeded map briefly and verify seed row
    await page.click('.map-option[data-map="seeded"]');
    await page.waitForTimeout(200);
    await auditLayout(page, 'Seeded Title 390x844', 390, 844);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '02-seeded-title-390x844.png') });
    // Back to Atoll
    await page.click('.map-option[data-map="atoll"]');
    await page.waitForTimeout(150);

    // 3. Tutorial dialog check + screenshot
    await page.click('#btn-title-tutorial');
    await page.waitForTimeout(200);
    const dialogOpen = await page.evaluate(() => document.getElementById('tutorial-dialog').open);
    if (!dialogOpen) throw new Error('Le dialogue de tutoriel ne s’est pas ouvert.');
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '03-tutorial-390x844.png') });
    await page.click('#tutorial-dialog .dialog-cta');
    await page.waitForTimeout(150);

    // 4. Enter gameplay
    await page.click('#btn-play-start');
    await page.waitForTimeout(350);
    await auditLayout(page, 'Gameplay 390x844', 390, 844);

    // Verify illegal placement on sacred channel (4,1) is rejected with clear French notice
    await page.click('.tower-card[data-tower="harpon"]');
    await tapGridTile(page, 4, 1);
    await page.waitForTimeout(150);
    const afterInvalid = await page.evaluate(() => ({
      state: window.__citadelleDebug.getState(),
      notice: document.getElementById('notice-pill')?.textContent || '',
    }));
    if (afterInvalid.state.towers.length !== 0) {
      throw new Error('Une tour a été placée sur le chemin sacré !');
    }
    console.log('[Invalid path tap check]', afterInvalid.notice);

    // Place Harpon at (3,3) and Mortier at (5,3)
    await tapGridTile(page, 3, 3);
    await page.waitForTimeout(120);
    await page.click('.tower-card[data-tower="mortier"]');
    await tapGridTile(page, 5, 3);
    await page.waitForTimeout(150);

    const afterBuild = await page.evaluate(() => window.__citadelleDebug.getState());
    if (afterBuild.towers.length !== 2) {
      throw new Error(`Attendu 2 tours placées, obtenu ${afterBuild.towers.length}`);
    }
    console.log('[Starter build]', JSON.stringify(afterBuild));

    // Open Tower Inspector on Harpon (3,3) and audit + screenshot
    await tapGridTile(page, 3, 3);
    await page.waitForTimeout(200);
    await auditLayout(page, 'Inspector 390x844', 390, 844);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '04-inspector-390x844.png') });
    await page.click('#btn-inspector-close');
    await page.waitForTimeout(100);

    // 5. Launch Wave 1, verify combat, test Pause/Resume & 2x Speed
    await page.click('#btn-start-wave');
    await page.waitForTimeout(2400);

    // Regression check: wave CTA must be hidden while wave is active, and pause/mute buttons show 1 icon each
    const visibilityAudit = await page.evaluate(() => ({
      ctaVisible: getComputedStyle(document.getElementById('btn-start-wave')).display !== 'none',
      progressVisible: getComputedStyle(document.getElementById('wave-progress-box')).display !== 'none',
      pauseIconsVisible: Array.from(document.querySelectorAll('#btn-pause svg')).filter((el) => getComputedStyle(el).display !== 'none').length,
      muteIconsVisible: Array.from(document.querySelectorAll('#btn-mute svg')).filter((el) => getComputedStyle(el).display !== 'none').length,
    }));
    console.log('[HUD visibility audit]', JSON.stringify(visibilityAudit));
    if (visibilityAudit.ctaVisible || !visibilityAudit.progressVisible) {
      throw new Error(`Wave CTA/Progress visibility bug: ${JSON.stringify(visibilityAudit)}`);
    }
    if (visibilityAudit.pauseIconsVisible !== 1 || visibilityAudit.muteIconsVisible !== 1) {
      throw new Error(`Duplicate SVG icon visible in HUD: ${JSON.stringify(visibilityAudit)}`);
    }

    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '05-wave1-combat-390x844.png') });

    // Test Pause / Resume
    await page.click('#btn-pause');
    await page.waitForTimeout(120);
    const pausedState = await page.evaluate(() => window.__citadelleDebug.getState().paused);
    if (!pausedState) throw new Error('Le bouton Pause n’a pas mis la partie en pause.');
    await page.click('#btn-resume-inline');
    await page.waitForTimeout(120);
    const resumedState = await page.evaluate(() => window.__citadelleDebug.getState().paused);
    if (resumedState) throw new Error('Le bouton Reprendre n’a pas repris la partie.');

    // Enable 2x speed
    await page.click('#btn-speed');
    await page.waitForTimeout(100);
    const speedState = await page.evaluate(() => window.__citadelleDebug.getState().speedMultiplier);
    if (speedState !== 2) throw new Error('La vitesse 2× ne s’est pas activée.');

    // Wait for Wave 1 completion
    await page.waitForFunction(() => {
      const s = window.__citadelleDebug.getState();
      return s.waveNumber === 1 && !s.waveActive;
    }, { timeout: 22000 });

    const afterWave1 = await page.evaluate(() => window.__citadelleDebug.getState());
    console.log('[Wave 1 cleared]', JSON.stringify(afterWave1));
    if (afterWave1.score <= 0 || afterWave1.enemiesKilled < 5) {
      throw new Error(`Wave 1 n'a pas progressé correctement : ${JSON.stringify(afterWave1)}`);
    }

    // 6. Place Prisme Cryo-Algue at (3,1) near spawn curve so its slow beam fires immediately AND upgrade Harpon (3,3)
    await page.click('.tower-card[data-tower="prisme"]');
    await tapGridTile(page, 3, 1);
    await page.waitForTimeout(150);

    await tapGridTile(page, 3, 3);
    await page.waitForTimeout(120);
    const canUpgrade = await page.evaluate(() => !document.getElementById('btn-upgrade').disabled);
    if (canUpgrade) {
      await page.click('#btn-upgrade');
      await page.waitForTimeout(120);
    }
    await page.click('#btn-inspector-close');

    // Launch Wave 2 and capture live multi-tower combat (Harpon + Mortier + Prisme slow beam!)
    await page.click('#btn-start-wave');
    await page.waitForTimeout(1400);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '06-wave2-combat-390x844.png') });

    // Wait for Wave 2 completion
    await page.waitForFunction(() => {
      const s = window.__citadelleDebug.getState();
      return s.waveNumber === 2 && !s.waveActive;
    }, { timeout: 28000 });

    const afterWave2 = await page.evaluate(() => ({
      state: window.__citadelleDebug.getState(),
      saved: JSON.parse(localStorage.getItem('citadelle_des_marees_v1') || '{}'),
    }));
    console.log('[Wave 2 cleared]', JSON.stringify(afterWave2));
    if (afterWave2.state.score <= afterWave1.score) {
      throw new Error('Le score n’a pas augmenté après la vague 2.');
    }
    if (!afterWave2.saved.bestScore || afterWave2.saved.bestScore < afterWave2.state.score) {
      throw new Error('Le meilleur score n’a pas été enregistré dans localStorage.');
    }

    // 7. Verify 320x568 ultra-compact iPhone width has zero overflow
    await page.setViewportSize({ width: 320, height: 568 });
    await page.waitForTimeout(300);
    await auditLayout(page, 'Gameplay 320x568', 320, 568);
    await page.screenshot({ path: path.join(SCREENSHOT_DIR, '07-gameplay-320x568.png') });

    // 8. Verify Offline PWA reload using the active Service Worker
    await page.setViewportSize({ width: 390, height: 844 });
    await context.setOffline(true);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(500);
    const offlineTitle = await page.textContent('#game-title');
    if (!offlineTitle || !offlineTitle.includes('Citadelle')) {
      throw new Error('Le rechargement hors ligne via Service Worker a échoué.');
    }
    console.log('[Offline PWA reload]', 'OK ->', offlineTitle.trim());
    await context.setOffline(false);

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      throw new Error(`Erreurs JS console/page détectées: ${JSON.stringify({ consoleErrors, pageErrors })}`);
    }

    console.log('ALL MOBILE VERIFICATION CHECKS PASSED!');
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((err) => {
  console.error('VERIFICATION FAILED:', err);
  process.exit(1);
});
