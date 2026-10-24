#!/usr/bin/env node
// 北美代理（珊珊）专属现货页：data/raw.json → 只取她在拿的 2代护肘花色 XL/2XL/3XL
// → 每码扣安全量 → AES-GCM 信封加密 → site/na/index.html
// 口令来源：环境变量 NA_PASSCODES（Actions 从 Secrets 注入），本地回落读 .passcodes-na.json
// 与全体代理共用的 site/index.html 完全分开：口令不通用，内容只给她一家看。
import { readFileSync, existsSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes, createCipheriv, pbkdf2Sync } from 'node:crypto';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const raw = JSON.parse(readFileSync(join(ROOT, 'data', 'raw.json'), 'utf8'));

let passcodes;
if (process.env.NA_PASSCODES) passcodes = JSON.parse(process.env.NA_PASSCODES);
else if (existsSync(join(ROOT, '.passcodes-na.json'))) passcodes = JSON.parse(readFileSync(join(ROOT, '.passcodes-na.json'), 'utf8'));
if (!passcodes || !Object.keys(passcodes).length) {
  console.error('[na] 没有口令（NA_PASSCODES 或 .passcodes-na.json）');
  process.exit(1);
}

// ---------- 口径（栩栩 2026-10-24 定） ----------
// 每码给零售留的安全量：显示数 = 实际库存 − RESERVE，≤0 显示无货
const RESERVE = 2;
// 她在拿的花色（内部名 → 对她的叫法）。兔个槽=专供按段生产、兔个泡=没给她上，不放。
const COLORS = {
  平安狐: '平安狐', 平安鹿: '平安鹿', 装满袜: '装满袜', 锦鲤: '锦鲤', 福鹿: '福鹿',
  潮豹啦: '潮豹', 年画鸭: '年画鸭', 冷豹力: '冷豹力', 摸个鱼: '摸个鱼', 抓大鹅: '抓大鹅',
  兔个乐: '兔个乐', 雪人精: '雪人精', 暴走萝莉: '暴走萝莉',
};
// 暂不展示的花色：年画鸭两批 66 件在等面料，抵不抵现货栩栩未定（10-24），定了再从这里删
const HIDE = new Set(['年画鸭']);
// 10-15 起她的货全用新护垫：某花色有「护垫加厚款」规格就只取加厚款；没有加厚款规格的（春节、秋冬双层）取普通规格
// 尺码对她用 XL/XXL/XXXL（她下单表的写法）；小 XL / 小 2XL / L 不给
const SIZE_OUT = { XL: 'XL', '2XL': 'XXL', '3XL': 'XXXL' };
const RE = /^2代 \S+护肘 (.+?)-(短款|加长款)\/(护垫加厚款 )?(XL|2XL|3XL) 码$/;
const IMG = {
  '平安狐|短款': 'pinganhu', '平安鹿|短款': 'pinganlu', '装满袜|短款': 'zhuangmanwa',
  '锦鲤|短款': 'jinli', '福鹿|短款': 'fulu', '潮豹啦|短款': 'chaobao', '潮豹啦|加长款': 'chaobao-long',
  '年画鸭|短款': 'nianhuaya', '年画鸭|加长款': 'nianhuaya-long', '冷豹力|短款': 'lengbaoli',
  '摸个鱼|短款': 'mogeyu', '抓大鹅|短款': 'zhuadae', '兔个乐|短款': 'tugele', '雪人精|短款': 'xuerenjing',
};

const groups = new Map();
for (const r of raw.rows) {
  const m = RE.exec(String(r['SKU全称'] || '').trim());
  if (!m || !(m[1] in COLORS) || HIDE.has(m[1])) continue;
  if (String(r['现做'] || '').trim() === '停产') continue;
  const key = m[1] + '|' + m[2];
  let g = groups.get(key);
  if (!g) { g = { color: m[1], cut: m[2], thick: {}, plain: {} }; groups.set(key, g); }
  (m[3] ? g.thick : g.plain)[m[4]] = Number(r['实际库存']) || 0;
}

const list = [];
for (const g of groups.values()) {
  const src = Object.keys(g.thick).length ? g.thick : g.plain;
  const sz = ['XL', '2XL', '3XL'].filter(s => s in src).map(s => [SIZE_OUT[s], Math.max(0, src[s] - RESERVE)]);
  if (!sz.length) continue;
  list.push({
    n: COLORS[g.color] + (g.cut === '加长款' ? '（加长款）' : '（短款）'),
    im: IMG[g.color + '|' + g.cut] ? `../img/na/${IMG[g.color + '|' + g.cut]}.jpg` : '',
    sz,
  });
}
const total = st => st.sz.reduce((a, p) => a + p[1], 0);
list.sort((a, b) => (total(b) > 0) - (total(a) > 0) || a.n.localeCompare(b.n, 'zh'));

const ts = new Date(raw.pulledAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const payload = JSON.stringify({ t: ts, styles: list });
console.log(`[na] ${list.length} 个款色，有货 ${list.filter(s => total(s) > 0).length} 个，安全量 ${RESERVE}/码，更新时间 ${ts}`);

// ---------- 信封加密（与 build.mjs 同参数） ----------
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

const tpl = readFileSync(join(ROOT, 'scripts', 'template-na.html'), 'utf8');
const html = tpl
  .replace('__DATA_IV__', b64(iv))
  .replace('__DATA_CT__', b64(ct))
  .replace('__KEYS__', JSON.stringify(keyEntries));
mkdirSync(join(ROOT, 'site', 'na'), { recursive: true });
writeFileSync(join(ROOT, 'site', 'na', 'index.html'), html);
console.log(`[na] site/na/index.html ${(html.length / 1024).toFixed(0)}KB，口令 ${keyEntries.length} 把`);
