import type { ReactNode } from 'react';
import type {
  CmsBaseContext, CmsContentItem, CmsHomeContext, CmsListContext,
  CmsDetailContext, CmsPageContext, CmsSearchContext, CmsNotFoundContext,
  CmsTagPageContext, CmsNavItem, CmsTheme, CmsCustomPageContext,
} from '../types';
import { CMS_WIDGET_RENDERER_KEYS } from '@zenith/shared/cms';
import { renderCmsWidgetHtml } from '../widgets';
import { Breadcrumbs, CAPTCHA_SCRIPT, FrontForm, Pagination, SeoHead, buildAnalyticsBeacon, searchResultHref, SinglePageArticle, TagLinks, externalLinkProps } from '../_shared';

/** 暗色变量组；注册进主题对象 darkVars 供样式装配 */
export const DOCS_THEME_DARK_VARS = '--text:#dfdfd6; --text-2:#98989f; --border:#3c3f44; --bg:#1b1b1f; --bg-2:#242429;';

function SidebarNav({ items, currentUrl }: { items: CmsNavItem[]; currentUrl?: string }) {
  return (
    <aside className="doc-sidebar">
      {items.map((item) => (
        <div className="group" key={item.id}>
          <a className={`top${currentUrl === item.url ? ' active' : ''}`} href={item.url} target={item.target}>{item.name}</a>
          {item.children && item.children.length > 0 ? (
            <div className="sub">
              {item.children.map((child) => (
                <a key={child.id} href={child.url} target={child.target} className={currentUrl === child.url ? 'active' : undefined}>{child.name}</a>
              ))}
            </div>
          ) : null}
        </div>
      ))}
    </aside>
  );
}

interface DocLayoutProps {
  ctx: CmsBaseContext;
  currentUrl?: string;
  /** 首页 hero 等不需要 sidebar 的页面可关闭 */
  sidebar?: boolean;
  children: ReactNode;
}

export function Layout({ ctx, currentUrl, sidebar = true, children }: DocLayoutProps) {
  const { site, nav, friendLinks, baseUrl } = ctx;
  return (
    <html lang="zh-CN">
      <SeoHead ctx={ctx} />
      <body>
        {ctx.analytics ? (
          <script dangerouslySetInnerHTML={{ __html: buildAnalyticsBeacon(ctx.analytics) }} />
        ) : null}
        <header className="doc-header">
          <a className="doc-brand" href={`${baseUrl}/`}>
            {site.logo ? <img src={site.logo} alt={site.name} /> : null}
            <span>{site.name}</span>
          </a>
          <span className="spacer" />
          <form className="doc-search" action={ctx.searchUrl} method="get">
            <input type="search" name="q" placeholder="搜索文档…" />
          </form>
          {ctx.assets.darkMode !== 'light' ? (
            <button type="button" className="theme-toggle" title="切换明暗主题" aria-label="切换明暗主题">◑</button>
          ) : null}
        </header>
        <div className="doc-shell">
          {sidebar ? <SidebarNav items={nav} currentUrl={currentUrl} /> : null}
          <main className="doc-main">
            <div className="doc-content">{children}</div>
          </main>
        </div>
        <footer className="doc-footer">
          <span>{site.copyright ?? `© ${new Date().getFullYear()} ${site.name}`}</span>
          {friendLinks.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.name}</a>
          ))}
          {site.icp ? <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{site.icp}</a> : null}
        </footer>
      </body>
    </html>
  );
}

function DocItemRow({ item }: { item: CmsContentItem }) {
  return (
    <div className="doc-item">
      <h3>
        {item.isTop ? <span className="badge">置顶</span> : null}
        {item.isHot ? <span className="badge hot">热门</span> : null}
        <a href={item.url}>{item.title}</a>
      </h3>
      {item.summary ? <div className="summary">{item.summary}</div> : null}
      <div className="meta">
        {item.author ? <span>{item.author}</span> : null}
        {item.publishedAt ? <time>{item.publishedAt}</time> : null}
        <span>{item.viewCount} 阅读</span>
      </div>
    </div>
  );
}

function IndexTemplate(ctx: CmsHomeContext) {
  return (
    <Layout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
      <div className="hero">
        <h1>{ctx.site.name}</h1>
        {ctx.site.description ? <p>{ctx.site.description}</p> : null}
      </div>
      <h2 className="section-heading">最新更新</h2>
      <div className="doc-list">
        {ctx.latest.length === 0 ? <div className="empty">暂无内容</div> : ctx.latest.map((item) => <DocItemRow key={item.id} item={item} />)}
      </div>
      {ctx.homeSidebar ? <div dangerouslySetInnerHTML={{ __html: renderCmsWidgetHtml(ctx.homeSidebar) }} /> : null}
      {ctx.recommended.length > 0 ? (
        <>
          <h2 className="section-heading">推荐阅读</h2>
          <div className="doc-list">
            {ctx.recommended.map((item) => <DocItemRow key={item.id} item={item} />)}
          </div>
        </>
      ) : null}
    </Layout>
  );
}

