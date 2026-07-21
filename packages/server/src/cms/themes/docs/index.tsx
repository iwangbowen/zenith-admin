import type { ReactNode } from 'react';
import type {
  CmsBaseContext, CmsBreadcrumb, CmsContentItem, CmsHomeContext, CmsListContext,
  CmsDetailContext, CmsPageContext, CmsSearchContext, CmsNotFoundContext, CmsPagination,
  CmsTagPageContext, CmsNavItem, CmsTheme, CmsCustomPageContext,
} from '../types';
import { CmsFragmentContent } from '../blocks';

const styles = `
:root { --primary: #3451b2; --text: #213547; --text-2: #67676c; --border: #e2e2e3; --bg: #ffffff; --bg-2: #f6f6f7; --sidebar-w: 250px; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; color: var(--text); background: var(--bg); line-height: 1.7; }
a { color: inherit; text-decoration: none; }
a:hover { color: var(--primary); }
img { max-width: 100%; }
.doc-header { position: sticky; top: 0; z-index: 20; height: 56px; border-bottom: 1px solid var(--border); background: var(--bg); display: flex; align-items: center; padding: 0 24px; gap: 16px; }
.doc-brand { display: flex; align-items: center; gap: 10px; font-size: 16px; font-weight: 700; white-space: nowrap; }
.doc-brand img { height: 26px; }
.doc-header .spacer { flex: 1; }
.doc-search input { border: 1px solid var(--border); background: var(--bg-2); border-radius: 8px; padding: 6px 14px; font-size: 13px; width: 200px; color: var(--text); }
.theme-toggle { background: none; border: 1px solid var(--border); border-radius: 6px; width: 30px; height: 30px; cursor: pointer; font-size: 14px; color: var(--text-2); flex-shrink: 0; }
.theme-toggle:hover { color: var(--primary); border-color: var(--primary); }
.doc-shell { display: flex; min-height: calc(100vh - 56px); }
.doc-sidebar { width: var(--sidebar-w); flex-shrink: 0; border-right: 1px solid var(--border); background: var(--bg-2); padding: 20px 12px 40px; position: sticky; top: 56px; height: calc(100vh - 56px); overflow-y: auto; }
.doc-sidebar .group { margin-bottom: 4px; }
.doc-sidebar a { display: block; padding: 5px 12px; border-radius: 6px; font-size: 14px; color: var(--text-2); }
.doc-sidebar a:hover { color: var(--text); background: var(--bg); }
.doc-sidebar a.active { color: var(--primary); background: var(--bg); font-weight: 600; }
.doc-sidebar .group > a.top { font-weight: 600; color: var(--text); }
.doc-sidebar .sub { padding-left: 12px; border-left: 1px solid var(--border); margin-left: 12px; }
.doc-main { flex: 1; min-width: 0; padding: 32px 48px 64px; }
.doc-content { max-width: 780px; margin: 0 auto; }
.breadcrumbs { font-size: 13px; color: var(--text-2); margin-bottom: 20px; }
.breadcrumbs a { color: var(--text-2); }
.breadcrumbs a:hover { color: var(--primary); }
.page-title { font-size: 26px; font-weight: 700; margin-bottom: 20px; letter-spacing: -0.02em; }
.doc-list { display: flex; flex-direction: column; }
.doc-item { padding: 14px 0; border-bottom: 1px solid var(--border); }
.doc-item h3 { font-size: 16px; font-weight: 600; }
.doc-item .summary { font-size: 14px; color: var(--text-2); margin-top: 4px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.doc-item .meta { font-size: 12px; color: var(--text-2); margin-top: 6px; display: flex; gap: 12px; }
.badge { display: inline-block; font-size: 11px; padding: 0 6px; border-radius: 4px; background: var(--primary); color: #fff; margin-right: 6px; vertical-align: 1px; }
.badge.hot { background: #d1242f; }
.pagination { display: flex; gap: 6px; justify-content: center; margin-top: 28px; flex-wrap: wrap; }
.pagination a, .pagination span { padding: 5px 11px; border: 1px solid var(--border); border-radius: 6px; font-size: 13px; }
.pagination .current { background: var(--primary); border-color: var(--primary); color: #fff; }
.article h1 { font-size: 28px; font-weight: 700; line-height: 1.4; margin-bottom: 10px; letter-spacing: -0.02em; }
.article .meta { font-size: 13px; color: var(--text-2); padding-bottom: 18px; border-bottom: 1px solid var(--border); margin-bottom: 24px; display: flex; gap: 16px; flex-wrap: wrap; }
.article .body { font-size: 15px; }
.article .body p { margin: 14px 0; }
.article .body h2 { font-size: 20px; margin: 28px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--border); }
.article .body h3 { font-size: 17px; margin: 22px 0 8px; }
.article .body pre, .article .body code { background: var(--bg-2); border-radius: 6px; font-size: 13.5px; }
.article .body pre { padding: 14px 16px; overflow-x: auto; }
.article .body code { padding: 1px 6px; }
.article .body blockquote { border-left: 3px solid var(--primary); padding: 4px 16px; color: var(--text-2); background: var(--bg-2); border-radius: 0 6px 6px 0; margin: 14px 0; }
.article .body img { border-radius: 8px; border: 1px solid var(--border); }
.article .tags { margin-top: 28px; display: flex; gap: 8px; flex-wrap: wrap; }
.article .tags span { font-size: 12px; background: var(--bg-2); border: 1px solid var(--border); border-radius: 100px; padding: 2px 12px; color: var(--text-2); }
.article-nav { margin-top: 32px; padding-top: 18px; border-top: 1px solid var(--border); display: grid; grid-template-columns: 1fr 1fr; gap: 12px; font-size: 14px; }
.article-nav a { display: block; border: 1px solid var(--border); border-radius: 8px; padding: 10px 14px; }
.article-nav a:hover { border-color: var(--primary); }
.article-nav .dir { font-size: 12px; color: var(--text-2); display: block; }
.hero { text-align: center; padding: 56px 0 40px; }
.hero h1 { font-size: 36px; font-weight: 800; letter-spacing: -0.03em; }
.hero p { color: var(--text-2); font-size: 16px; margin-top: 10px; max-width: 560px; margin-left: auto; margin-right: auto; }
.section-heading { font-size: 18px; font-weight: 700; margin: 32px 0 8px; }
.search-result mark { background: #fff8c5; color: #953800; padding: 0 1px; }
.comments { margin-top: 40px; }
.comments h2 { font-size: 18px; margin-bottom: 12px; }
.comment-item { padding: 12px 0; border-bottom: 1px dashed var(--border); }
.comment-item .meta { font-size: 12px; color: var(--text-2); margin-bottom: 4px; display: flex; gap: 10px; }
.comment-item .meta b { color: var(--text); font-weight: 600; }
.comment-item p { font-size: 14px; }
.front-form { margin-top: 24px; display: flex; flex-direction: column; gap: 12px; }
.front-form label { font-size: 14px; display: flex; flex-direction: column; gap: 4px; }
.front-form label .req { color: #d1242f; }
.front-form input[type="text"], .front-form textarea, .front-form select { border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 14px; font-family: inherit; width: 100%; background: var(--bg); color: var(--text); }
.front-form textarea { min-height: 90px; resize: vertical; }
.front-form button { align-self: flex-start; background: var(--primary); color: #fff; border: none; border-radius: 6px; padding: 8px 22px; font-size: 14px; cursor: pointer; }
.front-form .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.doc-footer { border-top: 1px solid var(--border); padding: 20px 24px; font-size: 13px; color: var(--text-2); display: flex; gap: 16px; flex-wrap: wrap; }
.empty { text-align: center; color: var(--text-2); padding: 48px 0; }
@media (max-width: 900px) {
  .doc-sidebar { display: none; }
  .doc-main { padding: 24px 20px 48px; }
  .doc-search { display: none; }
}
`;

