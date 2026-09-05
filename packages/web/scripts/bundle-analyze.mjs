#!/usr/bin/env node
/**
 * 构建产物分析：沿 HTML 入口的静态 import 图计算「首帧前必须下载的文件」，按 sourcemap 归因体积，
 * 输出报告 / JSON / Markdown，并可按 `bundle-budget.json` 做预算检查（CI 门禁）。
 *
 *   node scripts/bundle-analyze.mjs                       # 文本报告（dist/）
 *   node scripts/bundle-analyze.mjs --dist ../dist --json out.json --md out.md
 *   node scripts/bundle-analyze.mjs --check               # 预算检查，超限 exit 1
 *
 * 判定口径：
 * - critical：入口 <script type=module> 出发、只沿静态 import 可达的 JS 集合 ＋ HTML 里的 stylesheet
 * - incremental(X)：某个懒加载 chunk（如 AdminLayout）出发的静态闭包，排除已在 critical 中的文件
 * - 体积：raw = 产物字节；gz = zlib gzip level 6；br = brotli quality 11
 */
import { existsSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { brotliCompressSync, constants as zc, gzipSync } from 'node:zlib';
import { init, parse } from 'es-module-lexer';
import { TraceMap, decodedMappings } from '@jridgewell/trace-mapping';

const args = parseArgs(process.argv.slice(2));
const webRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = resolve(args.dist ?? join(webRoot, 'dist'));
const entries = (args.entries ?? 'index.html,member.html,approval.html').split(',').filter((h) => existsSync(join(dist, h)));
const budgetFile = resolve(args.budget ?? join(webRoot, 'bundle-budget.json'));

if (!existsSync(dist) || entries.length === 0) {
  console.error(`未找到构建产物：${dist}（先执行 npm run build）`);
  process.exit(2);
}

await init;

// ─── 载入全部 chunk 与 import 边 ──────────────────────────────────────────────

/**
 * chunk 以 ssetsDir/文件名 为键：分入口构建后不同 assetsDir 下可能出现同名同哈希的运行时 chunk。
 * @type {Map<string, { size: number; code: string; static: Set<string>; dynamic: Set<string>; assetsDir: string; file: string }>}
 */
const chunks = new Map();
const assetDirs = readdirSync(dist, { withFileTypes: true }).filter((d) => d.isDirectory() && /^assets/.test(d.name)).map((d) => d.name);
for (const assetsDir of assetDirs) {
  for (const file of readdirSync(join(dist, assetsDir)).filter((f) => f.endsWith('.js'))) {
    const code = readFileSync(join(dist, assetsDir, file), 'utf8');
    const [imports] = parse(code, file);
    const st = new Set();
    const dy = new Set();
    for (const imp of imports) {
      if (!imp.n || !imp.n.endsWith('.js')) continue;
      (imp.d === -1 ? st : dy).add(`${assetsDir}/${basename(imp.n)}`);
    }
    chunks.set(`${assetsDir}/${file}`, { size: Buffer.byteLength(code), code, static: st, dynamic: dy, assetsDir, file });
  }
}

function closure(roots, exclude = new Set()) {
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n) || exclude.has(n) || !chunks.has(n)) continue;
    seen.add(n);
    for (const d of chunks.get(n).static) stack.push(d);
  }
  return seen;
}

const gz = (buf) => gzipSync(buf, { level: 6 }).length;
const br = (buf) => brotliCompressSync(buf, { params: { [zc.BROTLI_PARAM_QUALITY]: 11 } }).length;
const kb = (n) => Math.round((n / 1024) * 10) / 10;

function measure(set) {
  let raw = 0;
  let g = 0;
  let b = 0;
  let tiny = 0;
  for (const n of set) {
    const c = chunks.get(n);
    const buf = Buffer.from(c.code);
    raw += c.size;
    g += gz(buf);
    b += br(buf);
    if (c.size < 4096) tiny++;
  }
  return { files: set.size, rawKB: kb(raw), gzKB: kb(g), brKB: kb(b), tiny };
}

function findAsset(name) {
  for (const dir of assetDirs) {
    const p = join(dist, name.includes('/') ? name : join(dir, name));
    if (existsSync(p)) return p;
  }
  return null;
}

function measureCss(names) {
  let raw = 0;
  let g = 0;
  for (const n of names) {
    const p = findAsset(n);
    if (!p) continue;
    const buf = readFileSync(p);
    raw += buf.length;
    g += gz(buf);
  }
  return { files: names.length, rawKB: kb(raw), gzKB: kb(g) };
}

