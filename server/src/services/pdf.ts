import fs from 'node:fs';
import puppeteer, { type Browser } from 'puppeteer-core';
import { config } from '../config.js';

let browserP: Promise<Browser> | null = null;

function findChromium(): string {
  const candidates = [
    config.chromiumPath,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error('No Chromium found — set PUPPETEER_EXECUTABLE_PATH');
}

function browser(): Promise<Browser> {
  if (!browserP) {
    browserP = puppeteer
      .launch({
        executablePath: findChromium(),
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage', '--font-render-hinting=none'],
      })
      .catch((e) => {
        browserP = null;
        throw e;
      });
  }
  return browserP;
}

export async function htmlToPdf(html: string): Promise<Buffer> {
  const b = await browser();
  const page = await b.newPage();
  try {
    await page.setContent(html, { waitUntil: 'load', timeout: 20000 });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    return Buffer.from(pdf);
  } finally {
    await page.close().catch(() => {});
  }
}

export async function closeBrowser() {
  if (browserP) {
    const b = await browserP.catch(() => null);
    browserP = null;
    await b?.close().catch(() => {});
  }
}
