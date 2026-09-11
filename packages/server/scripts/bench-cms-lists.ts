/**
 * CMS 列表读路径基准：在本地库里生成一个专用基准站点（确定性伪随机数据），
 * 对前台列表 / 首页 / 标签页 / 详情侧栏 / 搜索 / 后台列表 / 主题数据门面 / 整页渲染 / RSS
 * 逐项计时，并记录每次调用在 PG 侧读取的 cms_contents 堆块与 TOAST 块数、以及交给渲染层 / HTTP 层的 JSON 字节数。
 *
 * 用法（packages/server 目录，需 .env 指向可写的本地库、Redis 可用）：
 *   npx tsx scripts/bench-cms-lists.ts                              # 默认 3000 篇 × 30KB 正文，7 轮取中位数
 *   npx tsx scripts/bench-cms-lists.ts --contents 3000 --body-kb 30 --runs 7 --out ../../docs/backend/perf/cms-lists.json
 *   npx tsx scripts/bench-cms-lists.ts --cleanup                    # 删除基准站点（级联清理全部数据）
 *
 * 数据可重复：同一参数下重复运行不重复建站；正文 / 标志位 / 时间分布由固定种子生成，改造前后可直接对比。
 * PG 块统计依赖 pg_stat_force_next_flush()（PG 15+），把连接池里每个后端的统计立即刷到共享内存后再读。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import { and, asc, eq, sql } from 'drizzle-orm';
import { db } from '../src/db';
import { config } from '../src/config';
import {
  cmsChannels, cmsContentChannels, cmsContentRelations, cmsContentTags, cmsContents, cmsSites, cmsTags,
} from '../src/db/schema';
import type { CmsChannelRow, CmsContentRow, CmsSiteRow } from '../src/db/schema';
import { runWithCurrentUser } from '../src/lib/context';
import {
  getAdjacentContents, listCmsContents, listHomeContents, listPublishedContents, listPublishedContentsByTag, listRelatedContents,
} from '../src/services/cms/cms-contents-query.service';
import { searchCmsContents } from '../src/services/cms/cms-search.service';
import { createCmsThemeDataApi, generateRssXml, renderChannelPage, renderHomePage } from '../src/services/cms/cms-render.service';
import { arg, flag } from './lib/cli-args';

const SITE_CODE = 'bench-cms';
const CONTENTS = Number(arg('contents', '3000'));
const BODY_KB = Number(arg('body-kb', '30'));
const RUNS = Number(arg('runs', '7'));
const OUT = arg('out', '');
const CLEANUP = flag('cleanup');
const CHANNEL_COUNT = 5;
const TAG_COUNT = 12;

// ─── 确定性伪随机 ─────────────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const SYLLABLES = ['ka', 'zen', 'mo', 'ri', 'ta', 'lu', 'ne', 'vo', 'si', 'dra', 'pel', 'mun', 'tor', 'ay', 'quin', 'sol', 'ith', 'bra', 'fen', 'gol'];
function buildVocabulary(rand: () => number, size: number): string[] {
  const words = new Set<string>();
  while (words.size < size) {
    const parts = 2 + Math.floor(rand() * 3);
    let w = '';
    for (let i = 0; i < parts; i++) w += SYLLABLES[Math.floor(rand() * SYLLABLES.length)];
    words.add(w);
  }
  return [...words];
}

function buildBody(rand: () => number, vocab: string[], index: number, targetBytes: number): { html: string; plain: string } {
  const paragraphs: string[] = [];
  const plainParts: string[] = [];
  let bytes = 0;
  let p = 0;
  while (bytes < targetBytes) {
    const words: string[] = [];
    const count = 60 + Math.floor(rand() * 60);
    for (let i = 0; i < count; i++) {
      // 每 ~200 词插入检索关键词，保证搜索场景有大量命中
      words.push(i % 200 === 17 ? 'zenith' : vocab[Math.floor(rand() * vocab.length)]);
    }
    const text = words.join(' ');
    plainParts.push(text);
    let block = `<p>${text}</p>`;
    if (p % 4 === 3) block = `<h2>Section ${p >> 2}</h2>${block}`;
    if (p % 6 === 5) block += `<p><img src="/uploads/bench/img-${index}-${p}.jpg" alt=""></p>`;
    paragraphs.push(block);
    bytes += block.length;
    p += 1;
  }
  // 10% 内容带正文分页标记（静态构建需要数页数）
  if (index % 10 === 3 && paragraphs.length > 2) paragraphs.splice(paragraphs.length >> 1, 0, '<p>[分页]</p>');
  return { html: paragraphs.join('\n'), plain: plainParts.join(' ').slice(0, 20000) };
}

// ─── 基准站点数据 ─────────────────────────────────────────────────────────────
async function findBenchSite(): Promise<CmsSiteRow | null> {
  const [site] = await db.select().from(cmsSites).where(eq(cmsSites.code, SITE_CODE)).limit(1);
  return site ?? null;
}

async function cleanup(): Promise<void> {
  const site = await findBenchSite();
  if (!site) {
    console.log('基准站点不存在，无需清理');
    return;
  }
  await db.delete(cmsSites).where(eq(cmsSites.id, site.id));
  console.log(`已删除基准站点 #${site.id}（内容 / 栏目 / 标签级联清理）`);
}

async function ensureBenchData(): Promise<{ site: CmsSiteRow; channels: CmsChannelRow[] }> {
  let site = await findBenchSite();
  if (site) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(cmsContents).where(eq(cmsContents.siteId, site.id));
    if (count === CONTENTS) {
      const channels = await db.select().from(cmsChannels).where(eq(cmsChannels.siteId, site.id)).orderBy(asc(cmsChannels.id));
      console.log(`复用基准站点 #${site.id}：${count} 篇内容`);
      return { site, channels };
    }
    console.log(`基准站点内容数 ${count} ≠ ${CONTENTS}，重建`);
    await db.delete(cmsSites).where(eq(cmsSites.id, site.id));
    site = null;
  }

  const started = performance.now();
  const rand = mulberry32(20260906);
  const vocab = buildVocabulary(rand, 1500);
  const [created] = await db.insert(cmsSites).values({
    name: 'CMS 列表基准站点',
    code: SITE_CODE,
    title: 'CMS 列表基准站点',
    theme: 'default',
    staticMode: 'dynamic',
    status: 'enabled',
    remark: 'scripts/bench-cms-lists.ts 生成，可用 --cleanup 删除',
  }).returning();
  site = created;
  const channels = await db.insert(cmsChannels).values(Array.from({ length: CHANNEL_COUNT }, (_, i) => ({
    siteId: site!.id,
    parentId: 0,
    name: `基准栏目 ${i + 1}`,
    code: `bench-c${i + 1}`,
    slug: `bc${i + 1}`,
    path: `bc${i + 1}`,
    type: 'list' as const,
    pageSize: 20,
    sort: i,
  }))).returning();
  const tags = await db.insert(cmsTags).values(Array.from({ length: TAG_COUNT }, (_, i) => ({
    siteId: site!.id, name: `基准标签${i + 1}`, slug: `bench-tag-${i + 1}`,
  }))).returning();

  const base = Date.UTC(2026, 0, 1);
  const BATCH = 50;
  const tagRows: { contentId: number; tagId: number }[] = [];
  const extraChannelRows: { contentId: number; channelId: number }[] = [];
  const relationRows: { contentId: number; relatedId: number; sort: number }[] = [];
  const ids: number[] = [];
  for (let start = 0; start < CONTENTS; start += BATCH) {
    const rows = [];
    for (let i = start; i < Math.min(CONTENTS, start + BATCH); i++) {
      const channel = channels[i % CHANNEL_COUNT];
      const { html, plain } = buildBody(rand, vocab, i, BODY_KB * 1024);
      const title = `基准内容 ${i + 1}：${vocab[Math.floor(rand() * vocab.length)]} ${vocab[Math.floor(rand() * vocab.length)]}`;
      const hasSummary = rand() < 0.5;
      rows.push({
        siteId: site.id,
        channelId: channel.id,
        title,
        summary: hasSummary ? `摘要 ${i + 1}：${plain.slice(0, 80)}` : null,
        coverImage: rand() < 0.6 ? `/uploads/bench/cover-${i}.jpg` : null,
        author: `作者${i % 17}`,
        body: html,
        hasImage: true,
        isTop: rand() < 0.02,
        topWeight: 0,
        isRecommend: rand() < 0.1,
        isHot: rand() < 0.1,
        status: 'published' as const,
        publishedAt: new Date(base + i * 60_000),
        viewCount: Math.floor(rand() * 10_000),
        searchVector: sql`setweight(to_tsvector('simple', ${title}), 'A') || setweight(to_tsvector('simple', ${plain}), 'C')`,
      });
    }
    const inserted = await db.insert(cmsContents).values(rows).returning({ id: cmsContents.id });
    for (const [offset, row] of inserted.entries()) {
      const i = start + offset;
      ids.push(row.id);
      tagRows.push({ contentId: row.id, tagId: tags[i % TAG_COUNT].id });
      if (i % 3 === 0) tagRows.push({ contentId: row.id, tagId: tags[(i * 7 + 1) % TAG_COUNT].id });
      if (i % 20 === 0) extraChannelRows.push({ contentId: row.id, channelId: channels[(i + 1) % CHANNEL_COUNT].id });
    }
    process.stdout.write(`\r已写入 ${Math.min(CONTENTS, start + BATCH)}/${CONTENTS}`);
  }
  process.stdout.write('\n');
  for (let i = 0; i < ids.length; i++) {
    if (i % 5 === 0) {
      for (let k = 1; k <= 3; k++) relationRows.push({ contentId: ids[i], relatedId: ids[(i + k * 37) % ids.length], sort: k });
    }
  }
  for (let start = 0; start < tagRows.length; start += 1000) await db.insert(cmsContentTags).values(tagRows.slice(start, start + 1000)).onConflictDoNothing();
  for (let start = 0; start < extraChannelRows.length; start += 1000) await db.insert(cmsContentChannels).values(extraChannelRows.slice(start, start + 1000)).onConflictDoNothing();
  for (let start = 0; start < relationRows.length; start += 1000) await db.insert(cmsContentRelations).values(relationRows.slice(start, start + 1000)).onConflictDoNothing();
  await db.execute(sql`update ${cmsTags} set content_count = (select count(*) from ${cmsContentTags} where ${cmsContentTags.tagId} = ${cmsTags.id}) where ${cmsTags.siteId} = ${site.id}`);
  await db.execute(sql`analyze ${cmsContents}`);
  console.log(`基准站点 #${site.id} 生成完成：${CONTENTS} 篇 × ~${BODY_KB}KB，用时 ${((performance.now() - started) / 1000).toFixed(1)}s`);
  return { site, channels };
}

// ─── PG 侧统计 ────────────────────────────────────────────────────────────────
interface Statio { heap: number; toast: number }

async function flushPgStats(): Promise<void> {
  // 连接池里每个后端各自持有未刷出的统计；并发发起 max 次强制刷新，覆盖全部活跃后端
  await Promise.all(Array.from({ length: config.database.maxConnections }, () => db.execute(sql`select pg_stat_force_next_flush()`)));
  await new Promise((r) => setTimeout(r, 200));
}

async function readStatio(): Promise<Statio> {
  await flushPgStats();
  const rows = await db.execute<{ heap: string; toast: string }>(sql`
    select (coalesce(heap_blks_hit, 0) + coalesce(heap_blks_read, 0))::text as heap,
           (coalesce(toast_blks_hit, 0) + coalesce(toast_blks_read, 0))::text as toast
    from pg_statio_user_tables where relname = 'cms_contents'`);
  const row = rows[0];
  return { heap: Number(row?.heap ?? 0), toast: Number(row?.toast ?? 0) };
}

// ─── 计时 ─────────────────────────────────────────────────────────────────────
interface CaseResult {
  name: string;
  description: string;
  runs: number;
  medianMs: number;
  minMs: number;
  /** 交给下游（渲染层 / HTTP 响应）的 JSON 字节数；渲染类用 HTML 字节数 */
  payloadBytes: number;
  /** 单次调用读取的 cms_contents 堆块 / TOAST 块（8KB/块） */
  heapBlksPerCall: number;
  toastBlksPerCall: number;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

