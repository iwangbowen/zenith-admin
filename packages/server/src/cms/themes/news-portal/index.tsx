/**
 * news-portal 新闻门户主题：报纸风格 —— 居中大报头 + 主色主导航横条 +
 * 首页头条区（大标题 + 摘要 + 子链）+ 多栏新闻区块 + 热点排行侧栏 + 新闻详情（来源/记者/责编脚注）。
 *
 * 变体模板（栏目/内容级按需选用）：
 * - list-headline：纯标题两栏列表（时政要闻/通知类栏目）
 * - list-photo：图片网格（图片新闻/视觉栏目）
 * - detail-plain：简洁正文（公告/启事，弱化新闻元信息）
 * - detail-wide：宽幅版式（视频/图集等大屏内容）
 *
 * 适用：地方日报融媒体、行业资讯门户等以"时效新闻流"为主的站点。
 */
import type { ReactNode } from 'react';
import type {
  CmsBaseContext, CmsContentItem, CmsListContext, CmsDetailContext,
  CmsPageContext, CmsSearchContext, CmsTagPageContext, CmsNotFoundContext,
  CmsTheme, CmsThemeContentCollection,
} from '../types';
import { SeoHead, Breadcrumbs, Pagination, ModelFieldTable, MediaBlock, ArticleNav, RelatedArticles, AttachmentList, ThemeFooterLinks, buildAnalyticsBeacon, externalLinkProps, searchResultHref, PublishedDate, SinglePageArticle, TagLinks } from '../_shared';
import { defineHomeTemplate } from '../sdk';
import { renderCmsWidgetHtml } from '../widgets';
import { CMS_WIDGET_RENDERER_KEYS } from '@zenith/shared/cms';

function NewsLayout({ ctx, currentUrl, children }: { ctx: CmsBaseContext; currentUrl?: string; children: ReactNode }) {
  const { site, nav, friendLinks, baseUrl } = ctx;
  const slogan = typeof site.themeConfig.slogan === 'string' ? site.themeConfig.slogan : '';
  const footerText = typeof site.themeConfig.footerText === 'string' ? site.themeConfig.footerText : null;
  return (
    <html lang="zh-CN">
      <SeoHead ctx={ctx} />
      <body>
        {ctx.analytics ? <script dangerouslySetInnerHTML={{ __html: buildAnalyticsBeacon(ctx.analytics) }} /> : null}
        <header className="paper-head">
          <a className="paper-brand" href={`${baseUrl}/`}>
            {site.logo ? <img src={site.logo} alt={site.name} /> : null}
            <span className="paper-title">{site.name}</span>
          </a>
          {slogan ? <div className="paper-slogan">{slogan}</div> : null}
        </header>
        <nav className="news-nav">
          <div className="w1200">
            <a className={`nv${currentUrl === `${baseUrl}/` ? ' active' : ''}`} href={`${baseUrl}/`}>首页</a>
            {nav.map((item) => (
              <a key={item.id} className={`nv${currentUrl === item.url ? ' active' : ''}`} href={item.url} target={item.target}>{item.name}</a>
            ))}
            <form className="nav-search" action={ctx.searchUrl} method="get">
              <input type="search" name="q" placeholder="搜索新闻" />
              <button type="submit">搜索</button>
            </form>
          </div>
        </nav>
        <main className="w1200">{children}</main>
        <footer className="news-footer">
          <div className="w1200">
            <ThemeFooterLinks
              friendLinkGroups={ctx.friendLinkGroups}
              friendLinks={friendLinks}
              footerText={footerText}
              site={site}
              classNames={{ links: 'links', extra: 'extra' }}
              linkRel="noopener nofollow"
              fallbackCopyright={false}
            />
          </div>
        </footer>
      </body>
    </html>
  );
}

function externalProps(item: CmsContentItem) {
  return externalLinkProps(item.isExternal);
}

