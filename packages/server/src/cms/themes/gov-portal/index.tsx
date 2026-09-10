/**
 * gov-portal 政府门户主题：以 Theme API（defineHomeTemplate + CmsThemeDataApi）实现的
 * 标准政府门户形态——大页头 + 主导航横条 + 双栏首页（要闻区块 / 公告侧栏）+
 * 图标办事入口 + 紧凑公文列表 + 政策文件详情（文件信息表头）。
 *
 * 同时作为 Theme API 的验收用例与主题开发的实例源码。
 */
import type { ReactNode } from 'react';
import type {
  CmsBaseContext, CmsContentItem, CmsListContext, CmsDetailContext,
  CmsPageContext, CmsSearchContext, CmsTagPageContext, CmsNotFoundContext,
  CmsTheme, CmsNavItem as CmsNavItemType,
} from '../types';
import { SeoHead, Breadcrumbs, Pagination, ModelFieldTable, MediaBlock, ArticleNav, RelatedArticles, AttachmentList, ThemeFooterLinks, PublishedDate, SinglePageArticle, externalLinkProps, loadHomeBlocks, SearchResultList } from '../_shared';
import { defineHomeTemplate } from '../sdk';
import { renderCmsWidgetHtml } from '../widgets';
import { CMS_WIDGET_RENDERER_KEYS } from '@zenith/shared/cms';

// ─── 布局 ─────────────────────────────────────────────────────────────────────

