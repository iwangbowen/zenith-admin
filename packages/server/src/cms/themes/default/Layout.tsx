import type { ReactNode } from 'react';
import type { CmsBaseContext, CmsNavItem } from '../types';

const styles = `
:root { --primary: #1f6feb; --text: #1f2328; --text-2: #59636e; --border: #d1d9e0; --bg: #ffffff; --bg-2: #f6f8fa; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', sans-serif; color: var(--text); background: var(--bg); line-height: 1.6; }
a { color: inherit; text-decoration: none; }
a:hover { color: var(--primary); }
img { max-width: 100%; }
.container { max-width: 1080px; margin: 0 auto; padding: 0 16px; }
.site-header { border-bottom: 1px solid var(--border); background: var(--bg); position: sticky; top: 0; z-index: 10; }
.site-header .container { display: flex; align-items: center; gap: 24px; height: 60px; }
.site-brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 600; white-space: nowrap; }
.site-brand img { height: 32px; }
.site-nav { display: flex; gap: 4px; flex: 1; overflow-x: auto; }
.site-nav a { padding: 6px 14px; border-radius: 6px; font-size: 15px; white-space: nowrap; }
.site-nav a.active, .site-nav a:hover { background: var(--bg-2); color: var(--primary); }
.site-search { flex-shrink: 0; }
.site-search input { border: 1px solid var(--border); border-radius: 6px; padding: 6px 12px; font-size: 14px; width: 160px; }
main { min-height: 60vh; padding: 24px 0 48px; }
.breadcrumbs { font-size: 13px; color: var(--text-2); margin-bottom: 16px; }
.breadcrumbs a { color: var(--text-2); }
.breadcrumbs a:hover { color: var(--primary); }
.page-title { font-size: 22px; font-weight: 600; margin-bottom: 16px; }
.content-list { display: flex; flex-direction: column; }
.content-item { display: flex; gap: 16px; padding: 16px 0; border-bottom: 1px solid var(--border); }
.content-item .thumb { width: 180px; height: 110px; object-fit: cover; border-radius: 8px; flex-shrink: 0; }
.content-item h3 { font-size: 17px; font-weight: 600; margin-bottom: 6px; }
.content-item .summary { font-size: 14px; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.content-item .meta { font-size: 12px; color: var(--text-2); margin-top: 8px; display: flex; gap: 12px; }
.badge { display: inline-block; font-size: 11px; padding: 1px 6px; border-radius: 4px; background: var(--primary); color: #fff; margin-right: 6px; vertical-align: 2px; }
.badge.hot { background: #d1242f; }
.pagination { display: flex; gap: 6px; justify-content: center; margin-top: 24px; flex-wrap: wrap; }
.pagination a, .pagination span { padding: 6px 12px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; }
.pagination .current { background: var(--primary); border-color: var(--primary); color: #fff; }
.article { max-width: 800px; margin: 0 auto; }
.article h1 { font-size: 26px; line-height: 1.4; margin-bottom: 12px; }
.article .meta { font-size: 13px; color: var(--text-2); padding-bottom: 16px; border-bottom: 1px solid var(--border); margin-bottom: 20px; display: flex; gap: 16px; flex-wrap: wrap; }
.article .body { font-size: 16px; }
.article .body p { margin: 12px 0; }
.article .body img { border-radius: 8px; }
.article .tags { margin-top: 24px; display: flex; gap: 8px; flex-wrap: wrap; }
.article .tags span { font-size: 12px; background: var(--bg-2); border-radius: 4px; padding: 3px 10px; color: var(--text-2); }
.article-nav { max-width: 800px; margin: 24px auto 0; padding-top: 16px; border-top: 1px solid var(--border); font-size: 14px; color: var(--text-2); display: flex; flex-direction: column; gap: 6px; }
.section-title { font-size: 18px; font-weight: 600; margin: 28px 0 8px; padding-left: 10px; border-left: 4px solid var(--primary); }
.home-grid { display: grid; grid-template-columns: 2fr 1fr; gap: 32px; }
.side-list li { list-style: none; padding: 8px 0; border-bottom: 1px dashed var(--border); font-size: 14px; display: flex; justify-content: space-between; gap: 8px; }
.side-list li a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.side-list li time { color: var(--text-2); font-size: 12px; flex-shrink: 0; }
.fragment-banner { border-radius: 10px; overflow: hidden; margin-bottom: 24px; }
.search-result mark { background: #fff8c5; color: #953800; padding: 0 1px; }
.search-result .content-item h3 mark { background: none; color: #d1242f; }
.ad-slot { margin-bottom: 24px; display: flex; flex-direction: column; gap: 12px; }
.ad-slot a { display: block; border: 1px solid var(--border); border-radius: 10px; overflow: hidden; }
.ad-slot .ad-text { padding: 14px 18px; background: var(--bg-2); font-size: 14px; }
.cms-link-word { color: var(--primary); text-decoration: underline; text-underline-offset: 2px; }
.comments { max-width: 800px; margin: 32px auto 0; }
.comments h2 { font-size: 18px; margin-bottom: 12px; }
.comment-item { padding: 12px 0; border-bottom: 1px dashed var(--border); }
.comment-item .meta { font-size: 12px; color: var(--text-2); margin-bottom: 4px; display: flex; gap: 10px; }
.comment-item .meta b { color: var(--text); font-weight: 600; }
.comment-item p { font-size: 14px; }
.front-form { max-width: 800px; margin: 24px auto 0; display: flex; flex-direction: column; gap: 12px; }
.front-form label { font-size: 14px; display: flex; flex-direction: column; gap: 4px; }
.front-form label .req { color: #d1242f; }
.front-form input[type="text"], .front-form textarea, .front-form select { border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; font-size: 14px; font-family: inherit; width: 100%; }
.front-form textarea { min-height: 90px; resize: vertical; }
.front-form button { align-self: flex-start; background: var(--primary); color: #fff; border: none; border-radius: 6px; padding: 8px 22px; font-size: 14px; cursor: pointer; }
.front-form button:hover { opacity: .9; }
.front-form .hp { position: absolute; left: -9999px; width: 1px; height: 1px; overflow: hidden; }
.site-footer { border-top: 1px solid var(--border); background: var(--bg-2); padding: 24px 0; font-size: 13px; color: var(--text-2); }
.site-footer .links { display: flex; gap: 16px; flex-wrap: wrap; margin-bottom: 12px; }
.empty { text-align: center; color: var(--text-2); padding: 48px 0; }
@media (max-width: 768px) {
  .site-header .container { height: auto; flex-wrap: wrap; padding: 8px 16px; gap: 8px; }
  .site-search { display: none; }
  .home-grid { grid-template-columns: 1fr; }
  .content-item .thumb { width: 110px; height: 74px; }
}
`;

