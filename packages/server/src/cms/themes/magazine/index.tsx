/**
 * magazine 资讯杂志主题：暗色数字媒体形态——焦点大图首页 + 卡片流列表 +
 * 评分徽章详情（ratingField 主题参数指定评分字段），适合游戏/科技/数码/影视资讯站。
 *
 * 模型字段的两种消费方式在此示范：
 * - 列表卡片消费 item.modelFields（showInList 字段）渲染角标；
 * - 详情页把 ratingField 拆出来渲染为大评分徽章，其余字段行内标签展示。
 */
import type { ReactNode } from 'react';
import type {
  CmsBaseContext, CmsContentItem, CmsListContext, CmsDetailContext,
  CmsPageContext, CmsSearchContext, CmsTagPageContext, CmsNotFoundContext,
  CmsTheme, CmsThemeContentCollection, CmsModelFieldValue,
} from '../types';
import { SeoHead, Breadcrumbs, Pagination, MediaBlock, ArticleNav, RelatedArticles, AttachmentList, ThemeFooterLinks, buildAnalyticsBeacon } from '../_shared';
import { defineHomeTemplate } from '../sdk';
import { renderCmsWidgetHtml } from '../widgets';
import { CMS_WIDGET_RENDERER_KEYS } from '@zenith/shared/cms';

const TYPE_LABELS: Record<string, string | null> = { article: null, album: '图集', media: '视频', link: '外链' };

// ─── 布局 ─────────────────────────────────────────────────────────────────────

function MagLayout({ ctx, currentUrl, children }: { ctx: CmsBaseContext; currentUrl?: string; children: ReactNode }) {
  const { site, nav, friendLinkGroups, baseUrl } = ctx;
  const footerText = typeof site.themeConfig.footerText === 'string' ? site.themeConfig.footerText : null;
  return (
    <html lang="zh-CN">
      <SeoHead ctx={ctx} langAlternates />
      <body>
        {ctx.analytics ? <script dangerouslySetInnerHTML={{ __html: buildAnalyticsBeacon(ctx.analytics) }} /> : null}
        <header className="topbar">
          <div className="w1200">
            <a className="brand" href={`${baseUrl}/`}>
              {site.logo ? <img src={site.logo} alt={site.name} /> : null}
              <span>{site.name}<span className="dot">.</span></span>
            </a>
            <nav className="top-nav">
              <a href={`${baseUrl}/`} className={currentUrl === `${baseUrl}/` ? 'active' : undefined}>首页</a>
              {nav.map((item) => (
                <a key={item.id} href={item.url} target={item.target} className={currentUrl === item.url ? 'active' : undefined}>
                  {item.name}
                </a>
              ))}
            </nav>
            <form className="top-search" action={ctx.searchUrl} method="get">
              <input type="search" name="q" placeholder="搜索游戏 / 文章" />
              <button type="submit">搜索</button>
            </form>
          </div>
        </header>
        <main>
          <div className="w1200">{children}</div>
        </main>
        <footer className="mag-footer">
          <div className="w1200">
            <ThemeFooterLinks
              friendLinkGroups={friendLinkGroups}
              footerText={footerText}
              site={site}
              classNames={{ links: 'links', extra: 'extra' }}
            />
          </div>
        </footer>
      </body>
    </html>
  );
}

// ─── 公共片段 ─────────────────────────────────────────────────────────────────

function ratingFieldName(ctx: CmsBaseContext): string {
  return typeof ctx.site.themeConfig.ratingField === 'string' && ctx.site.themeConfig.ratingField.trim()
    ? ctx.site.themeConfig.ratingField.trim()
    : 'score';
}

/** 从模型字段中拆出评分字段：徽章单独渲染，其余字段照常展示 */
function splitRating(fields: CmsModelFieldValue[], ratingName: string): { rating: CmsModelFieldValue | null; rest: CmsModelFieldValue[] } {
  const rating = fields.find((f) => f.name === ratingName && f.displayValue !== '') ?? null;
  return { rating, rest: fields.filter((f) => f !== rating && f.displayValue !== '') };
}

function MagCard({ item, ratingName }: { item: CmsContentItem; ratingName: string }) {
  const { rating, rest } = splitRating(item.modelFields, ratingName);
  const typeLabel = TYPE_LABELS[item.contentType] ?? null;
  const cover = item.coverThumb ?? item.coverImage;
  return (
    <a className="mag-card" href={item.url} {...(item.isExternal ? { target: '_blank', rel: 'noopener nofollow' } : {})}>
      {cover ? <img className="cover" src={cover} alt={item.title} loading="lazy" /> : null}
      {typeLabel ? <span className="type-badge">{typeLabel}{item.contentType === 'album' && item.imageCount > 1 ? `·${item.imageCount}` : ''}</span> : null}
      {rating ? <span className="rating-corner">{rating.displayValue}</span> : null}
      <div className="bd">
        <h3>{item.title}</h3>
        {rest.length > 0 ? (
          <div className="chips">
            {rest.map((f) => <span key={f.name} className="chip" title={f.label}>{f.displayValue}</span>)}
          </div>
        ) : null}
        <div className="meta">
          {item.publishedAt ? <time>{item.publishedAt.slice(0, 10)}</time> : null}
          <span>{item.viewCount} 浏览</span>
        </div>
      </div>
    </a>
  );
}

