# 代理库存看板（txz-stock）

给代发代理看的**定制款**库存网页。加密只读，代理拿网址+口令直连可看（无需 VPN）。
数据源 = AppSheet「AI更新」表（Google Sheet 同步），整条链路在 GitHub Actions 云端自转，本地机器无需开机。

## 线上

- 网址：https://shukeitei.github.io/txz-stock/
- 更新：每天两次（北京 14:00 / 20:30），页面顶部标更新时间
- 公开仓里只有代码和加密后的 index.html，没口令看到的是密文

## 数据流

AppSheet API（Find AI更新 全量）→ 过滤 `定制` 列含"定制"的行 → 按款色（SKU全称 斜杠前）分组
→ 展示：实际库存（按码）、产品类别 tag（可筛可搜）、现做（L列）、现做发货时效（M列，天数）
→ AES-256-GCM 信封加密（每个代理一把口令）→ gh-pages 发布。

- 「在售」列不用于过滤（定制款全量展示）；批发款（非定制）不出现。
- **手工排除款**：`scripts/build.mjs` 顶部 `EXCLUDE_IDS`（工厂批发/不代发的 4 个商品ID，注释里有原因）；要增删排除款改这里再发布。
- **按款名排除**：同文件 `EXCLUDE_NAME`（正则）。目前排两对装——拼色组合款与春夏护肘共用商品ID，代理只按单色下单，不展示。
- **内部 tag 不外显**：同文件 `HIDE_TAGS`（深圳、工厂定制）。
- 「现做」第四档 `停产` → 灰标「停产 · 售完即止」。
- **款卡缩略图**（2026-07-27 栩栩提议）：`data/item-images.json` 按**商品ID**映射 `site/img/` 里的点击图（640px，复用代理报价页图库，明文公开同口径）；上新款要在这里加一行映射 + 放图，否则新款无图。点缩略图新开原图。无图存量款：秋冬短款（斯文野兽/暴走萝莉）、绒花系列、hello兔。
- `scripts/fill-leadtime.mjs` — 按 L列批量回填 M列交期的一次性脚本（可现做→3 / 超卖可议→7 / 不支持、停产→"/"），`--dry` 预览、`--limit N` 试写；走 AppSheet Edit API（SKUID 定位，只写这一个字段）。
- 「现做」三档：`可现做`（绿标，带交期）/ `不支持`（灰标"不可现做"）/ `超卖可议`（黄标，页面顶部有免责说明，防代理当成可现做无限上架）。Google Sheet 里填 `可协商` 也会显示为「超卖可议」。
- **款级标签取组内最优档**（可现做 > 超卖可议 > 不支持 > 停产），不按首行；与款级不同的码在尺码 chip 上单独标「· 不接现做 / · 停产」。背景：春夏护肘短款 L 码统一填「不支持」且排第一，曾把整款拖成「不可现做」。
- 拉取行数 < 100 视为异常，本次放弃不覆盖（防 API 抽风发布空页）。

## 口令管理（按人区分）

- 本地真身：`.passcodes.json`（gitignored），格式 `{"名字": "口令"}`
- 云端副本：GitHub Secret `AGENT_PASSCODES`（Actions 构建用）
- **加人/换口令/踢人**：改 `.passcodes.json` → 同步 Secret → 手动触发一次发布：

```bash
cd ~/Developer/代理库存看板
gh secret set AGENT_PASSCODES < .passcodes.json
gh workflow run publish
```

- 踢人 = 从 json 删掉那行再跑上面两条。名字只存在本地和 Secret 里，页面内是匿名密钥槽。

## 本地跑（可选，日常不需要）

```bash
node scripts/pull.mjs    # 凭据回落读 ../Appsheet库存管理/scripts/.env；本地走 HTTPS_PROXY
node scripts/build.mjs   # → site/index.html，可直接浏览器打开验收
```

## Secrets 清单（GitHub repo → Settings → Secrets）

- `APPSHEET_APP_ID` / `APPSHEET_API_KEY` — AppSheet API 凭据
- `AGENT_PASSCODES` — 口令 JSON

## 相关

- 姊妹项目：`~/Developer/招柴桔账单`（同款加密静态页架构，对账单）
- 数据源项目：`~/Developer/Appsheet库存管理`（千牛同步命脉，本项目只读它的 API）
