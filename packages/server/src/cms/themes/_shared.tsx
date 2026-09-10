/**
 * 主题公共件：全部主题共用的 SEO head、暗色主题脚本、埋点 beacon、分页、面包屑、
 * 上下篇导航、相关阅读与附件列表。
 *
 * 这些片段与主题视觉无关（只输出语义结构，样式由各主题 styles.css 决定）。
 * 主题样式表装配（base.css + 主题 css + 站点覆盖）见 theme-css.ts，
 * SeoHead 统一消费渲染管线注入的 ctx.assets（正式外链 / 预览内联）。
 */
import type { CSSProperties, ReactNode } from 'react';
import type { CmsContentAttachment, CmsFormField, CmsSearchResult } from '@zenith/shared/cms';
import type { CmsBaseContext, CmsBodyPagination, CmsBreadcrumb, CmsContentDetail, CmsFrontFormConfig, CmsModelFieldValue, CmsPageContext, CmsPagination, CmsRenderSite, CmsSearchContext, CmsThemeContentCollection, CmsThemeDataApi } from './types';
import { serializeJsonForScript } from '../../lib/json-script';

/** 暗色初始化脚本（head 内先行执行防闪烁）+ 切换按钮事件委托 */
export const THEME_TOGGLE_SCRIPT = `(function(){try{
var t=localStorage.getItem('cms_theme');if(t==='dark'||t==='light'){document.documentElement.setAttribute('data-theme',t);}
document.addEventListener('click',function(e){
var b=e.target&&e.target.closest?e.target.closest('.theme-toggle'):null;if(!b)return;
var h=document.documentElement;var cur=h.getAttribute('data-theme');
var next=cur==='dark'?'light':(cur==='light'?'dark':(window.matchMedia('(prefers-color-scheme: dark)').matches?'light':'dark'));
h.setAttribute('data-theme',next);localStorage.setItem('cms_theme',next);});
}catch(e){}})();`;

export interface SeoHeadProps {
  ctx: CmsBaseContext;
  /** 是否输出 hreflang 备用语言链接（仅多语言站点主题需要） */
  langAlternates?: boolean;
  /** 主题追加的 head 节点（额外 preload / 第三方脚本等） */
  children?: ReactNode;
}

/**
 * 完整 `<head>`：TDK + Open Graph + Twitter Card + JSON-LD + 站点图标 + 主题样式与暗色脚本。
 *
 * 三级 TDK 覆盖与各 SEO 字段的取值已在渲染上下文（`ctx.seo`）算好；
 * 主题样式经 `ctx.assets` 输出——正式渲染外链指纹 CSS，预览渲染内联。
 */
export function SeoHead({ ctx, langAlternates = false, children }: SeoHeadProps) {
  const { site, seo, assets } = ctx;
  return (
    <head>
      <meta charSet="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{seo.title}</title>
      {seo.keywords ? <meta name="keywords" content={seo.keywords} /> : null}
      {seo.description ? <meta name="description" content={seo.description} /> : null}
      {seo.canonical ? <link rel="canonical" href={seo.canonical} /> : null}
      {langAlternates
        ? ctx.langAlternates.map((alt) => (
          <link key={alt.language} rel="alternate" hrefLang={alt.language} href={alt.url} />
        ))
        : null}
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
      {/* 页面级岛配置（非执行内容，不进 CSP 哈希）：站点编码供广告令牌；统计开启时输出采集 key 与详情内容 id */}
      <meta name="cms-site" content={site.code} />
      {ctx.analytics ? <meta name="cms-analytics-key" content={ctx.analytics.siteKey} /> : null}
      {ctx.analytics?.contentId ? <meta name="cms-content-id" content={String(ctx.analytics.contentId)} /> : null}
      {seo.jsonLd ? (
        <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: serializeJsonForScript(seo.jsonLd) }} />
      ) : null}
      {assets.cssHref
        ? <link rel="stylesheet" href={assets.cssHref} />
        : <style dangerouslySetInnerHTML={{ __html: assets.inlineCss ?? '' }} />}
      {/* 前台岛脚本：module 默认 defer，放 head 以尽早并行下载；无 src 才需要 CSP 哈希，外链由 'self' 放行 */}
      {assets.jsHref ? <script type="module" src={assets.jsHref} /> : null}
      {assets.darkMode !== 'light' ? (
        <script dangerouslySetInnerHTML={{ __html: THEME_TOGGLE_SCRIPT }} />
      ) : null}
      {children}
    </head>
  );
}

