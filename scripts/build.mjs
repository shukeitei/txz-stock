#!/usr/bin/env node
// data/raw.json → 过滤定制款 → 按款色分组 → AES-GCM 信封加密 → site/index.html
// 口令来源：环境变量 AGENT_PASSCODES（JSON {"名字":"口令"}，Actions 从 Secrets 注入），
// 本地回落读 .passcodes.json
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv, pbkdf2Sync } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'raw.json'), 'utf8'));

// ---------- 口令 ----------
let passcodes;
if (process.env.AGENT_PASSCODES) passcodes = JSON.parse(process.env.AGENT_PASSCODES);
else if (existsSync(join(ROOT, '.passcodes.json'))) passcodes = JSON.parse(readFileSync(join(ROOT, '.passcodes.json'), 'utf8'));
if (!passcodes || !Object.keys(passcodes).length) {
  console.error('没有口令（AGENT_PASSCODES 或 .passcodes.json）');
  process.exit(1);
}

// ---------- 数据整形 ----------
// 不上页面的款：工厂批发（定制仅指定制图标，10件起拿）857464619076/847658314500；
// 工厂制版不补货 760939427964；不代发 727888970927
const EXCLUDE_IDS = new Set(['857464619076', '847658314500', '760939427964', '727888970927']);
// 内部信息 tag，不给代理看
const HIDE_TAGS = new Set(['深圳', '工厂定制']);
const rows = raw.rows.filter(r =>
  String(r['定制'] || '').includes('定制') && !EXCLUDE_IDS.has(String(r['商品ID'] || '').trim()));
// 缩略图两级映射（site/img/ 内，明文公开与代理报价页同口径）：
// 1) data/style-images.json 款色名 → 该花色专属 SKU 白底图（优先，多花色链接靠它区分）
// 2) data/item-images.json  商品ID → 链接点击图（回落）
// 两边都没有 → 不显示缩略图
const IMG_PATH = join(ROOT, 'data', 'item-images.json');
const IMG_MAP = existsSync(IMG_PATH) ? JSON.parse(readFileSync(IMG_PATH, 'utf8')) : {};
const STYLE_IMG_PATH = join(ROOT, 'data', 'style-images.json');
const STYLE_IMG = existsSync(STYLE_IMG_PATH) ? JSON.parse(readFileSync(STYLE_IMG_PATH, 'utf8')) : {};
const MK_RANK = { '可现做': 0, '超卖可议': 1, '不支持': 2, '停产': 3 };
const normMk = v => { const m = String(v || '').trim(); return m === '可协商' ? '超卖可议' : m; };
const mkRank = m => (m in MK_RANK ? MK_RANK[m] : (m ? 4 : 9));
const styles = new Map();
for (const r of rows) {
  const full = String(r['SKU全称'] || '').trim();
  if (!full) continue;
  const slash = full.indexOf('/');
  const name = (slash > 0 ? full.slice(0, slash) : full).trim();
  const size = (slash > 0 ? full.slice(slash + 1) : '均码').replace(/码\s*$/, '').trim() || '均码';
  let st = styles.get(name);
  if (!st) {
    st = { n: name, tg: new Set(), os: false, mk: '', dy: '', sz: [], im: STYLE_IMG[name] || IMG_MAP[String(r['商品ID'] || '').trim()] || '' };
    styles.set(name, st);
  }
  for (const t of String(r['产品类别'] || '').split(/[,，]/)) { const tt = t.trim(); if (tt && !HIDE_TAGS.has(tt)) st.tg.add(tt); }
  if (String(r['在售'] || '').includes('在售')) st.os = true;
  // 款级「现做」取组内最优档（可现做 > 超卖可议 > 不支持 > 停产），别按第一行——
  // 春夏护肘短款 L 码统一填「不支持」且排第一，按首行会把整款误标成不可现做
  const mk = normMk(r['现做']);
  if (mk && mkRank(mk) < mkRank(st.mk)) st.mk = mk;
  const dy = String(r['现做发货时效'] || '').trim();
  if (/^\d+$/.test(dy) && (!st.dy || (mk === '可现做' && !st.dyOk))) { st.dy = dy; if (mk === '可现做') st.dyOk = true; }
  st.sz.push([size, Number(r['实际库存']) || 0, mk]);
}
// 尺码级例外：与款级档位不同的码，chip 上单独标（第三位保留差异值，相同则删掉省体积）
for (const st of styles.values()) {
  for (const p of st.sz) { if (!p[2] || p[2] === st.mk) p.length = 2; }
  delete st.dyOk;
}

const SIZE_ORDER = ['XS','S','M','L','XL','2XL','3XL','4XL','5XL','6XL','7XL','8XL','9XL','10XL','11XL','12XL'];
const sizeKey = s => { const i = SIZE_ORDER.indexOf(s.toUpperCase()); return i === -1 ? 100 : i; };
const list = [...styles.values()].map(st => ({
  ...st,
  tg: [...st.tg],
  sz: st.sz.sort((a, b) => sizeKey(a[0]) - sizeKey(b[0]) || a[0].localeCompare(b[0], 'zh')),
}));
list.sort((a, b) => {
  const sa = a.sz.some(x => x[1] > 0) ? 0 : 1, sb = b.sz.some(x => x[1] > 0) ? 0 : 1;
  if (sa !== sb) return sa - sb;
  const ma = a.mk === '可现做' ? 0 : 1, mb = b.mk === '可现做' ? 0 : 1;
  if (ma !== mb) return ma - mb;
  return a.n.localeCompare(b.n, 'zh');
});

const ts = new Date(raw.pulledAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const payload = JSON.stringify({ t: ts, styles: list });
console.log(`[build] 定制款 ${rows.length} 行 → ${list.length} 个款色，更新时间 ${ts}`);

// ---------- 信封加密 ----------
const b64 = b => Buffer.from(b).toString('base64');
const K = randomBytes(32);
const iv = randomBytes(12);
const c = createCipheriv('aes-256-gcm', K, iv);
const ct = Buffer.concat([c.update(payload, 'utf8'), c.final(), c.getAuthTag()]);
const keyEntries = Object.values(passcodes).map(pc => {
  const salt = randomBytes(16);
  const kek = pbkdf2Sync(String(pc).normalize('NFKC'), salt, 210000, 32, 'sha256');
  const wiv = randomBytes(12);
  const wc = createCipheriv('aes-256-gcm', kek, wiv);
  const wk = Buffer.concat([wc.update(K), wc.final(), wc.getAuthTag()]);
  return { s: b64(salt), i: b64(wiv), w: b64(wk) };
});

// ---------- 渲染 ----------
const tpl = readFileSync(join(ROOT, 'scripts', 'template.html'), 'utf8');
const html = tpl
  .replace('__DATA_IV__', b64(iv))
  .replace('__DATA_CT__', b64(ct))
  .replace('__KEYS__', JSON.stringify(keyEntries));
mkdirSync(join(ROOT, 'site'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'index.html'), html);
console.log(`[build] site/index.html ${(html.length / 1024).toFixed(0)}KB，口令 ${keyEntries.length} 把`);