// ─── sourcemap 归因（无 .map 时跳过）────────────────────────────────────────

function attribute(set, top = 30) {
  const agg = new Map();
  let mapped = 0;
  for (const name of set) {
    const c = chunks.get(name);
    const mapPath = join(dist, c.assetsDir, `${c.file}.map`);
    if (!existsSync(mapPath)) continue;
    mapped++;
    const map = JSON.parse(readFileSync(mapPath, 'utf8'));
    const tm = new TraceMap(map);
    const lines = c.code.split('\n');
    decodedMappings(tm).forEach((segs, li) => {
      const lineLen = Buffer.byteLength(lines[li] ?? '');
      for (let i = 0; i < segs.length; i++) {
        const [col, srcIdx] = segs[i];
        const end = i + 1 < segs.length ? segs[i + 1][0] : lineLen;
        const key = srcIdx === undefined ? '(generated)' : groupKey(map.sources[srcIdx] ?? '');
        agg.set(key, (agg.get(key) ?? 0) + Math.max(0, end - col));
      }
    });
  }
  if (mapped === 0) return null;
  return [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => ({ source: k, kb: kb(v) }));
}

function groupKey(src) {
  const s = src.replaceAll('\\', '/');
  if (s.includes('/node_modules/')) {
    const seg = s.split('/node_modules/').pop().split('/');
    return `npm:${seg[0].startsWith('@') ? seg.slice(0, 2).join('/') : seg[0]}`;
  }
  const m = s.match(/packages\/(\w+)\/src\/([^/]+)(?:\/([^/]+))?/);
  if (m) return `${m[1]}:${m[2]}${m[3] && !m[3].includes('.') ? `/${m[3]}` : ''}`;
  return s.slice(-60);
}

// ─── 入口分析 ────────────────────────────────────────────────────────────────

function entryInfo(html) {
  const src = readFileSync(join(dist, html), 'utf8');
  // href 形如 /assets-member/xxx.js（或带 base 前缀），取「assetsDir/文件名」
  const pick = (re) => [...src.matchAll(re)].map((m) => m[1].split('/').slice(-2).join('/'));
  return {
    scripts: pick(/<script type="module"[^>]*src="([^"]+\.js)"/g),
    preload: pick(/rel="modulepreload"[^>]*href="([^"]+\.js)"/g),
    css: pick(/rel="stylesheet"[^>]*href="([^"]+\.css)"/g),
  };
}

// 路由 chunk 只在入口自己的 assetsDir 里找：分入口构建后审批端也有自己的 LoginPage / DashboardPage
const findChunk = (re, assetsDir) => [...chunks.entries()].filter(([, c]) => re.test(c.file) && (!assetsDir || c.assetsDir === assetsDir)).map(([k]) => k);
const heavyRe = /(?:^|\/)vendor-(univerjs|monaco|xterm|visactor|maplibre|mermaid|embedpdf|wangeditor|rrweb|emoji|heic2any|exceljs|file-viewer|xyflow|lottie)/;

const report = { generatedAt: new Date().toISOString(), dist, totals: {}, entries: {} };

{
  const all = [...chunks.values()];
  const buckets = { '<4KB': 0, '4-10KB': 0, '10-50KB': 0, '50-200KB': 0, '200-900KB': 0, '>900KB': 0 };
  for (const c of all) {
    const k = c.size / 1024;
    buckets[k < 4 ? '<4KB' : k < 10 ? '4-10KB' : k < 50 ? '10-50KB' : k < 200 ? '50-200KB' : k < 900 ? '200-900KB' : '>900KB']++;
  }
  report.totals = {
    jsChunks: all.length,
    jsTotalMB: Math.round((all.reduce((s, c) => s + c.size, 0) / 1024 / 1024) * 10) / 10,
    histogram: buckets,
    largest: [...chunks.entries()].sort((a, b) => b[1].size - a[1].size).slice(0, 12).map(([n, c]) => ({ file: n, kb: kb(c.size) })),
  };
}