interface PageLinksProps {
  p: CmsPagination | CmsBodyPagination | null;
  container?: 'div' | 'nav';
  className: string;
}

/** 分页链接循环：单页时不渲染 */
export function PageLinks({ p, container: Container = 'div', className }: PageLinksProps) {
  if (!p || p.totalPages <= 1) return null;
  return (
    <Container className={className}>
      {p.prevUrl ? <a href={p.prevUrl}>上一页</a> : null}
      {p.pages.map((pg) => (
        pg.current
          ? <span key={pg.page} className="current">{pg.page}</span>
          : <a key={pg.page} href={pg.url}>{pg.page}</a>
      ))}
      {p.nextUrl ? <a href={p.nextUrl}>下一页</a> : null}
    </Container>
  );
}

/** 分页条：单页时不渲染 */
export function Pagination({ p }: { p: CmsPagination }) {
  return <PageLinks p={p} className="pagination" />;
}

interface CaptchaBoxProps {
  provider: CmsFrontFormConfig['captcha']['provider'];
  siteKey?: string | null;
  className?: string;
  mathBoxStyle?: CSSProperties;
  mathLabelStyle?: CSSProperties;
  mathInputAutoComplete?: string;
  mathInputPlaceholder?: string;
  mathImageStyle?: CSSProperties;
}

/** 前台表单验证码：math 输出本地挑战，Turnstile 输出官方挂件脚本 */
export function CaptchaBox({
  provider,
  siteKey,
  className = 'cms-captcha-box',
  mathBoxStyle,
  mathLabelStyle,
  mathInputAutoComplete,
  mathInputPlaceholder,
  mathImageStyle,
}: CaptchaBoxProps) {
  if (provider === 'none') return null;
  if (provider === 'math') {
    return (
      <div className={className} style={mathBoxStyle} data-island="captcha">
        <input type="hidden" name="captchaId" value="" />
        <label style={mathLabelStyle}>验证码 <span className="req">*</span><input type="text" name="captchaAnswer" required autoComplete={mathInputAutoComplete} placeholder={mathInputPlaceholder} /></label>
        <span className="cms-captcha-img" style={mathImageStyle} />
      </div>
    );
  }
  if (!siteKey) return null;
  return (
    <>
      <div className="cf-turnstile" data-sitekey={siteKey} />
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
    </>
  );
}

interface FrontFormProps {
  form: CmsFrontFormConfig;
  buttonText?: string;
  className?: string;
  radioLabelStyle?: CSSProperties;
  captchaBox?: Omit<CaptchaBoxProps, 'provider' | 'siteKey'>;
}

