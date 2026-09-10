import type { ReactNode } from 'react';
import type { CmsBaseContext, CmsNavItem } from '../types';
import { SeoHead, ThemeFooterLinks } from '../_shared';

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

const MEMBER_AUDIENCE_RELOAD_SCRIPT = `(function(){var key='cms-audience:'+location.pathname;try{if(sessionStorage.getItem(key)==='1'){sessionStorage.removeItem(key);return}}catch(e){}var token=null;try{token=localStorage.getItem('zenith_member_token')}catch(e){}if(!token)return;try{sessionStorage.setItem(key,'1')}catch(e){}fetch(location.href,{headers:{Authorization:'Bearer '+token},cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('reload');return r.text()}).then(function(html){document.open();document.write(html);document.close()}).catch(function(){try{sessionStorage.removeItem(key)}catch(e){}})})();`;
const MEMBER_AUDIENCE_CLEAR_SCRIPT = `(function(){try{sessionStorage.removeItem('cms-audience:'+location.pathname)}catch(e){}})();`;

/** 关注按钮：交互由 islands/follow.ts 按 data-island 挂载（契约：data-site / data-subject-*） */
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
      data-island="follow"
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
        {/* 会员受众页：游客首屏后尽早以会员身份重取文档，保留内联同步执行（不进岛脚本） */}
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