for (const html of entries) {
  const e = entryInfo(html);
  const critical = closure(e.scripts);
  const entryAssetsDir = chunks.get(e.scripts[0])?.assetsDir;
  const dynamicTargets = new Set();
  for (const n of critical) for (const d of chunks.get(n).dynamic) dynamicTargets.add(d);
  const entry = {
    scripts: e.scripts,
    modulepreloadHints: e.preload.length,
    critical: { ...measure(critical), css: measureCss(e.css), files_list: [...critical].sort((a, b) => chunks.get(b).size - chunks.get(a).size) },
    dynamicTargets: dynamicTargets.size,
    heavyInCritical: [...critical].filter((n) => heavyRe.test(n)),
    attribution: attribute(critical),
    routes: {},
  };
  if (html === 'index.html') {
    for (const [label, re] of [['LoginPage', /^LoginPage-/], ['AdminLayout', /^AdminLayout-/], ['DashboardPage', /^DashboardPage-/]]) {
      const roots = findChunk(re, entryAssetsDir);
      if (!roots.length) continue;
      const inc = closure(roots, critical);
      entry.routes[label] = { ...measure(inc), largest: [...inc].sort((a, b) => chunks.get(b).size - chunks.get(a).size).slice(0, 8).map((n) => `${n}(${kb(chunks.get(n).size)}KB)`) };
    }
    const shellRoots = [...findChunk(/^AdminLayout-/, entryAssetsDir), ...findChunk(/^DashboardPage-/, entryAssetsDir)];
    if (shellRoots.length) entry.authenticatedFirstScreen = measure(new Set([...critical, ...closure(shellRoots)]));
  }
  report.entries[html] = entry;
}

// ─── 输出 ────────────────────────────────────────────────────────────────────

if (!args.quiet) console.log(renderText(report));
if (args.json) writeOut(args.json, JSON.stringify(report, null, 2));
if (args.md) writeOut(args.md, renderMarkdown(report));

if (args.check) {
  const budget = JSON.parse(readFileSync(budgetFile, 'utf8'));
  const failures = checkBudget(report, budget);
  if (failures.length) {
    console.error('\n✖ 产物预算检查失败：\n' + failures.map((f) => `  - ${f}`).join('\n'));
    process.exit(1);
  }
  console.log('\n✔ 产物预算检查通过');
}

function checkBudget(rep, budget) {
  const out = [];
  if (budget.maxJsChunks !== undefined && rep.totals.jsChunks > budget.maxJsChunks) out.push(`JS chunk 总数 ${rep.totals.jsChunks} > ${budget.maxJsChunks}`);
  for (const [html, limits] of Object.entries(budget.entries ?? {})) {
    const e = rep.entries[html];
    if (!e) { out.push(`${html}：产物中不存在`); continue; }
    if (limits.maxCriticalFiles !== undefined && e.critical.files > limits.maxCriticalFiles) out.push(`${html} 关键路径文件数 ${e.critical.files} > ${limits.maxCriticalFiles}`);
    if (limits.maxCriticalGzKB !== undefined && e.critical.gzKB > limits.maxCriticalGzKB) out.push(`${html} 关键路径 gz ${e.critical.gzKB} KB > ${limits.maxCriticalGzKB} KB`);
    if (limits.maxCriticalCssFiles !== undefined && e.critical.css.files > limits.maxCriticalCssFiles) out.push(`${html} 关键路径 CSS 文件数 ${e.critical.css.files} > ${limits.maxCriticalCssFiles}`);
    if (e.heavyInCritical.length) out.push(`${html} 关键路径包含重型库：${e.heavyInCritical.join(', ')}`);
    for (const [route, rl] of Object.entries(limits.routes ?? {})) {
      const r = e.routes?.[route];
      if (!r) continue;
      if (rl.maxFiles !== undefined && r.files > rl.maxFiles) out.push(`${html} ${route} 增量文件数 ${r.files} > ${rl.maxFiles}`);
      if (rl.maxGzKB !== undefined && r.gzKB > rl.maxGzKB) out.push(`${html} ${route} 增量 gz ${r.gzKB} KB > ${rl.maxGzKB} KB`);
    }
    if (limits.authenticatedFirstScreen && e.authenticatedFirstScreen) {
      const a = e.authenticatedFirstScreen;
      const l = limits.authenticatedFirstScreen;
      if (l.maxFiles !== undefined && a.files > l.maxFiles) out.push(`${html} 已登录首屏文件数 ${a.files} > ${l.maxFiles}`);
      if (l.maxGzKB !== undefined && a.gzKB > l.maxGzKB) out.push(`${html} 已登录首屏 gz ${a.gzKB} KB > ${l.maxGzKB} KB`);
    }
  }
  return out;
}