function FieldControl({ field: f, radioLabelStyle }: { field: CmsFormField; radioLabelStyle?: CSSProperties }) {
  if (f.fieldType === 'textarea') {
    return <textarea name={f.name} required={f.required} minLength={f.minLength ?? undefined} maxLength={f.maxLength ?? 2000} />;
  }
  if (f.fieldType === 'select') {
    return (
      <select name={f.name} required={f.required} defaultValue="">
        <option value="" disabled>请选择</option>
        {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (f.fieldType === 'radio') {
    return (
      <span>
        {(f.options ?? []).map((o) => (
          <label key={o.value} style={radioLabelStyle}>
            <input type="radio" name={f.name} value={o.value} required={f.required} /> {o.label}
          </label>
        ))}
      </span>
    );
  }
  return (
    <input
      type={f.fieldType === 'email' ? 'email' : f.fieldType === 'url' ? 'url' : f.fieldType === 'number' ? 'number' : 'text'}
      inputMode={f.fieldType === 'mobile' ? 'tel' : undefined}
      name={f.name}
      required={f.required}
      minLength={f.minLength ?? undefined}
      maxLength={f.maxLength ?? 200}
      pattern={f.fieldType === 'mobile' ? '1[3-9][0-9]{9}' : (f.pattern ?? undefined)}
      min={f.min ?? undefined}
      max={f.max ?? undefined}
    />
  );
}

/** 前台自定义表单（栏目绑定，原生 form POST） */
export function FrontForm({ form, buttonText = '提交', className = 'front-form', radioLabelStyle, captchaBox }: FrontFormProps) {
  return (
    <form className={className} method="post" action={form.action}>
      <h2>{form.name}</h2>
      <input type="hidden" name="returnUrl" value={form.returnUrl} />
      <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      {form.fields.map((f) => (
        <label key={f.name}>
          {f.label} {f.required ? <span className="req">*</span> : null}
          <FieldControl field={f} radioLabelStyle={radioLabelStyle} />
        </label>
      ))}
      <CaptchaBox provider={form.captcha.provider} siteKey={form.captcha.siteKey} {...captchaBox} />
      <button type="submit">{buttonText}</button>
    </form>
  );
}

interface ThemeFooterLinksProps {
  friendLinkGroups: CmsBaseContext['friendLinkGroups'];
  friendLinks?: CmsBaseContext['friendLinks'];
  footerText: string | null;
  site: Pick<CmsBaseContext['site'], 'name' | 'copyright' | 'icp'>;
  classNames?: {
    linkGroups?: string;
    links?: string;
    extra?: string;
  };
  mode?: 'grouped' | 'flat';
  linkRel?: string;
  fallbackCopyright?: boolean;
}

/** 主题页脚友链、附加文案、版权与备案号 */
export function ThemeFooterLinks({
  friendLinkGroups,
  friendLinks,
  footerText,
  site,
  classNames,
  mode = 'flat',
  linkRel = 'noopener noreferrer',
  fallbackCopyright = true,
}: ThemeFooterLinksProps) {
  const flatLinks = friendLinks ?? friendLinkGroups.flatMap((group) => group.links);
  const copyright = site.copyright ?? (fallbackCopyright ? `© ${new Date().getFullYear()} ${site.name}` : null);
  return (
    <>
      {mode === 'grouped' && friendLinkGroups.length > 0 ? (
        <div className={classNames?.linkGroups}>
          {friendLinkGroups.map((group) => (
            <div className={classNames?.links} key={group.code || '__ungrouped'}>
              <span>{group.name || '友情链接'}：</span>
              {group.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel={linkRel}>{l.name}</a>
              ))}
            </div>
          ))}
        </div>
      ) : null}
      {mode === 'flat' && flatLinks.length > 0 ? (
        <div className={classNames?.links}>
          {flatLinks.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel={linkRel}>{l.name}</a>
          ))}
        </div>
      ) : null}
      {footerText ? <div className={classNames?.extra}>{footerText}</div> : null}
      {copyright ? <div>{copyright}</div> : null}
      {site.icp ? (
        <div><a href="https://beian.miit.gov.cn/" target="_blank" rel={linkRel}>{site.icp}</a></div>
      ) : null}
    </>
  );
}

