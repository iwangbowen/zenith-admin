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
.site-contact { flex-shrink: 0; font-size: 14px; font-weight: 600; color: var(--primary); white-space: nowrap; }
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
.badge.type { background: var(--bg-2); color: var(--text-2); border: 1px solid var(--border); }
.album-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 12px; margin: 16px 0; }
.album-grid figure { margin: 0; }
.album-grid a { display: block; border-radius: 8px; overflow: hidden; border: 1px solid var(--border); }
.album-grid img { width: 100%; aspect-ratio: 4/3; object-fit: cover; display: block; }
.album-grid figcaption { font-size: 13px; color: var(--text-2); padding: 6px 2px; text-align: center; }
.media-player { margin: 16px 0; }
.media-player video, .media-player audio { width: 100%; border-radius: 8px; background: #000; }
.media-player audio { background: transparent; }
.media-duration { font-size: 13px; color: var(--text-2); margin-top: 6px; }
.body-pagination { display: flex; gap: 6px; justify-content: center; margin: 20px 0 4px; flex-wrap: wrap; }
.body-pagination a, .body-pagination span { padding: 5px 11px; border: 1px solid var(--border); border-radius: 6px; font-size: 14px; }
.body-pagination .current { background: var(--primary); border-color: var(--primary); color: #fff; }
.interaction-bar { display: flex; align-items: center; gap: 12px; margin-top: 24px; padding-top: 16px; border-top: 1px solid var(--border); flex-wrap: wrap; }
.interaction-bar button { padding: 7px 16px; border: 1px solid var(--border); border-radius: 18px; background: var(--bg-2); font-size: 14px; cursor: pointer; color: var(--text-1); }
.interaction-bar button.active { background: var(--primary); border-color: var(--primary); color: #fff; }
.interaction-hint { font-size: 12px; color: var(--text-2); }
.survey-desc { color: var(--text-2); margin-bottom: 16px; }
.survey-hint { font-size: 13px; color: #953800; background: #fff8c5; padding: 8px 12px; border-radius: 6px; }
.survey-question { border: 1px solid var(--border); border-radius: 8px; padding: 14px 16px; margin: 14px 0; }
.survey-question legend { font-weight: 600; font-size: 15px; padding: 0 6px; }
.survey-options { display: flex; flex-direction: column; gap: 8px; }
.survey-option { display: flex; align-items: center; gap: 8px; font-size: 14px; }
.survey-done { padding: 32px; text-align: center; font-size: 16px; color: var(--primary); }
.poll-title { font-size: 16px; margin: 0 0 10px; }
.cms-poll { margin: 16px 0; padding: 16px; border: 1px solid var(--border); border-radius: 10px; background: var(--bg-2); }
.poll-option { display: flex; align-items: center; gap: 8px; padding: 6px 0; font-size: 14px; cursor: pointer; }
.poll-form button { margin-top: 10px; }
.poll-hint { font-size: 12px; color: var(--text-2); margin: 6px 0 0; }
.poll-bar-row { display: flex; align-items: center; gap: 10px; padding: 5px 0; font-size: 13px; }
.poll-bar-label { flex: 0 0 30%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.poll-bar-track { flex: 1; height: 10px; border-radius: 5px; background: var(--bg-3, rgba(140, 149, 159, 0.2)); overflow: hidden; }
.poll-bar-fill { display: block; height: 100%; border-radius: 5px; background: var(--primary); }
.poll-bar-num { flex: 0 0 90px; text-align: right; color: var(--text-2); font-size: 12px; }
.poll-total { margin: 8px 0 0; font-size: 12px; color: var(--text-2); }
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
.section-title { font-size: 18px; font-weight: 600; margin: 28px 0 8px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
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
.comment-item .meta .member-badge { display: inline-block; padding: 0 6px; border-radius: 8px; background: color-mix(in srgb, var(--primary) 12%, transparent); color: var(--primary); font-size: 11px; line-height: 18px; }
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
.site-footer .extra { white-space: pre-line; margin-bottom: 8px; }
.empty { text-align: center; color: var(--text-2); padding: 48px 0; }
.theme-toggle { background: none; border: 1px solid var(--border); border-radius: 6px; width: 32px; height: 32px; cursor: pointer; font-size: 15px; line-height: 1; color: var(--text-2); flex-shrink: 0; }
.theme-toggle:hover { color: var(--primary); border-color: var(--primary); }
.cms-follow { border: 1px solid var(--border); border-radius: 999px; background: transparent; color: var(--text-2); padding: 5px 12px; cursor: pointer; font-size: 12px; white-space: nowrap; }
.cms-follow[aria-pressed="true"] { border-color: var(--primary); color: var(--primary); }
.cms-follow:disabled { cursor: wait; opacity: .6; }
.lang-switch { display: flex; gap: 8px; font-size: 13px; }
.lang-switch a { color: var(--text-2); text-decoration: none; }
.lang-switch a:hover { color: var(--primary); }
.lang-switch .active { color: var(--primary); font-weight: 600; }
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

/** 暗色变量组（[data-theme=dark] 或 auto 模式下系统偏好） */
const DARK_VARS = '--text:#e6edf3; --text-2:#9198a1; --border:#3d444d; --bg:#0d1117; --bg-2:#151b23;';

/** 主题参数（站点 settings）：主色 / 暗色模式 */
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

/** 暗色初始化脚本（head 内先行执行防闪烁）+ 切换按钮事件委托 */
const THEME_TOGGLE_SCRIPT = `(function(){try{
var t=localStorage.getItem('cms_theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}
document.addEventListener('click',function(e){
var b=e.target&&e.target.closest?e.target.closest('.theme-toggle'):null;if(!b)return;
var h=document.documentElement;var cur=h.getAttribute('data-theme');
var next=cur==='dark'?'light':(cur==='light'?'dark':(window.matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark'));
h.setAttribute('data-theme',next);localStorage.setItem('cms_theme',next);});
}catch(e){}})();`;

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

/** 静态页也在浏览器渲染后领取短期一次性令牌，再启用广告点击并上报曝光。 */
function buildAdEventScript(siteCode: string): string {
  return `(function(){try{
var els=document.querySelectorAll('[data-ad-id]');if(!els.length)return;
var ads=[];els.forEach(function(el){var v=Number(el.getAttribute('data-ad-id')),p=el.getAttribute('data-ad-render-proof');if(v&&p&&!ads.some(function(x){return x.adId===v}))ads.push({adId:v,renderProof:p});});if(!ads.length)return;
var h={'Content-Type':'application/json'},mt=null;try{mt=localStorage.getItem('zenith_member_token')}catch(e){}if(mt)h.Authorization='Bearer '+mt;
fetch('/api/public/cms/ads/tokens/'+encodeURIComponent(${JSON.stringify(siteCode)}),{method:'POST',headers:h,body:JSON.stringify({ads:ads})})
.then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0||!Array.isArray(r.data))return;var views=[];
r.data.forEach(function(item){var el=document.querySelector('[data-ad-id="'+item.adId+'"]');if(!el)return;if(item.clickToken&&el.getAttribute('data-ad-clickable')==='true')el.href='/api/public/cms/ads/'+item.adId+'/click?token='+encodeURIComponent(item.clickToken);if(item.viewToken)views.push(item.viewToken)});
if(views.length)return fetch('/api/public/cms/ads/view',{method:'POST',headers:h,body:JSON.stringify({tokens:views}),keepalive:true});
}).catch(function(){});
}catch(e){}})();`;
}

const FOLLOW_SCRIPT = `(function(){var buttons=document.querySelectorAll('.cms-follow');if(!buttons.length)return;var token=null;try{token=localStorage.getItem('zenith_member_token')}catch(e){}function body(b){var v={siteId:Number(b.dataset.site),subjectType:b.dataset.subjectType,notificationEnabled:true};if(b.dataset.subjectId)v.subjectId=Number(b.dataset.subjectId);if(b.dataset.subjectKey)v.subjectKey=b.dataset.subjectKey;return v}function set(b,row){b.dataset.subscriptionId=row?String(row.id):'';b.setAttribute('aria-pressed',row?'true':'false');b.textContent=row?'已关注':'关注'}buttons.forEach(function(b){if(!token){b.textContent='登录后关注';b.addEventListener('click',function(){location.href='/member.html#/' });return}var v=body(b),p=new URLSearchParams();Object.keys(v).forEach(function(k){if(v[k]!=null)p.set(k,String(v[k]))});fetch('/api/member/cms/subscriptions/status?'+p.toString(),{headers:{Authorization:'Bearer '+token}}).then(function(r){return r.json()}).then(function(r){if(r&&r.code===0)set(b,r.data)}).catch(function(){});b.addEventListener('click',function(){b.disabled=true;var id=Number(b.dataset.subscriptionId)||0;var req=id?fetch('/api/member/cms/subscriptions/'+id,{method:'DELETE',headers:{Authorization:'Bearer '+token}}):fetch('/api/member/cms/subscriptions',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+token,'X-Idempotency-Key':'follow-'+Date.now()},body:JSON.stringify(v)});req.then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0){alert(r&&r.message||'操作失败');return}set(b,id?null:r.data)}).catch(function(){alert('操作失败，请稍后重试')}).finally(function(){b.disabled=false})})})})();`;

const MEMBER_AUDIENCE_RELOAD_SCRIPT = `(function(){var key='cms-audience:'+location.pathname;try{if(sessionStorage.getItem(key)==='1'){sessionStorage.removeItem(key);return}}catch(e){}var token=null;try{token=localStorage.getItem('zenith_member_token')}catch(e){}if(!token)return;try{sessionStorage.setItem(key,'1')}catch(e){}fetch(location.href,{headers:{Authorization:'Bearer '+token},cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('reload');return r.text()}).then(function(html){document.open();document.write(html);document.close()}).catch(function(){try{sessionStorage.removeItem(key)}catch(e){}})})();`;
const MEMBER_AUDIENCE_CLEAR_SCRIPT = `(function(){try{sessionStorage.removeItem('cms-audience:'+location.pathname)}catch(e){}})();`;

export function CmsFollowButton(props: {
  siteId: number;
  subjectType: 'site' | 'channel' | 'author';
  subjectId?: number;
  subjectKey?: string;
  label: string;
}) {
  return (
    <button
      type="button"
      className="cms-follow"
      data-site={props.siteId}
      data-subject-type={props.subjectType}
      data-subject-id={props.subjectId}
      data-subject-key={props.subjectKey}
      aria-label={`关注${props.label}`}
      aria-pressed="false"
    >
      关注
    </button>
  );
}

/** 默认主题布局：完整 HTML 文档（内联样式，静态页零外部依赖） */
export function Layout({ ctx, currentUrl, children }: LayoutProps) {
  const { site, seo, nav, friendLinks, baseUrl } = ctx;
  const theme = buildThemeOverrides(site.settings);
  const contactPhone = typeof site.themeConfig.contactPhone === 'string' ? site.themeConfig.contactPhone : null;
  const footerText = typeof site.themeConfig.footerText === 'string' ? site.themeConfig.footerText : null;
  return (
    <html lang="zh-CN">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{seo.title}</title>
        {seo.keywords ? <meta name="keywords" content={seo.keywords} /> : null}
        {seo.description ? <meta name="description" content={seo.description} /> : null}
        {seo.canonical ? <link rel="canonical" href={seo.canonical} /> : null}
        {ctx.langAlternates.map((alt) => (
          <link key={alt.language} rel="alternate" hrefLang={alt.language} href={alt.url} />
        ))}
        <meta property="og:type" content={seo.ogType} />
        <meta property="og:title" content={seo.ogTitle} />
        {seo.ogDescription ? <meta property="og:description" content={seo.ogDescription} /> : null}
        {seo.ogImage ? <meta property="og:image" content={seo.ogImage} /> : null}
        {seo.ogImageAlt ? <meta property="og:image:alt" content={seo.ogImageAlt} /> : null}
        {seo.ogUrl ? <meta property="og:url" content={seo.ogUrl} /> : null}
        <meta property="og:site_name" content={seo.ogSiteName} />
        {seo.articlePublishedTime ? <meta property="article:published_time" content={seo.articlePublishedTime} /> : null}
        {seo.articleModifiedTime ? <meta property="article:modified_time" content={seo.articleModifiedTime} /> : null}
        {seo.articleAuthor ? <meta property="article:author" content={seo.articleAuthor} /> : null}
        <meta name="twitter:card" content={seo.twitterCard} />
        {seo.twitterSite ? <meta name="twitter:site" content={seo.twitterSite} /> : null}
        {seo.twitterCreator ? <meta name="twitter:creator" content={seo.twitterCreator} /> : null}
        <meta name="twitter:title" content={seo.twitterTitle} />
        {seo.twitterDescription ? <meta name="twitter:description" content={seo.twitterDescription} /> : null}
        {seo.twitterImage ? <meta name="twitter:image" content={seo.twitterImage} /> : null}
        {seo.twitterImageAlt ? <meta name="twitter:image:alt" content={seo.twitterImageAlt} /> : null}
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
          // 轻量行为采集 beacon：page_view 上报 + 详情页浏览计数（静态页零依赖）
          <script dangerouslySetInnerHTML={{ __html: buildAnalyticsBeacon(ctx.analytics) }} />
        ) : null}
        {/* 广告曝光 beacon：页面加载后批量上报本页广告 id（无广告时零开销） */}
        <script dangerouslySetInnerHTML={{ __html: buildAdEventScript(ctx.site.code) }} />
        <script dangerouslySetInnerHTML={{ __html: FOLLOW_SCRIPT }} />
        {ctx.audience?.dynamic && !ctx.audience.member ? (
          <script dangerouslySetInnerHTML={{ __html: MEMBER_AUDIENCE_RELOAD_SCRIPT }} />
        ) : null}
        {ctx.audience?.dynamic && ctx.audience.member ? (
          <script dangerouslySetInnerHTML={{ __html: MEMBER_AUDIENCE_CLEAR_SCRIPT }} />
        ) : null}
        <header className="site-header">
          <div className="container">
            <a className="site-brand" href={`${baseUrl}/`}>
              {site.logo ? <img src={site.logo} alt={site.name} /> : null}
              <span>{site.name}</span>
            </a>
            <CmsFollowButton siteId={site.id} subjectType="site" subjectId={site.id} label={site.name} />
            <NavLinks items={nav} currentUrl={currentUrl} />
            {contactPhone ? <span className="site-contact">☎ {contactPhone}</span> : null}
            {ctx.langAlternates.length > 0 ? (
              <nav className="lang-switch" aria-label="语言切换">
                {ctx.langAlternates.map((alt) => (
                  alt.current
                    ? <span key={alt.language} className="active">{alt.language}</span>
                    : <a key={alt.language} href={alt.url} hrefLang={alt.language}>{alt.language}</a>
                ))}
              </nav>
            ) : null}
            <form className="site-search" action={ctx.searchUrl} method="get">
              <input type="search" name="q" placeholder="站内搜索…" />
            </form>
            {theme.darkMode !== 'light' ? (
              <button type="button" className="theme-toggle" title="切换明暗主题" aria-label="切换明暗主题">◑</button>
            ) : null}
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
            {footerText ? <div className="extra">{footerText}</div> : null}
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
