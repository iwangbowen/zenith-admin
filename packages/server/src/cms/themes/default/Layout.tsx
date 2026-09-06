import type { ReactNode } from 'react';
import type { CmsBaseContext, CmsNavItem } from '../types';
import { SeoHead, ThemeFooterLinks, buildAnalyticsBeacon } from '../_shared';

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

/** 暗色变量组（[data-theme=dark] 或 auto 模式下系统偏好）；注册进主题对象 darkVars 供样式装配 */
export const DEFAULT_THEME_DARK_VARS = '--text:#e6edf3; --text-2:#9198a1; --border:#3d444d; --bg:#0d1117; --bg-2:#151b23;';

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

/** 默认主题布局：完整 HTML 文档（样式经 ctx.assets 输出：正式外链指纹 CSS / 预览内联） */
export function Layout({ ctx, currentUrl, children }: LayoutProps) {
  const { site, nav, friendLinkGroups, baseUrl } = ctx;
  const contactPhone = typeof site.themeConfig.contactPhone === 'string' ? site.themeConfig.contactPhone : null;
  const footerText = typeof site.themeConfig.footerText === 'string' ? site.themeConfig.footerText : null;
  return (
    <html lang="zh-CN">
      <SeoHead ctx={ctx} langAlternates />
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
          <div className="site-topbar">
            <div className="container">
              <a className="site-brand" href={`${baseUrl}/`}>
                {site.logo ? <img src={site.logo} alt={site.name} /> : null}
                <span>{site.name}</span>
              </a>
              <CmsFollowButton siteId={site.id} subjectType="site" subjectId={site.id} label={site.name} />
              <span className="site-topbar-spacer" />
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
                <button type="submit">搜索</button>
              </form>
              {ctx.assets.darkMode !== 'light' ? (
                <button type="button" className="theme-toggle" title="切换明暗主题" aria-label="切换明暗主题">◑</button>
              ) : null}
            </div>
          </div>
          <div className="main-nav">
            <div className="container">
              <a href={`${baseUrl}/`} className={`nav-home${currentUrl === `${baseUrl}/` ? ' active' : ''}`}>首页</a>
              <NavLinks items={nav} currentUrl={currentUrl} />
            </div>
          </div>
        </header>
        <main>
          <div className="container">{children}</div>
        </main>
        <footer className="site-footer">
          <div className="container">
            <ThemeFooterLinks
              friendLinkGroups={friendLinkGroups}
              footerText={footerText}
              site={site}
              classNames={{ linkGroups: 'link-groups', links: 'links', extra: 'extra' }}
              mode="grouped"
            />
          </div>
        </footer>
      </body>
    </html>
  );
}
