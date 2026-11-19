import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from 'playwright-core';

const CHROME_CANDIDATES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  path.join(process.env.HOME || '', 'Library/Caches/ms-playwright/chromium-1228/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
];

async function findExecutable() {
  for (const candidate of CHROME_CANDIDATES) {
    try {
      await fs.access(candidate);
      return candidate;
    } catch {
      // try next
    }
  }
  throw new Error('Aucun binaire Chromium/Chrome trouvé pour générer les icônes PNG.');
}

async function main() {
  const svgPath = path.resolve('public/icons/icon.svg');
  const svg = await fs.readFile(svgPath, 'utf8');
  const executablePath = await findExecutable();
  const browser = await chromium.launch({ executablePath, headless: true });

  try {
    const targets = [
      { out: 'public/icons/apple-touch-icon.png', size: 180 },
      { out: 'public/icons/icon-192.png', size: 192 },
      { out: 'public/icons/icon-512.png', size: 512 },
    ];

    for (const target of targets) {
      const page = await browser.newPage({
        viewport: { width: target.size, height: target.size },
        deviceScaleFactor: 1,
      });
      await page.setContent(`<!doctype html><html><body style="margin:0;background:#030916;overflow:hidden;width:${target.size}px;height:${target.size}px;">${svg.replace('width="512" height="512"', `width="${target.size}" height="${target.size}"`)}</body></html>`);
      await page.screenshot({ path: path.resolve(target.out), type: 'png' });
      await page.close();
      console.log(`Generated ${target.out} (${target.size}x${target.size})`);
    }
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