/** 标题流列表：lead 指定前 N 条渲染为加粗标题+摘要 */
function NewsList({ items, lead = 0, showTop = false }: { items: CmsContentItem[]; lead?: number; showTop?: boolean }) {
  if (items.length === 0) return <div className="empty">暂无内容</div>;
  return (
    <ul className="news-list">
      {items.map((item, idx) => (
        <li key={item.id} className={idx < lead ? 'lead' : undefined}>
          {idx < lead ? (
            <span>
              <a href={item.url} {...externalProps(item)}>
                {showTop && item.isTop ? <span className="top-badge">置顶</span> : null}
                {item.title}
              </a>
              {item.summary ? <span className="abs">{item.summary}</span> : null}
            </span>
          ) : (
            <a href={item.url} {...externalProps(item)}>
              {showTop && item.isTop ? <span className="top-badge">置顶</span> : null}
              {item.title}
            </a>
          )}
          {idx >= lead && item.publishedAt ? <time>{item.publishedAt.slice(5, 10)}</time> : null}
        </li>
      ))}
    </ul>
  );
}

function NewsBox({ title, moreUrl, children }: { title: string; moreUrl?: string | null; children: ReactNode }) {
  return (
    <section className="news-box">
      <div className="news-box-hd">
        <h2>{title}</h2>
        {moreUrl ? <a className="more" href={moreUrl}>更多 »</a> : null}
      </div>
      {children}
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
    const [primary, ...rest] = data.blocks;
    const primaryItems = primary?.list ?? ctx.latest;
    const headline = primaryItems[0] ?? null;
    const headlineSubs = primaryItems.slice(1, 4);
    const primaryRest = primaryItems.slice(4);
    const hotItems = ctx.hot.length > 0 ? ctx.hot : ctx.latest;
    return (
      <NewsLayout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
        {headline ? (
          <div className="headline">
            <h2><a href={headline.url} {...externalProps(headline)}>{headline.title}</a></h2>
            {headline.summary ? <p>{headline.summary}</p> : null}
            {headlineSubs.length > 0 ? (
              <div className="sub-links">
                {headlineSubs.map((item) => <a key={item.id} href={item.url} {...externalProps(item)}>{item.title}</a>)}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="news-grid">
          <div>
            {primary && primaryRest.length > 0 ? (
              <NewsBox title={primary.channel.name} moreUrl={primary.channel.url}>
                <NewsList items={primaryRest} lead={1} showTop />
              </NewsBox>
            ) : null}
            <div className="col-blocks">
              {rest.map((block) => (
                <NewsBox key={block.channel.code} title={block.channel.name} moreUrl={block.channel.url}>
                  <NewsList items={block.list.slice(0, 6)} />
                </NewsBox>
              ))}
            </div>
          </div>
          <aside>
            <div className="rank-box">
              <h2>热点排行</h2>
              <ul className="rank-list">
                {hotItems.slice(0, 10).map((item) => (
                  <li key={item.id}><a href={item.url} {...externalProps(item)}>{item.title}</a></li>
                ))}
              </ul>
            </div>
            {ctx.homeSidebar ? <div dangerouslySetInnerHTML={{ __html: renderCmsWidgetHtml(ctx.homeSidebar) }} /> : null}
            {ctx.recommended.length > 0 ? (
              <div className="rank-box">
                <h2>编辑推荐</h2>
                <ul className="rank-list">
                  {ctx.recommended.slice(0, 8).map((item) => (
                    <li key={item.id}><a href={item.url} {...externalProps(item)}>{item.title}</a></li>
                  ))}
                </ul>
              </div>
            ) : null}
          </aside>
        </div>
      </NewsLayout>
    );
  },
});

// ─── 列表：默认图文混排 ───────────────────────────────────────────────────────

function ListTemplate(ctx: CmsListContext) {
  return (
    <NewsLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      <div className="content-list">
        {ctx.items.length === 0 ? <div className="empty">暂无内容</div> : ctx.items.map((item) => (
          <div className="content-item" key={item.id}>
            {(item.coverThumb || item.coverImage) ? <img className="thumb" src={item.coverThumb ?? item.coverImage ?? ''} alt="" loading="lazy" /> : null}
            <div className="ci-body">
              <h3>
                <a href={item.url} {...externalProps(item)}>
                  {item.isTop ? <span className="top-badge">置顶</span> : null}
                  {item.title}
                </a>
              </h3>
              {item.summary ? <div className="abs">{item.summary}</div> : null}
              <div className="meta">
                {item.source ? <span>{item.source}</span> : null}
                {item.publishedAt ? <time>{item.publishedAt.slice(0, 16)}</time> : null}
                <span>{item.viewCount} 阅读</span>
              </div>
            </div>
          </div>
        ))}
      </div>
      <Pagination p={ctx.pagination} />
    </NewsLayout>
  );
}

// ─── 列表变体：list-headline 纯标题两栏（时政要闻/通知）───────────────────────

function ListHeadlineTemplate(ctx: CmsListContext) {
  return (
    <NewsLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      {ctx.items.length === 0 ? <div className="empty">暂无内容</div> : (
        <div className="headline-cols">
          <NewsList items={ctx.items} showTop />
        </div>
      )}
      <Pagination p={ctx.pagination} />
    </NewsLayout>
  );
}

// ─── 列表变体：list-photo 图片网格（图片新闻/视觉栏目）────────────────────────

function ListPhotoTemplate(ctx: CmsListContext) {
  return (
    <NewsLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      {ctx.items.length === 0 ? <div className="empty">暂无内容</div> : (
        <div className="photo-grid">
          {ctx.items.map((item) => (
            <a className="photo-card" key={item.id} href={item.url} {...externalProps(item)}>
              {(item.coverThumb || item.coverImage)
                ? <img className="ph" src={item.coverThumb ?? item.coverImage ?? ''} alt={item.title} loading="lazy" />
                : <span className="ph" />}
              {item.contentType === 'album' && item.imageCount > 0 ? <span className="count-badge">{item.imageCount} 图</span> : null}
              {item.contentType === 'media' ? <span className="count-badge">▶ 视频</span> : null}
              <span className="cap">
                <h3>{item.title}</h3>
                <PublishedDate value={item.publishedAt} />
              </span>
            </a>
          ))}
        </div>
      )}
      <Pagination p={ctx.pagination} />
    </NewsLayout>
  );
}

// ─── 详情：默认新闻版式（来源/记者/责编脚注）──────────────────────────────────

function ArticleBody({ ctx, wide = false, plain = false }: { ctx: CmsDetailContext; wide?: boolean; plain?: boolean }) {
  const { content } = ctx;
  const cls = ['article', wide ? 'wide' : '', plain ? 'plain' : ''].filter(Boolean).join(' ');
  return (
    <>
      <article className={cls}>
        <h1>{content.title}</h1>
        <div className="meta">
          {content.publishedAt ? <time>{content.publishedAt}</time> : null}
          {content.source ? <span>来源：{content.source}</span> : null}
          {!plain && content.author ? <span>记者：{content.author}</span> : null}
          <span>阅读：{content.viewCount}</span>
        </div>
        {content.modelFields.length > 0 ? <ModelFieldTable fields={content.modelFields} /> : null}
        <MediaBlock content={content} />
        <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
        <AttachmentList items={content.attachments} />
        <TagLinks tags={content.tags} className="tags" />
        {!plain && content.author ? <div className="footnote">责任编辑：{content.author}</div> : null}
      </article>
      <ArticleNav prev={content.prev} next={content.next} />
      <RelatedArticles items={ctx.related} title="延伸阅读" />
    </>
  );
}

function DetailTemplate(ctx: CmsDetailContext) {
  return (
    <NewsLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <ArticleBody ctx={ctx} />
    </NewsLayout>
  );
}

/** detail-plain 变体：公告/启事简洁版式（弱化记者/责编等新闻元信息） */
function DetailPlainTemplate(ctx: CmsDetailContext) {
  return (
    <NewsLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <ArticleBody ctx={ctx} plain />
    </NewsLayout>
  );
}

/** detail-wide 变体：宽幅版式（视频/图集等大屏内容） */
function DetailWideTemplate(ctx: CmsDetailContext) {
  return (
    <NewsLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <ArticleBody ctx={ctx} wide />
    </NewsLayout>
  );
}

// ─── 单页 / 搜索 / 标签 / 404 ─────────────────────────────────────────────────

function PageTemplate(ctx: CmsPageContext) {
  return (
    <NewsLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <SinglePageArticle ctx={ctx} />
    </NewsLayout>
  );
}

function SearchTemplate(ctx: CmsSearchContext) {
  return (
    <NewsLayout ctx={ctx}>
      <h1 className="page-title">搜索「{ctx.keyword}」</h1>
      <div className="content-list search-result">
        {ctx.results.length === 0 ? (
          <div className="empty">未找到相关内容</div>
        ) : ctx.results.map((r) => (
          <div className="content-item" key={r.id}>
            <div className="ci-body">
              <h3>
                <a
                  href={searchResultHref(r, ctx.baseUrl)}
                  {...externalLinkProps(r.isExternal)}
                  dangerouslySetInnerHTML={{ __html: r.titleHighlight }}
                />
              </h3>
              <div className="meta"><PublishedDate value={r.publishedAt} /></div>
            </div>
          </div>
        ))}
      </div>
      <Pagination p={ctx.pagination} />
    </NewsLayout>
  );
}

function TagTemplate(ctx: CmsTagPageContext) {
  return (
    <NewsLayout ctx={ctx}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">标签：{ctx.tag.name}（{ctx.tag.contentCount}）</h1>
      <NewsList items={ctx.items} />
      <Pagination p={ctx.pagination} />
    </NewsLayout>
  );
}

function NotFoundTemplate(ctx: CmsNotFoundContext) {
  return (
    <NewsLayout ctx={ctx}>
      <div className="empty">
        <h1 className="page-title" style={{ display: 'inline-block' }}>404 页面不存在</h1>
        <p>您访问的页面不存在或已被移除：{ctx.path}</p>
        <p><a href={`${ctx.baseUrl}/`} style={{ color: 'var(--primary)' }}>返回首页</a></p>
      </div>
    </NewsLayout>
  );
}

export const newsPortalTheme: CmsTheme = {
  code: 'news-portal',
  label: '新闻门户',
  templates: {
    index: HomeTemplate,
    list: ListTemplate,
    detail: DetailTemplate,
    page: PageTemplate,
    search: SearchTemplate,
    tag: TagTemplate,
    notFound: NotFoundTemplate,
  },
  extraListTemplates: {
    'list-headline': { label: '纯标题两栏（要闻/通知）', component: ListHeadlineTemplate },
    'list-photo': { label: '图片网格（图片/视频新闻）', component: ListPhotoTemplate },
  },
  extraDetailTemplates: {
    'detail-plain': { label: '简洁正文（公告/启事）', component: DetailPlainTemplate },
    'detail-wide': { label: '宽幅版式（视频/图集）', component: DetailWideTemplate },
  },
  settingsSchema: [
    { name: 'slogan', label: '报头口号', fieldType: 'text', group: '页头', placeholder: '如 权威发布 · 深度报道', description: '报头下方的口号文字，留空不显示' },
    { name: 'homeChannels', label: '首页栏目区块', fieldType: 'text', group: '首页', placeholder: '如 bsyw,mszh,cjjj', description: '逗号分隔栏目标识（最多 6 个）：第 1 个为头条+主栏区块，其余按两列区块排布；留空回落全站最新发布' },
    { name: 'footerText', label: '页脚附加文案', fieldType: 'textarea', group: '页脚', placeholder: '报社地址、新闻热线等，支持多行' },
  ],
  widgetSlots: [{
    key: 'home.sidebar',
    label: '首页侧栏',
    allowedTypes: ['manual-list'],
    rendererKeys: [...CMS_WIDGET_RENDERER_KEYS],
  }],
};