/** 面包屑：末级为当前页（纯文本），其余为链接 */
export function Breadcrumbs({ items }: { items: CmsBreadcrumb[] }) {
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

/** 上一篇 / 下一篇导航：两者皆空时不渲染。样式钩子 .article-nav */
export function ArticleNav({ prev, next }: Pick<CmsContentDetail, 'prev' | 'next'>) {
  if (!prev && !next) return null;
  return (
    <nav className="article-nav">
      {prev ? <span>上一篇：<a href={prev.url}>{prev.title}</a></span> : null}
      {next ? <span>下一篇：<a href={next.url}>{next.title}</a></span> : null}
    </nav>
  );
}

/** 相关阅读列表：空列表不渲染。样式钩子 .related-articles */
export function RelatedArticles({ items, title = '相关阅读', heading: Heading = 'h3' }: {
  items: { title: string; url: string }[];
  title?: string;
  heading?: 'h2' | 'h3';
}) {
  if (items.length === 0) return null;
  return (
    <section className="related-articles">
      <Heading>{title}</Heading>
      <ul>
        {items.map((r) => <li key={r.url}><a href={r.url}>{r.title}</a></li>)}
      </ul>
    </section>
  );
}

/** 附件下载链接列表：无附件不渲染。样式钩子 .attachments / .ext */
export function AttachmentList({ items }: { items: CmsContentAttachment[] }) {
  if (items.length === 0) return null;
  return (
    <ul className="attachments">
      {items.map((a) => (
        <li key={`${a.url}-${a.sort}`}>
          <a href={a.url} download target="_blank" rel="noopener">
            {a.ext ? <span className="ext">{a.ext.toUpperCase()}</span> : null}
            {a.name}
          </a>
        </li>
      ))}
    </ul>
  );
}

/** 外链新窗口打开并阻断 referrer / 权重传递；站内链接不加属性 */
export function externalLinkProps(isExternal: boolean): { target?: string; rel?: string } {
  return isExternal ? { target: '_blank', rel: 'noopener nofollow' } : {};
}

/** 搜索结果链接：外链原样，站内链接补站点 baseUrl */
export function searchResultHref(result: { url: string; isExternal: boolean }, baseUrl: string): string {
  return result.isExternal ? result.url : `${baseUrl}${result.url}`;
}

/** 搜索结果标题链接：高亮标题 + 外链新窗口 */
export function SearchResultLink({ result, baseUrl }: { result: CmsSearchResult; baseUrl: string }) {
  return (
    <a
      href={searchResultHref(result, baseUrl)}
      {...externalLinkProps(result.isExternal)}
      dangerouslySetInnerHTML={{ __html: result.titleHighlight }}
    />
  );
}

/**
 * 搜索结果列表：空态文案统一；默认条目为「标题链接 + 发布日期」，
 * 需要摘要 / 栏目名等更丰富条目的主题传 renderItem（条目根元素自带 key）。
 */
export function SearchResultList({ ctx, className = 'content-list', renderItem }: {
  ctx: CmsSearchContext;
  className?: string;
  renderItem?: (result: CmsSearchResult) => ReactNode;
}) {
  const render = renderItem ?? ((r: CmsSearchResult) => (
    <div className="content-item" key={r.id}>
      <SearchResultLink result={r} baseUrl={ctx.baseUrl} />
      <PublishedDate value={r.publishedAt} />
    </div>
  ));
  return (
    <div className={`${className} search-result`}>
      {ctx.results.length === 0 ? (
        <div className="empty">未找到相关内容</div>
      ) : ctx.results.map((r) => render(r))}
    </div>
  );
}

/** 首页栏目区块：栏目已解析（不存在的栏目已被过滤） */
export type CmsThemeHomeBlock = CmsThemeContentCollection & { channel: NonNullable<CmsThemeContentCollection['channel']> };

/**
 * 首页栏目区块取数：主题参数 homeChannels 为逗号（中英文）分隔的栏目标识，
 * 截取前 maxChannels 个并发读取各栏目最新内容，跳过站内不存在的栏目。
 */
export async function loadHomeBlocks(
  cms: CmsThemeDataApi,
  site: CmsRenderSite,
  { limit, maxChannels = 6 }: { limit: number; maxChannels?: number },
): Promise<CmsThemeHomeBlock[]> {
  const raw = typeof site.themeConfig.homeChannels === 'string' ? site.themeConfig.homeChannels : '';
  const codes = raw.split(/[,，]/).map((code) => code.trim()).filter(Boolean).slice(0, maxChannels);
  const blocks = await Promise.all(codes.map((code) => cms.contents.list({ channelCode: code, limit })));
  return blocks.filter((block): block is CmsThemeHomeBlock => block.channel !== null);
}

/** 发布日期（`YYYY-MM-DD` 部分）；无值不渲染 */
export function PublishedDate({ value }: { value: string | null | undefined }) {
  return value ? <time>{value.slice(0, 10)}</time> : null;
}

/** 内容标签链接组：无标签不渲染。容器 / 链接 class 与「标签名是否包 span」由主题指定 */
export function TagLinks({ tags, className, linkClassName, wrapName = false }: {
  tags: CmsContentDetail['tags'];
  className: string;
  linkClassName?: string;
  wrapName?: boolean;
}) {
  if (tags.length === 0) return null;
  return (
    <div className={className}>
      {tags.map((t) => (
        <a key={t.slug} className={linkClassName} href={t.url}>{wrapName ? <span>{t.name}</span> : t.name}</a>
      ))}
    </div>
  );
}

/** 单页正文：栏目名作标题 + 富文本正文。样式钩子 .article / .body */
export function SinglePageArticle({ ctx }: { ctx: CmsPageContext }) {
  return (
    <article className="article">
      <h1>{ctx.channel.name}</h1>
      <div className="body" dangerouslySetInnerHTML={{ __html: ctx.contentHtml }} />
    </article>
  );
}

/**
 * 模型字段表：按 group 分组渲染 `ctx.content.modelFields` 为键值表格
 * （政府站「文件信息表头」：文号 / 发布机关 / 成文日期 / 有效性等）。
 * 无勾选字段时不渲染；样式钩子 .model-fields / .model-fields-group / .model-fields-table。
 */
export function ModelFieldTable({ fields }: { fields: CmsModelFieldValue[] }) {
  const visible = fields.filter((f) => f.displayValue !== '');
  if (visible.length === 0) return null;
  const groups = new Map<string, CmsModelFieldValue[]>();
  for (const field of visible) {
    const key = field.group ?? '';
    groups.set(key, [...(groups.get(key) ?? []), field]);
  }
  return (
    <div className="model-fields">
      {[...groups.entries()].map(([group, list]) => (
        <div className="model-fields-group" key={group || '__default'}>
          {group ? <div className="model-fields-title">{group}</div> : null}
          <table className="model-fields-table">
            <tbody>
              {chunkPairs(list).map((pair) => (
                <tr key={pair[0].name}>
                  <th>{pair[0].label}</th>
                  <td>{pair[0].displayValue}</td>
                  {pair[1] ? <th>{pair[1].label}</th> : <th />}
                  {pair[1] ? <td>{pair[1].displayValue}</td> : <td />}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}

/** 两列布局配对（政府公文信息表惯用双栏键值排布） */
function chunkPairs(list: CmsModelFieldValue[]): [CmsModelFieldValue, CmsModelFieldValue | undefined][] {
  const out: [CmsModelFieldValue, CmsModelFieldValue | undefined][] = [];
  for (let i = 0; i < list.length; i += 2) out.push([list[i], list[i + 1]]);
  return out;
}


/**
 * 内容形态区块：图集九宫格 / 音视频播放器（article/link 返回 null）。
 * 详情模板须在正文前调用，否则 album/media 形态只剩正文，主图数据丢失。
 * 样式钩子 .album-grid / .media-player（默认样式见 _shared/base.css）。
 */
export function MediaBlock({ content }: {
  content: {
    contentType: 'article' | 'album' | 'media' | 'link';
    title: string;
    albumImages: { url: string; thumb: string | null; caption: string | null }[];
    mediaType: 'video' | 'audio' | null;
    mediaUrl: string | null;
    mediaPoster: string | null;
    mediaDuration: string | null;
  };
}) {
  if (content.contentType === 'album' && content.albumImages.length > 0) {
    return (
      <div className="album-grid">
        {content.albumImages.map((img, i) => (
          <figure key={`${img.url}-${i}`}>
            <a href={img.url} target="_blank" rel="noopener">
              <img src={img.thumb ?? img.url} alt={img.caption ?? `${content.title} ${i + 1}`} loading="lazy" />
            </a>
            {img.caption ? <figcaption>{img.caption}</figcaption> : null}
          </figure>
        ))}
      </div>
    );
  }
  if (content.contentType === 'media' && content.mediaUrl) {
    return (
      <div className="media-player">
        {content.mediaType === 'audio'
          ? <audio src={content.mediaUrl} controls preload="metadata" />
          : <video src={content.mediaUrl} controls preload="metadata" poster={content.mediaPoster ?? undefined} />}
        {content.mediaDuration ? <div className="media-duration">时长：{content.mediaDuration}</div> : null}
      </div>
    );
  }
  return null;
}