/** 主导航项：有子栏目时 hover 展开下拉（纯 CSS，静态页零 JS）；三级在面板内缩进列出 */
function NavItem({ item, currentUrl }: { item: CmsNavItemType; currentUrl?: string }) {
  const hasChildren = !!item.children?.length;
  return (
    <div className="nav-item">
      <a href={item.url} target={item.target} className={currentUrl === item.url ? 'active' : undefined}>
        {item.name}
        {hasChildren ? <span className="caret">▾</span> : null}
      </a>
      {hasChildren ? (
        <div className="nav-sub">
          {item.children!.map((child) => (
            <div className="nav-sub-group" key={child.id}>
              <a href={child.url} target={child.target}>{child.name}</a>
              {child.children?.length ? (
                <div className="nav-l3">
                  {child.children.map((grand) => (
                    <a key={grand.id} href={grand.url} target={grand.target}>{grand.name}</a>
                  ))}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function GovLayout({ ctx, currentUrl, children }: { ctx: CmsBaseContext; currentUrl?: string; children: ReactNode }) {
  const { site, nav, friendLinkGroups, baseUrl } = ctx;
  const footerText = typeof site.themeConfig.footerText === 'string' ? site.themeConfig.footerText : null;
  const subTitle = typeof site.themeConfig.mastheadSubtitle === 'string' ? site.themeConfig.mastheadSubtitle : '';
  return (
    <html lang="zh-CN">
      <SeoHead ctx={ctx} langAlternates />
      <body>
        <header className="masthead">
          <div className="w1200">
            <a className="masthead-brand" href={`${baseUrl}/`}>
              {site.logo ? <img src={site.logo} alt={site.name} /> : null}
              <span>
                <span className="masthead-title">{site.name}</span>
                {subTitle ? <div className="masthead-sub">{subTitle}</div> : null}
              </span>
            </a>
            <form className="masthead-search" action={ctx.searchUrl} method="get">
              <input type="search" name="q" placeholder="请输入关键词" />
              <button type="submit">搜索</button>
            </form>
          </div>
        </header>
        <nav className="main-nav">
          <div className="w1200">
            <div className="nav-item">
              <a href={`${baseUrl}/`} className={currentUrl === `${baseUrl}/` ? 'active' : undefined}>首页</a>
            </div>
            {nav.map((item) => <NavItem key={item.id} item={item} currentUrl={currentUrl} />)}
          </div>
        </nav>
        <main>
          <div className="w1200">{children}</div>
        </main>
        <footer className="gov-footer">
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

function GovList({ items, showTop = false }: { items: CmsContentItem[]; showTop?: boolean }) {
  if (items.length === 0) return <div className="empty">暂无内容</div>;
  return (
    <ul className="gov-list">
      {items.map((item) => (
        <li key={item.id}>
          <a href={item.url} {...externalLinkProps(item.isExternal)}>
            {showTop && item.isTop ? <span className="top-badge">置顶</span> : null}
            {item.title}
          </a>
          <PublishedDate value={item.publishedAt} />
        </li>
      ))}
    </ul>
  );
}

function GovBox({ title, moreUrl, children }: { title: string; moreUrl?: string | null; children: ReactNode }) {
  return (
    <section className="gov-box">
      <div className="gov-box-hd">
        <h2>{title}</h2>
        {moreUrl ? <a className="more" href={moreUrl}>更多 +</a> : null}
      </div>
      <div className="gov-box-bd">{children}</div>
    </section>
  );
}

/** 主题参数「办事入口」解析：每行 名称|URL */
function parseServiceLinks(raw: unknown): { name: string; url: string }[] {
  if (typeof raw !== 'string') return [];
  return raw.split('\n')
    .map((line) => {
      const [name, url] = line.split('|', 2).map((part) => part?.trim() ?? '');
      return { name, url };
    })
    .filter((entry) => entry.name && entry.url)
    .slice(0, 8);
}

// ─── 首页（Theme API：load 声明式取数）────────────────────────────────────────

const HomeTemplate = defineHomeTemplate({
  load: async ({ cms, site }) => ({ blocks: await loadHomeBlocks(cms, site, { limit: 9 }) }),
  Component: ({ data, ...ctx }) => {
    const [primary, ...rest] = data.blocks;
    const services = parseServiceLinks(ctx.site.themeConfig.serviceLinks);
    return (
      <GovLayout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
        {services.length > 0 ? (
          <div className="svc-grid">
            {services.map((svc) => (
              <a key={svc.url} href={svc.url} target="_blank" rel="noopener noreferrer">
                <span className="svc-ico">{svc.name.slice(0, 1)}</span>
                <span>{svc.name}</span>
              </a>
            ))}
          </div>
        ) : null}
        <div className="gov-grid">
          <div>
            {primary ? (
              <GovBox title={primary.channel.name} moreUrl={primary.channel.url}>
                <GovList items={primary.list} showTop />
              </GovBox>
            ) : (
              <GovBox title="最新发布">
                <GovList items={ctx.latest} showTop />
              </GovBox>
            )}
          </div>
          <aside>
            {ctx.homeSidebar ? <div dangerouslySetInnerHTML={{ __html: renderCmsWidgetHtml(ctx.homeSidebar) }} /> : null}
            {rest.map((block) => (
              <GovBox key={block.channel.code} title={block.channel.name} moreUrl={block.channel.url}>
                <GovList items={block.list.slice(0, 6)} />
              </GovBox>
            ))}
            {rest.length === 0 && ctx.hot.length > 0 ? (
              <GovBox title="热点关注">
                <GovList items={ctx.hot} />
              </GovBox>
            ) : null}
          </aside>
        </div>
      </GovLayout>
    );
  },
});

// ─── 列表页 ───────────────────────────────────────────────────────────────────

function ListTemplate(ctx: CmsListContext) {
  return (
    <GovLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <GovBox title={ctx.channel.name}>
        <GovList items={ctx.items} showTop />
      </GovBox>
      <Pagination p={ctx.pagination} />
    </GovLayout>
  );
}

// ─── 详情页 ───────────────────────────────────────────────────────────────────

/** 详情页工具条脚本（静态化后运行）：字号切换 + 打印，政务网站阅读标配 */
function DetailTemplate(ctx: CmsDetailContext) {
  const { content } = ctx;
  return (
    <GovLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <div className="article-tools" data-island="article-tools">
        <span>字号：</span>
        <button type="button" data-fs="fs-small">小</button>
        <button type="button" data-fs="" className="on">中</button>
        <button type="button" data-fs="fs-large">大</button>
        <button type="button" data-print="1">打印</button>
      </div>
      <article className="article">
        <h1>{content.title}</h1>
        <div className="meta">
          {content.source ? <span>来源：{content.source}</span> : null}
          {content.author ? <span>作者：{content.author}</span> : null}
          {content.publishedAt ? <time>发布时间：{content.publishedAt}</time> : null}
          <span>浏览：{content.viewCount}</span>
        </div>
        {content.modelFields.length > 0 ? <ModelFieldTable fields={content.modelFields} /> : null}
        <MediaBlock content={content} />
        <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
        <AttachmentList items={content.attachments} />
      </article>
      <ArticleNav prev={content.prev} next={content.next} />
      <RelatedArticles items={ctx.related} />
    </GovLayout>
  );
}

// ─── 单页 / 搜索 / 标签 / 404 ─────────────────────────────────────────────────

function PageTemplate(ctx: CmsPageContext) {
  return (
    <GovLayout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <SinglePageArticle ctx={ctx} />
    </GovLayout>
  );
}

function SearchTemplate(ctx: CmsSearchContext) {
  return (
    <GovLayout ctx={ctx}>
      <h1 className="page-title">搜索「{ctx.keyword}」</h1>
      <SearchResultList ctx={ctx} />
      <Pagination p={ctx.pagination} />
    </GovLayout>
  );
}

function TagTemplate(ctx: CmsTagPageContext) {
  return (
    <GovLayout ctx={ctx}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <GovBox title={`标签：${ctx.tag.name}（${ctx.tag.contentCount}）`}>
        <GovList items={ctx.items} />
      </GovBox>
      <Pagination p={ctx.pagination} />
    </GovLayout>
  );
}

function NotFoundTemplate(ctx: CmsNotFoundContext) {
  return (
    <GovLayout ctx={ctx}>
      <div className="empty">
        <h1 className="page-title">404 页面不存在</h1>
        <p>您访问的页面不存在或已被移除：{ctx.path}</p>
        <p><a href={`${ctx.baseUrl}/`} style={{ color: 'var(--primary)' }}>返回首页</a></p>
      </div>
    </GovLayout>
  );
}

// ─── 主题注册 ─────────────────────────────────────────────────────────────────

export const govPortalTheme: CmsTheme = {
  code: 'gov-portal',
  label: '政府门户',
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
    'list-compact': { label: '紧凑公文列表', component: ListTemplate },
  },
  extraDetailTemplates: {
    'detail-policy': { label: '政策文件（文件信息表头）', component: DetailTemplate },
  },
  settingsSchema: [
    { name: 'mastheadSubtitle', label: '页头副标题', fieldType: 'text', group: '页头', placeholder: '如拼音或英文站名', description: '站名下方的小字，留空不显示' },
    { name: 'homeChannels', label: '首页栏目区块', fieldType: 'text', group: '首页', placeholder: '如 yaowen,tzgg,zcwj', description: '逗号分隔栏目标识（最多 6 个）：第 1 个为主栏要闻区块，其余进右侧栏；留空回落全站最新发布' },
    { name: 'serviceLinks', label: '办事入口', fieldType: 'textarea', group: '首页', placeholder: '每行一个：名称|链接\n如 政务服务大厅|https://zwfw.example.gov.cn', description: '首页顶部图标导航（最多 8 个），留空不显示' },
    { name: 'footerText', label: '页脚附加文案', fieldType: 'textarea', group: '页脚', placeholder: '主办单位、承办单位、联系电话等，支持多行' },
  ],
  widgetSlots: [{
    key: 'home.sidebar',
    label: '首页侧栏',
    allowedTypes: ['manual-list'],
    rendererKeys: [...CMS_WIDGET_RENDERER_KEYS],
  }],
};
