#!/usr/bin/env node
// 拉 AppSheet「AI更新」表全量 → data/raw.json
// 凭据：环境变量 APPSHEET_APP_ID / APPSHEET_API_KEY（GitHub Actions 从 Secrets 注入）
// 本地跑：自动回落读 ../Appsheet库存管理/scripts/.env（不另存一份凭据）
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

// 本地回落：读隔壁项目的 .env
if (!process.env.APPSHEET_APP_ID) {
  const sibling = join(ROOT, '..', 'Appsheet库存管理', 'scripts', '.env');
  if (existsSync(sibling)) {
    for (const line of readFileSync(sibling, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}

const APP_ID = process.env.APPSHEET_APP_ID;
const API_KEY = process.env.APPSHEET_API_KEY;
if (!APP_ID || !API_KEY) {
  console.error('缺凭据：APPSHEET_APP_ID / APPSHEET_API_KEY');
  process.exit(1);
}

// 本地有代理时走 undici（Actions 上直连，不需要）
let doFetch = globalThis.fetch;
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxyUrl && !process.env.GITHUB_ACTIONS) {
  try {
    const { createRequire } = await import('node:module');
    const req = createRequire(join(ROOT, '..', 'Appsheet库存管理', 'package.json'));
    const undici = req('undici');
    const agent = new undici.ProxyAgent(proxyUrl);
    doFetch = (url, opts) => undici.fetch(url, { ...opts, dispatcher: agent });
    console.log(`[net] 走代理 ${proxyUrl}`);
  } catch {
    console.log('[net] undici 不可用，直连');
  }
}

const ENDPOINT = `https://api.appsheet.com/api/v2/apps/${APP_ID}/tables/${encodeURIComponent('AI更新')}/Action`;
const res = await doFetch(ENDPOINT, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ApplicationAccessKey: API_KEY },
  body: JSON.stringify({ Action: 'Find', Properties: { Locale: 'zh-CN' }, Rows: [] }),
});
if (res.status !== 200) {
  console.error(`AppSheet API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  process.exit(2);
}
const rows = await res.json();
if (!Array.isArray(rows) || rows.length < 100) {
  console.error(`行数异常（${Array.isArray(rows) ? rows.length : typeof rows}），拒绝覆盖，本次放弃`);
  process.exit(3);
}
mkdirSync(join(ROOT, 'data'), { recursive: true });
writeFileSync(join(ROOT, 'data', 'raw.json'), JSON.stringify({ pulledAt: Date.now(), rows }));
console.log(`[pull] ${rows.length} 行 → data/raw.json`);