function NavLinks({ items, currentUrl }: { items: CmsNavItem[]; currentUrl?: string }) {
  return (
    <nav className="site-nav">
      {items.map((item) => (
        <a key={item.id} href={item.url} target={item.target} className={currentUrl && currentUrl === item.url ? 'active' : undefined}>
          {item.name}
        </a>
      ))}
    </nav>
  );
}

export interface LayoutProps {
  ctx: CmsBaseContext;
  currentUrl?: string;
  children: ReactNode;
}

/** 行为采集 beacon 脚本（page_view + 详情页浏览计数），仅站点开启统计时注入 */
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

/** 默认主题布局：完整 HTML 文档（内联样式，静态页零外部依赖） */
export function Layout({ ctx, currentUrl, children }: LayoutProps) {
  const { site, seo, nav, friendLinks, baseUrl } = ctx;
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
        <style dangerouslySetInnerHTML={{ __html: styles }} />
      </head>
      <body>
        {ctx.analytics ? (
          // 轻量行为采集 beacon：page_view 上报 + 详情页浏览计数（静态页零依赖）
          <script dangerouslySetInnerHTML={{ __html: buildAnalyticsBeacon(ctx.analytics) }} />
        ) : null}
        <header className="site-header">
          <div className="container">
            <a className="site-brand" href={`${baseUrl}/`}>
              {site.logo ? <img src={site.logo} alt={site.name} /> : null}
              <span>{site.name}</span>
            </a>
            <NavLinks items={nav} currentUrl={currentUrl} />
            <form className="site-search" action={ctx.searchUrl} method="get">
              <input type="search" name="q" placeholder="站内搜索…" />
            </form>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="container">
            {friendLinks.length > 0 ? (
              <div className="links">
                <span>友情链接：</span>
                {friendLinks.map((l) => (
                  <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">{l.name}</a>
                ))}
              </div>
            ) : null}
            <div>{site.copyright ?? `© ${new Date().getFullYear()} ${site.name}`}</div>
            {site.icp ? (
              <div>
                <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer">{site.icp}</a>
              </div>
            ) : null}
          </div>
        </footer>
      </body>
    </html>
  );
}