function renderText(rep) {
  const L = [];
  L.push(`产物：${rep.dist}`);
  L.push(`JS chunk：${rep.totals.jsChunks} 个，共 ${rep.totals.jsTotalMB} MB；体积分布 ${JSON.stringify(rep.totals.histogram)}`);
  for (const [html, e] of Object.entries(rep.entries)) {
    L.push(`\n===== ${html} =====`);
    L.push(`入口脚本 ${e.scripts.length} 个，modulepreload ${e.modulepreloadHints} 条，静态闭包 ${e.critical.files} 个文件（${e.critical.tiny} 个 < 4KB）`);
    L.push(`关键路径 JS：${e.critical.rawKB} KB raw / ${e.critical.gzKB} KB gz / ${e.critical.brKB} KB br；CSS：${e.critical.css.files} 个 / ${e.critical.css.gzKB} KB gz`);
    if (e.heavyInCritical.length) L.push(`⚠ 关键路径含重型库：${e.heavyInCritical.join(', ')}`);
    L.push(`最大文件：${e.critical.files_list.slice(0, 8).map((n) => `${n}(${kb(chunks.get(n).size)}KB)`).join(', ')}`);
    for (const [route, r] of Object.entries(e.routes)) L.push(`${route} 增量：${r.files} 个文件 / ${r.gzKB} KB gz（${r.tiny} 个 < 4KB）`);
    if (e.authenticatedFirstScreen) L.push(`已登录首屏合计：${e.authenticatedFirstScreen.files} 个文件 / ${e.authenticatedFirstScreen.gzKB} KB gz / ${e.authenticatedFirstScreen.brKB} KB br`);
    if (e.attribution) L.push('关键路径归因（前 12）：' + e.attribution.slice(0, 12).map((a) => `${a.source} ${a.kb}KB`).join('，'));
  }
  return L.join('\n');
}

function renderMarkdown(rep) {
  const L = [`> 生成时间 ${rep.generatedAt}；口径见 \`packages/web/scripts/bundle-analyze.mjs\` 头部注释。`, ''];
  L.push('| 指标 | 值 |', '| --- | --- |');
  L.push(`| JS chunk 总数 | ${rep.totals.jsChunks} |`, `| JS 总体积 | ${rep.totals.jsTotalMB} MB |`, `| < 4 KB 的 chunk | ${rep.totals.histogram['<4KB']} |`, `| > 900 KB 的 chunk | ${rep.totals.histogram['>900KB']} |`);
  for (const [html, e] of Object.entries(rep.entries)) {
    L.push('', `### ${html}`, '', '| 指标 | 文件数 | raw KB | gz KB | br KB |', '| --- | --- | --- | --- | --- |');
    L.push(`| 关键路径 JS | ${e.critical.files}（${e.critical.tiny} 个 < 4 KB） | ${e.critical.rawKB} | ${e.critical.gzKB} | ${e.critical.brKB} |`);
    L.push(`| 关键路径 CSS | ${e.critical.css.files} | ${e.critical.css.rawKB} | ${e.critical.css.gzKB} | — |`);
    for (const [route, r] of Object.entries(e.routes)) L.push(`| ${route} 增量 | ${r.files}（${r.tiny} 个 < 4 KB） | ${r.rawKB} | ${r.gzKB} | ${r.brKB} |`);
    if (e.authenticatedFirstScreen) L.push(`| 已登录首屏合计 | ${e.authenticatedFirstScreen.files} | ${e.authenticatedFirstScreen.rawKB} | ${e.authenticatedFirstScreen.gzKB} | ${e.authenticatedFirstScreen.brKB} |`);
    L.push('', `modulepreload 提示 ${e.modulepreloadHints} 条；关键路径可达的动态 import 目标 ${e.dynamicTargets} 个${e.heavyInCritical.length ? `；**关键路径含重型库：${e.heavyInCritical.join(', ')}**` : ''}。`);
    if (e.attribution) {
      L.push('', '关键路径体积归因（压缩前，前 15）：', '', '| 来源 | KB |', '| --- | --- |');
      for (const a of e.attribution.slice(0, 15)) L.push(`| \`${a.source}\` | ${a.kb} |`);
    }
  }
  return L.join('\n') + '\n';
}

function writeOut(file, content) {
  const p = resolve(file);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, content);
  console.log(`已写入 ${p}`);
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) { out[key] = next; i++; } else out[key] = true;
  }
  return out;
}
