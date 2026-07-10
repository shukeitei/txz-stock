#!/usr/bin/env node
// 一次性批量回填「现做发货时效」（M列）：按 L列「现做」映射
//   可现做 → 3 ｜ 超卖可议/可协商 → 7 ｜ 不支持/停产 → /
// 只写 M列 与目标不一致的行；--dry 只看不写；--limit N 只写前 N 行（试写用）
import { readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DRY = process.argv.includes('--dry');
const limIdx = process.argv.indexOf('--limit');
const LIMIT = limIdx > -1 ? Number(process.argv[limIdx + 1]) : Infinity;

if (!process.env.APPSHEET_APP_ID) {
  const sibling = join(ROOT, '..', 'Appsheet库存管理', 'scripts', '.env');
  if (existsSync(sibling)) {
    for (const line of readFileSync(sibling, 'utf8').split('\n')) {
      const m = /^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
}
let doFetch = globalThis.fetch;
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy;
if (proxyUrl) {
  const { createRequire } = await import('node:module');
  const req = createRequire(join(ROOT, '..', 'Appsheet库存管理', 'package.json'));
  const undici = req('undici');
  const agent = new undici.ProxyAgent(proxyUrl);
  doFetch = (url, opts) => undici.fetch(url, { ...opts, dispatcher: agent });
}

const MAP = { '可现做': '3', '超卖可议': '7', '可协商': '7', '不支持': '/', '停产': '/' };
const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'raw.json'), 'utf8'));
const todo = [];
for (const r of raw.rows) {
  if (!String(r['定制'] || '').includes('定制')) continue;
  const target = MAP[String(r['现做'] || '').trim()];
  if (!target) continue;
  const cur = String(r['现做发货时效'] || '').trim();
  if (cur === target) continue;
  todo.push({ SKUID: r['SKUID'], '现做发货时效': target, _name: r['SKU全称'], _from: cur || '(空)' });
}
console.log(`需回填 ${todo.length} 行`);
if (DRY) {
  for (const t of todo.slice(0, 10)) console.log(`  ${t._name}: ${t._from} → ${t['现做发货时效']}`);
  console.log('  …(--dry 未写入)');
  process.exit(0);
}

const rows = todo.slice(0, LIMIT).map(({ SKUID, 现做发货时效 }) => ({ SKUID, 现做发货时效 }));
const ENDPOINT = `https://api.appsheet.com/api/v2/apps/${process.env.APPSHEET_APP_ID}/tables/${encodeURIComponent('AI更新')}/Action`;
let done = 0;
for (let i = 0; i < rows.length; i += 200) {
  const chunk = rows.slice(i, i + 200);
  const res = await doFetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ApplicationAccessKey: process.env.APPSHEET_API_KEY },
    body: JSON.stringify({ Action: 'Edit', Properties: { Locale: 'zh-CN' }, Rows: chunk }),
  });
  if (res.status !== 200) {
    console.error(`✗ 第 ${i / 200 + 1} 批失败 HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
    process.exit(2);
  }
  const body = await res.json().catch(() => null);
  const n = body?.Rows?.length ?? chunk.length;
  done += chunk.length;
  console.log(`✓ 第 ${i / 200 + 1} 批：提交 ${chunk.length} 行（API 确认 ${n}），累计 ${done}/${rows.length}`);
}
console.log('写完。请重拉核验：node scripts/pull.mjs');