const DARK_VARS = '--text:#dfdfd6; --text-2:#98989f; --border:#3c3f44; --bg:#1b1b1f; --bg-2:#242429;';

function buildThemeOverrides(settings: Record<string, unknown>): { css: string; darkMode: 'auto' | 'light' | 'dark' } {
  const primary = typeof settings.themePrimary === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(settings.themePrimary)
    ? settings.themePrimary
    : null;
  const darkMode = settings.themeDark === 'dark' || settings.themeDark === 'auto' ? settings.themeDark : 'light';
  let css = '';
  if (primary) css += `:root { --primary: ${primary}; }\n`;
  if (darkMode !== 'light') {
    css += `html[data-theme="dark"] { ${DARK_VARS} }\n`;
    if (darkMode === 'auto') {
      css += `@media (prefers-color-scheme: dark) { html:not([data-theme="light"]) { ${DARK_VARS} } }\n`;
    }
  }
  return { css, darkMode };
}

const THEME_TOGGLE_SCRIPT = `(function(){try{
var t=localStorage.getItem('cms_theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}
document.addEventListener('click',function(e){
var b=e.target&&e.target.closest?e.target.closest('.theme-toggle'):null;if(!b)return;
var h=document.documentElement;var cur=h.getAttribute('data-theme');
var next=cur==='dark'?'light':(cur==='light'?'dark':(window.matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark'));
h.setAttribute('data-theme',next);localStorage.setItem('cms_theme',next);});
}catch(e){}})();`;

function buildAnalyticsBeacon(analytics: NonNullable<CmsBaseContext['analytics']>): string {
  return `(function(){try{
var K=${JSON.stringify(analytics.siteKey)};var C=${analytics.contentId ?? 'null'};
var ls=window.localStorage,ss=window.sessionStorage;
var aid=ls.getItem('cms_aid')||(Date.now().toString(36)+Math.random().toString(36).slice(2,10));ls.setItem('cms_aid',aid);
var sid=ss.getItem('cms_sid')||(Date.now().toString(36)+Math.random().toString(36).slice(2,10));ss.setItem('cms_sid',sid);
var ev={eventType:'page_view',sessionId:sid,anonymousId:aid,pagePath:location.pathname,pageTitle:document.title,referrer:document.referrer||undefined};
navigator.sendBeacon('/api/analytics/events?siteKey='+encodeURIComponent(K),new Blob([JSON.stringify({events:[ev]})],{type:'application/json'}));
if(C){navigator.sendBeacon('/api/public/cms/view',new Blob([JSON.stringify({contentId:C})],{type:'application/json'}));}
}catch(e){}})();`;
}

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