async function measure(name: string, description: string, fn: () => Promise<unknown>, payloadOf: (value: unknown) => number): Promise<CaseResult> {
  await fn(); // 预热：素材缓存、分词词典、模块懒加载
  const before = await readStatio();
  const times: number[] = [];
  let payloadBytes = 0;
  for (let i = 0; i < RUNS; i++) {
    const startedAt = performance.now();
    const value = await fn();
    times.push(performance.now() - startedAt);
    payloadBytes = payloadOf(value);
  }
  const after = await readStatio();
  const result: CaseResult = {
    name,
    description,
    runs: RUNS,
    medianMs: Number(median(times).toFixed(1)),
    minMs: Number(Math.min(...times).toFixed(1)),
    payloadBytes,
    heapBlksPerCall: Math.round((after.heap - before.heap) / RUNS),
    toastBlksPerCall: Math.round((after.toast - before.toast) / RUNS),
  };
  console.log(`${name.padEnd(22)} ${String(result.medianMs).padStart(8)} ms  payload ${(payloadBytes / 1024).toFixed(0).padStart(7)} KB  heap ${String(result.heapBlksPerCall).padStart(6)} blk  toast ${String(result.toastBlksPerCall).padStart(6)} blk`);
  return result;
}

const jsonBytes = (value: unknown) => Buffer.byteLength(JSON.stringify(value));
const htmlBytes = (value: unknown) => Buffer.byteLength(String((value as { html?: string }).html ?? value));