function RankList({ title, items }: { title: string; items: CmsContentItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rank-list">
      <h2>{title}</h2>
      <ul>
        {items.slice(0, 10).map((item, i) => (
          <li key={item.id}>
            <span className="no">{i + 1}</span>
            <a href={item.url}>{item.title}</a>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ─── 首页（Theme API：load 声明式取数）────────────────────────────────────────

type HomeBlock = CmsThemeContentCollection & { channel: NonNullable<CmsThemeContentCollection['channel']> };

const HomeTemplate = defineHomeTemplate({
  load: async ({ cms, site }) => {
    const raw = typeof site.themeConfig.homeChannels === 'string' ? site.themeConfig.homeChannels : '';
    const codes = raw.split(/[,，]/).map((code) => code.trim()).filter(Boolean).slice(0, 6);
    const blocks = await Promise.all(codes.map((code) => cms.contents.list({ channelCode: code, limit: 8 })));
    return { blocks: blocks.filter((block): block is HomeBlock => block.channel !== null) };
  },
  Component: ({ data, ...ctx }) => {
    const ratingName = ratingFieldName(ctx);
    const [heroMain, ...heroSide] = ctx.latest;
    return (
      <MagLayout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
        {heroMain ? (
          <div className="hero-grid">
            <a className="hero-main" href={heroMain.url}>
              {heroMain.coverImage ? <img src={heroMain.coverImage} alt={heroMain.title} /> : null}
              <span className="hero-mask" />
              <span className="hero-txt">
                <h3>{heroMain.title}</h3>
                {heroMain.summary ? <span className="hero-sub">{heroMain.summary}</span> : null}
              </span>
            </a>
            <div className="hero-side">
              {heroSide.slice(0, 4).map((item) => (
                <a key={item.id} href={item.url}>
                  {(item.coverThumb ?? item.coverImage) ? <img src={item.coverThumb ?? item.coverImage!} alt={item.title} loading="lazy" /> : null}
                  <span>
                    <span className="t">{item.title}</span>
                    {item.publishedAt ? <time>{item.publishedAt.slice(0, 10)}</time> : null}
                  </span>
                </a>
              ))}
            </div>
          </div>
        ) : null}
        <div className="home-cols">
          <div>
            {data.blocks.map((block) => (
              <section key={block.channel.code}>
                <div className="sec-hd">
                  <h2>{block.channel.name}</h2>
                  <a className="more" href={block.channel.url}>更多 →</a>
                </div>
                <div className="mag-grid">
                  {block.list.slice(0, 4).map((item) => <MagCard key={item.id} item={item} ratingName={ratingName} />)}
                </div>
              </section>
            ))}
            {data.blocks.length === 0 ? (
              <section>
                <div className="sec-hd"><h2>最新发布</h2></div>
                <div className="mag-grid">
                  {ctx.latest.slice(0, 8).map((item) => <MagCard key={item.id} item={item} ratingName={ratingName} />)}
                </div>
              </section>
            ) : null}
          </div>
          <aside>
            {ctx.homeSidebar ? <div dangerouslySetInnerHTML={{ __html: renderCmsWidgetHtml(ctx.homeSidebar) }} /> : null}
            <RankList title="热门排行" items={ctx.hot} />
          </aside>
        </div>
      </MagLayout>
    );
  },
});

// ─── 列表 / 详情 ──────────────────────────────────────────────────────────────

function ListTemplate(ctx: CmsListContext) {
  const ratingName = ratingFieldName(ctx);
  return (
    <MagLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      {ctx.items.length === 0 ? <div className="empty">该栏目暂无内容</div> : (
        <div className="list-grid">
          {ctx.items.map((item) => <MagCard key={item.id} item={item} ratingName={ratingName} />)}
        </div>
      )}
      <Pagination p={ctx.pagination} />
    </MagLayout>
  );
}

function DetailTemplate(ctx: CmsDetailContext) {
  const { content } = ctx;
  const ratingName = ratingFieldName(ctx);
  const { rating, rest } = splitRating(content.modelFields, ratingName);
  return (
    <MagLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article">
        {content.coverImage && content.contentType === 'article' ? (
          <div className="article-hero"><img src={content.coverImage} alt={content.title} /></div>
        ) : null}
        <h1>{content.title}</h1>
        <div className="meta">
          {content.author ? <span>{content.author}</span> : null}
          {content.source ? <span>来源：{content.source}</span> : null}
          {content.publishedAt ? <time>{content.publishedAt}</time> : null}
          <span>{content.viewCount} 浏览</span>
        </div>
        {(rating || rest.length > 0) ? (
          <div className="review-panel">
            {rating ? (
              <div className="review-score">
                {rating.displayValue}
                <small>{rating.label}</small>
              </div>
            ) : null}
            <div className="review-facts">
              {rest.map((f) => (
                <span key={f.name}><span className="k">{f.label}</span>{f.displayValue}</span>
              ))}
            </div>
          </div>
        ) : null}
        <MediaBlock content={content} />
        <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
        <AttachmentList items={content.attachments} />
        {content.tags.length > 0 ? (
          <div className="tags-row">
            {content.tags.map((t) => <a key={t.slug} className="chip" href={t.url}>{t.name}</a>)}
          </div>
        ) : null}
      </article>
      <ArticleNav prev={content.prev} next={content.next} />
      <RelatedArticles items={ctx.related} />
    </MagLayout>
  );
}

// ─── 单页 / 搜索 / 标签 / 404 ─────────────────────────────────────────────────

function PageTemplate(ctx: CmsPageContext) {
  return (
    <MagLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article">
        <h1>{ctx.channel.name}</h1>
        <div className="body" dangerouslySetInnerHTML={{ __html: ctx.contentHtml }} />
      </article>
    </MagLayout>
  );
}

function SearchTemplate(ctx: CmsSearchContext) {
  return (
    <MagLayout ctx={ctx}>
      <h1 className="page-title">搜索「{ctx.keyword}」</h1>
      <div className="content-list search-result">
        {ctx.results.length === 0 ? (
          <div className="empty">未找到相关内容</div>
        ) : ctx.results.map((r) => (
          <div className="content-item" key={r.id}>
            <a
              href={r.isExternal ? r.url : `${ctx.baseUrl}${r.url}`}
              {...(r.isExternal ? { target: '_blank', rel: 'noopener nofollow' } : {})}
              dangerouslySetInnerHTML={{ __html: r.titleHighlight }}
            />
            {r.publishedAt ? <time>{r.publishedAt.slice(0, 10)}</time> : null}
          </div>
        ))}
      </div>
      <Pagination p={ctx.pagination} />
    </MagLayout>
  );
}

function TagTemplate(ctx: CmsTagPageContext) {
  const ratingName = ratingFieldName(ctx);
  return (
    <MagLayout ctx={ctx}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">#{ctx.tag.name}（{ctx.tag.contentCount}）</h1>
      {ctx.items.length === 0 ? <div className="empty">暂无内容</div> : (
        <div className="list-grid">
          {ctx.items.map((item) => <MagCard key={item.id} item={item} ratingName={ratingName} />)}
        </div>
      )}
      <Pagination p={ctx.pagination} />
    </MagLayout>
  );
}

function NotFoundTemplate(ctx: CmsNotFoundContext) {
  return (
    <MagLayout ctx={ctx}>
      <div className="empty">
        <h1 className="page-title">404 页面不存在</h1>
        <p>您访问的页面不存在或已被移除：{ctx.path}</p>
        <p><a href={`${ctx.baseUrl}/`} style={{ color: 'var(--primary)' }}>返回首页</a></p>
      </div>
    </MagLayout>
  );
}

// ─── 主题注册 ─────────────────────────────────────────────────────────────────

export const magazineTheme: CmsTheme = {
  code: 'magazine',
  label: '资讯杂志',
  templates: {
    index: HomeTemplate,
    list: ListTemplate,
    detail: DetailTemplate,
    page: PageTemplate,
    search: SearchTemplate,
    tag: TagTemplate,
    notFound: NotFoundTemplate,
  },
  settingsSchema: [
    { name: 'homeChannels', label: '首页栏目区块', fieldType: 'text', group: '首页', placeholder: '如 reviews,news,guides', description: '逗号分隔栏目标识（最多 6 个），每个渲染一行 4 张卡片；留空回落全站最新发布' },
    { name: 'ratingField', label: '评分字段标识', fieldType: 'text', group: '内容', placeholder: 'score', description: '内容模型中作为评分的字段标识：详情页渲染大评分徽章、卡片渲染角标；留空默认 score' },
    { name: 'footerText', label: '页脚附加文案', fieldType: 'textarea', group: '页脚', placeholder: '联系邮箱、合作信息等，支持多行' },
  ],
  widgetSlots: [{
    key: 'home.sidebar',
    label: '首页侧栏',
    allowedTypes: ['manual-list'],
    rendererKeys: [...CMS_WIDGET_RENDERER_KEYS],
  }],
};