function Layout({ ctx, currentUrl, sidebar = true, children }: DocLayoutProps) {
  const { site, seo, nav, friendLinks, baseUrl } = ctx;
  const theme = buildThemeOverrides(site.settings);
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{seo.title}</title>
        {seo.keywords ? <meta name="keywords" content={seo.keywords} /> : null}
        {seo.description ? <meta name="description" content={seo.description} /> : null}
        {seo.canonical ? <link rel="canonical" href={seo.canonical} /> : null}
        <meta property="og:type" content="website" />
        <meta property="og:title" content={seo.ogTitle} />
        {seo.ogDescription ? <meta property="og:description" content={seo.ogDescription} /> : null}
        {seo.ogImage ? <meta property="og:image" content={seo.ogImage} /> : null}
        {site.favicon ? <link rel="icon" href={site.favicon} /> : null}
        <meta name="generator" content="Zenith CMS" />
        {seo.jsonLd ? (
          <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(seo.jsonLd) }} />
        ) : null}
        <style dangerouslySetInnerHTML={{ __html: styles + theme.css }} />
        {theme.darkMode !== 'light' ? (
          <script dangerouslySetInnerHTML={{ __html: THEME_TOGGLE_SCRIPT }} />
        ) : null}
      </head>
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
          {theme.darkMode !== 'light' ? (
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

function Breadcrumbs({ items }: { items: CmsBreadcrumb[] }) {
  return (
    <div className="breadcrumbs">
      {items.map((b, i) => (
        <span key={b.url}>
          {i > 0 ? ' / ' : ''}
          {i === items.length - 1 ? <span>{b.name}</span> : <a href={b.url}>{b.name}</a>}
        </span>
      ))}
    </div>
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

function Pagination({ p }: { p: CmsPagination }) {
  if (p.totalPages <= 1) return null;
  return (
    <div className="pagination">
      {p.prevUrl ? <a href={p.prevUrl}>上一页</a> : null}
      {p.pages.map((pg) => (
        pg.current
          ? <span key={pg.page} className="current">{pg.page}</span>
          : <a key={pg.page} href={pg.url}>{pg.page}</a>
      ))}
      {p.nextUrl ? <a href={p.nextUrl}>下一页</a> : null}
    </div>
  );
}

function IndexTemplate(ctx: CmsHomeContext) {
  const banner = ctx.fragments['home-banner'];
  return (
    <Layout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
      <div className="hero">
        <h1>{ctx.site.name}</h1>
        {ctx.site.description ? <p>{ctx.site.description}</p> : null}
      </div>
      <CmsFragmentContent fragment={banner} imageAlt="home-banner" />
      <h2 className="section-heading">最新更新</h2>
      <div className="doc-list">
        {ctx.latest.length === 0 ? <div className="empty">暂无内容</div> : ctx.latest.map((item) => <DocItemRow key={item.id} item={item} />)}
      </div>
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
        {content.tags.length > 0 ? (
          <div className="tags">
            {content.tags.map((t) => <a key={t.slug} href={t.url}><span>{t.name}</span></a>)}
          </div>
        ) : null}
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
            <script dangerouslySetInnerHTML={{ __html: `(function(){function load(box){fetch('/api/public/cms/captcha').then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0)return;box.querySelector('input[name="captchaId"]').value=r.data.id;var img=box.querySelector('.cms-captcha-img');img.innerHTML=r.data.svg;img.title='看不清？点击刷新'}).catch(function(){})}document.querySelectorAll('.cms-captcha-box').forEach(function(box){load(box);var img=box.querySelector('.cms-captcha-img');if(img)img.addEventListener('click',function(){load(box)})});})();` }} />
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
      <article className="article">
        <h1>{ctx.channel.name}</h1>
        <div className="body" dangerouslySetInnerHTML={{ __html: ctx.contentHtml }} />
      </article>
      {ctx.form ? (
        <form className="front-form" method="post" action={ctx.form.action}>
          <h2>{ctx.form.name}</h2>
          <input type="hidden" name="returnUrl" value={ctx.form.returnUrl} />
          <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
          {ctx.form.fields.map((f) => (
            <label key={f.name}>
              {f.label} {f.required ? <span className="req">*</span> : null}
              {f.fieldType === 'textarea' ? (
                <textarea name={f.name} required={f.required} maxLength={2000} />
              ) : f.fieldType === 'select' ? (
                <select name={f.name} required={f.required} defaultValue="">
                  <option value="" disabled>请选择</option>
                  {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              ) : (
                <input type="text" name={f.name} required={f.required} maxLength={200} />
              )}
            </label>
          ))}
          <button type="submit">提交</button>
        </form>
      ) : null}
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
            <h3><a href={`${ctx.baseUrl}${r.url}`} dangerouslySetInnerHTML={{ __html: r.titleHighlight }} /></h3>
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
};