async function main(): Promise<void> {
  if (CLEANUP) {
    await cleanup();
    return;
  }
  const { site, channels } = await ensureBenchData();
  const channel = channels[0];
  const [tag] = await db.select().from(cmsTags).where(eq(cmsTags.siteId, site.id)).orderBy(asc(cmsTags.id)).limit(1);
  const [midRow] = await db.select().from(cmsContents)
    .where(and(eq(cmsContents.siteId, site.id), eq(cmsContents.channelId, channel.id)))
    .orderBy(asc(cmsContents.id)).offset(Math.floor(CONTENTS / CHANNEL_COUNT / 2)).limit(1) as CmsContentRow[];
  const sizeRows = await db.execute<{ total: string; toast: string; avg_body: string }>(sql`
    select pg_total_relation_size('cms_contents')::text as total,
           coalesce(pg_total_relation_size(reltoastrelid), 0)::text as toast,
           (select avg(length(body))::int from cms_contents where site_id = ${site.id})::text as avg_body
    from pg_class where relname = 'cms_contents'`);
  const admin = { userId: 1, username: 'admin', roles: ['super_admin'], tenantId: null };
  const baseUrl = `/__cms/${SITE_CODE}`;
  const deepPage = Math.max(2, Math.floor(CONTENTS / CHANNEL_COUNT / 20 / 2));

  console.log(`\n数据集：${CONTENTS} 篇，平均正文 ${(Number(sizeRows[0]?.avg_body ?? 0) / 1024).toFixed(1)} KB，cms_contents 总大小 ${(Number(sizeRows[0]?.total ?? 0) / 1048576).toFixed(0)} MB（TOAST ${(Number(sizeRows[0]?.toast ?? 0) / 1048576).toFixed(0)} MB），${RUNS} 轮取中位数\n`);

  const results: CaseResult[] = [];
  results.push(await measure('channel-page-1', '栏目分页第 1 页（20 行）listPublishedContents', () => listPublishedContents(site.id, channel.id, 1, 20), (v) => jsonBytes((v as { rows: unknown }).rows)));
  results.push(await measure('channel-page-deep', `栏目分页第 ${deepPage} 页（20 行）`, () => listPublishedContents(site.id, channel.id, deepPage, 20), (v) => jsonBytes((v as { rows: unknown }).rows)));
  results.push(await measure('home-blocks', '首页最新 / 推荐 / 热门（3 × 10 行）listHomeContents', () => listHomeContents(site.id), jsonBytes));
  results.push(await measure('tag-page-1', '标签聚合页第 1 页（20 行）listPublishedContentsByTag', () => listPublishedContentsByTag(site.id, tag.id, 1, 20), (v) => jsonBytes((v as { rows: unknown }).rows)));
  results.push(await measure('detail-siblings', '详情页上下篇 + 相关文章（≤ 7 行）', async () => {
    const [adjacent, related] = await Promise.all([getAdjacentContents(midRow), listRelatedContents(midRow)]);
    return { adjacent, related };
  }, jsonBytes));
  results.push(await measure('search-page-1', '站内搜索第 1 页（20 行）searchCmsContents', () => searchCmsContents({ siteId: site.id, keyword: 'zenith', page: 1, pageSize: 20, skipAccessCheck: true }), jsonBytes));
  results.push(await measure('admin-list-page-1', '后台内容列表第 1 页（20 行，即 HTTP 响应体）listCmsContents', () => runWithCurrentUser(admin, () => listCmsContents({ siteId: site.id, page: 1, pageSize: 20 })), jsonBytes));
  results.push(await measure('theme-load-100', '主题 load() 数据门面 contents.list limit=100', () => createCmsThemeDataApi(site, baseUrl).contents.list({ limit: 100 }), jsonBytes));
  results.push(await measure('render-channel', '整页 SSR：栏目列表页（缓存 miss 路径）renderChannelPage', () => renderChannelPage(site, baseUrl, channel, 1), htmlBytes));
  results.push(await measure('render-home', '整页 SSR：首页（缓存 miss 路径）renderHomePage', () => renderHomePage(site, baseUrl, undefined, { skipTakeover: true }), htmlBytes));
  results.push(await measure('rss', '站点 RSS（50 行）generateRssXml', () => generateRssXml(site), (v) => Buffer.byteLength(String(v))));

  const report = {
    generatedAt: new Date().toISOString(),
    dataset: {
      contents: CONTENTS,
      bodyKb: BODY_KB,
      avgBodyBytes: Number(sizeRows[0]?.avg_body ?? 0),
      tableBytes: Number(sizeRows[0]?.total ?? 0),
      toastBytes: Number(sizeRows[0]?.toast ?? 0),
    },
    runs: RUNS,
    results,
  };
  if (OUT) {
    const file = resolve(OUT);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\n已写入 ${file}`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