function ListTemplate(ctx: CmsListContext) {
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      {ctx.channel.description ? <p style={{ color: 'var(--text-2)', marginBottom: 16 }}>{ctx.channel.description}</p> : null}
      <div className="doc-list">
        {ctx.items.length === 0 ? <div className="empty">该栏目暂无内容</div> : ctx.items.map((item) => <DocItemRow key={item.id} item={item} />)}
      </div>
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

function DetailTemplate(ctx: CmsDetailContext) {
  const { content } = ctx;
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article">
        <h1>{content.title}</h1>
        <div className="meta">
          {content.author ? <span>作者：{content.author}</span> : null}
          {content.publishedAt ? <time>更新于 {content.publishedAt}</time> : null}
          <span>{content.viewCount} 阅读</span>
        </div>
        <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
        <TagLinks tags={content.tags} className="tags" wrapName />
      </article>
      {(content.prev || content.next) ? (
        <nav className="article-nav">
          {content.prev ? (
            <a href={content.prev.url}><span className="dir">← 上一篇</span>{content.prev.title}</a>
          ) : <span />}
          {content.next ? (
            <a href={content.next.url} style={{ textAlign: 'right' }}><span className="dir">下一篇 →</span>{content.next.title}</a>
          ) : <span />}
        </nav>
      ) : null}
      <section className="comments">
        <h2>评论（{ctx.comments.length}）</h2>
        {ctx.comments.map((cm, i) => (
          <div className="comment-item" key={`${cm.nickname}-${i}`}>
            <div className="meta"><b>{cm.nickname}</b>{cm.isMember ? <span className="member-badge">会员</span> : null}<time>{cm.createdAt}</time></div>
            <p>{cm.content}</p>
          </div>
        ))}
        <form className="front-form" method="post" action={ctx.commentForm.action}>
          <input type="hidden" name="contentId" value={ctx.commentForm.contentId} />
          <input type="hidden" name="returnUrl" value={ctx.commentForm.returnUrl} />
          <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          <label>昵称 <span className="req">*</span><input type="text" name="nickname" required maxLength={50} /></label>
          <label>评论内容 <span className="req">*</span><textarea name="content" required maxLength={1000} /></label>
          {ctx.commentForm.captchaEnabled ? (
            <div className="cms-captcha-box" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="hidden" name="captchaId" value="" />
              <label style={{ flex: 1 }}>验证码 <span className="req">*</span><input type="text" name="captchaAnswer" required autoComplete="off" placeholder="计算结果" /></label>
              <span className="cms-captcha-img" style={{ cursor: 'pointer', lineHeight: 0 }} />
            </div>
          ) : null}
          <button type="submit">提交评论（审核后显示）</button>
          {ctx.commentForm.captchaEnabled ? (
            <script dangerouslySetInnerHTML={{ __html: CAPTCHA_SCRIPT }} />
          ) : null}
        </form>
      </section>
    </Layout>
  );
}

function PageTemplate(ctx: CmsPageContext) {
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <SinglePageArticle ctx={ctx} />
      {ctx.form ? <FrontForm form={ctx.form} /> : null}
    </Layout>
  );
}

function SearchTemplate(ctx: CmsSearchContext) {
  return (
    <Layout ctx={ctx}>
      <h1 className="page-title">搜索「{ctx.keyword}」</h1>
      <div className="doc-list search-result">
        {ctx.results.length === 0 ? (
          <div className="empty">未找到相关内容</div>
        ) : ctx.results.map((r) => (
          <div className="doc-item" key={r.id}>
            <h3><a
              href={searchResultHref(r, ctx.baseUrl)}
              {...externalLinkProps(r.isExternal)}
              dangerouslySetInnerHTML={{ __html: r.titleHighlight }}
            /></h3>
            <div className="summary" dangerouslySetInnerHTML={{ __html: r.snippet }} />
            <div className="meta">
              {r.channelName ? <span>{r.channelName}</span> : null}
              {r.publishedAt ? <time>{r.publishedAt}</time> : null}
            </div>
          </div>
        ))}
      </div>
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

function TagTemplate(ctx: CmsTagPageContext) {
  return (
    <Layout ctx={ctx}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">标签：{ctx.tag.name}（{ctx.tag.contentCount}）</h1>
      <div className="doc-list">
        {ctx.items.length === 0 ? <div className="empty">该标签下暂无内容</div> : ctx.items.map((item) => <DocItemRow key={item.id} item={item} />)}
      </div>
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

function NotFoundTemplate(ctx: CmsNotFoundContext) {
  return (
    <Layout ctx={ctx} sidebar={false}>
      <div className="hero">
        <h1>404</h1>
        <p>您访问的页面不存在或已下线。</p>
        <p><a href={`${ctx.baseUrl}/`} style={{ color: 'var(--primary)' }}>返回首页</a></p>
      </div>
    </Layout>
  );
}

function CustomPageTemplate(ctx: CmsCustomPageContext) {
  return (
    <Layout ctx={ctx} sidebar={false}>
      <div dangerouslySetInnerHTML={{ __html: ctx.blocksHtml }} />
    </Layout>
  );
}

/** 文档站主题：左侧栏目树 + 窄正文 + 上下篇导航，适合产品文档/知识库/帮助中心 */
export const docsTheme: CmsTheme = {
  code: 'docs',
  label: '文档站主题',
  darkVars: DOCS_THEME_DARK_VARS,
  templates: {
    index: IndexTemplate,
    list: ListTemplate,
    detail: DetailTemplate,
    page: PageTemplate,
    search: SearchTemplate,
    tag: TagTemplate,
    notFound: NotFoundTemplate,
  },
  customPage: CustomPageTemplate,
  widgetSlots: [{
    key: 'home.sidebar',
    label: '首页侧栏',
    allowedTypes: ['manual-list'],
    rendererKeys: [...CMS_WIDGET_RENDERER_KEYS],
  }],
};
