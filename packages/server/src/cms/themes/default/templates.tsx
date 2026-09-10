import { CmsFollowButton, Layout } from './Layout';
import type { CSSProperties } from 'react';
import type { CmsContentAttachment, CmsTitleStyle } from '@zenith/shared/cms';
import type {
  CmsBaseContext, CmsContentItem, CmsHomeContext, CmsListContext,
  CmsDetailContext, CmsPageContext, CmsSearchContext, CmsNotFoundContext,
  CmsCommentItem, CmsCommentFormConfig, CmsTagPageContext, CmsCustomPageContext,
  CmsInteractionPageContext,
} from '../types';
import {
  resolveCmsRenderedPagePath,
  signCmsAdRenderProof,
} from '../../../services/cms/cms-ad-render-proof';
import { renderCmsWidgetHtml } from '../widgets';
import { ArticleNav, Breadcrumbs, FrontForm, MediaBlock, ModelFieldTable, PageLinks, Pagination, RelatedArticles, PublishedDate, SinglePageArticle, TagLinks, externalLinkProps, loadHomeBlocks, SearchResultLink, SearchResultList } from '../_shared';
import { defineHomeTemplate } from '../sdk';
import type { CmsThemeContentCollection } from '../types';
import { formatBytes } from '@zenith/shared/core';

const TYPE_BADGES: Record<string, string | null> = { article: null, album: '图集', media: '视频', link: '外链' };

function typeBadgeText(item: CmsContentItem): string | null {
  if (item.contentType === 'media') return item.mediaType === 'audio' ? '音频' : '视频';
  if (item.contentType === 'album') return item.imageCount > 1 ? `图集·${item.imageCount}` : '图集';
  return TYPE_BADGES[item.contentType] ?? null;
}

/** 内容标题样式 → 内联 style（空对象时返回 undefined，保持主题默认外观） */
function titleStyleOf(style: CmsTitleStyle | undefined): CSSProperties | undefined {
  if (!style) return undefined;
  const css: CSSProperties = {};
  if (style.bold) css.fontWeight = 700;
  if (style.color) css.color = style.color;
  return Object.keys(css).length > 0 ? css : undefined;
}

/** 附件下载区（含标题与体积；无附件时不渲染） */
function AttachmentSection({ items }: { items: CmsContentAttachment[] }) {
  if (!items || items.length === 0) return null;
  return (
    <section className="attachments">
      <h2>附件下载</h2>
      <ul>
        {items.map((a) => (
          <li key={`${a.url}-${a.sort}`}>
            <a href={a.url} download target="_blank" rel="noopener">
              {a.ext ? <span className="ext">{a.ext.toUpperCase()}</span> : null}
              <span className="name">{a.name}</span>
            </a>
            {a.size > 0 ? <span className="size">{formatBytes(a.size)}</span> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 附件体积展示（KB/MB 保留一位小数） */
function ContentItemRow({ item }: { item: CmsContentItem }) {
  const cover = item.coverThumb ?? item.coverImage;
  const badge = typeBadgeText(item);
  return (
    <div className="content-item">
      {cover ? <img className="thumb" src={cover} alt={item.title} loading="lazy" /> : null}
      <div>
        <h3>
          {item.isTop ? <span className="badge">置顶</span> : null}
          {item.isHot ? <span className="badge hot">热门</span> : null}
          {badge ? <span className="badge type">{badge}</span> : null}
          <a
            href={item.url}
            style={titleStyleOf(item.titleStyle)}
            {...externalLinkProps(item.isExternal)}
          >
            {item.title}{item.isExternal ? ' ↗' : ''}
          </a>
        </h3>
        {item.summary ? <div className="summary">{item.summary}</div> : null}
        <div className="meta">
          {item.author ? <span>{item.author}</span> : null}
          {item.source ? <span>来源：{item.source}</span> : null}
          {item.publishedAt ? <time>{item.publishedAt}</time> : null}
          <span>{item.viewCount} 阅读</span>
        </div>
      </div>
    </div>
  );
}


/** 广告位：图片广告渲染图片，无图广告渲染文字条；点击经由计数中转 302 跳转 */
function AdSlot({ ctx, code }: { ctx: CmsBaseContext; code: string }) {
  const ads = ctx.ads[code];
  if (!ads || ads.length === 0) return null;
  const pagePath = resolveCmsRenderedPagePath({
    baseUrl: ctx.baseUrl,
    canonical: ctx.seo.canonical,
  });
  return (
    <div className="ad-slot">
      {ads.map((ad) => (
        <a
          key={ad.id}
          href="#"
          target={ad.linkUrl ? '_blank' : '_self'}
          rel="noopener nofollow"
          aria-label={ad.name}
          data-ad-id={ad.id}
          data-ad-clickable={ad.linkUrl ? 'true' : 'false'}
          data-ad-render-proof={signCmsAdRenderProof({
            version: 1,
            siteId: ctx.site.id,
            siteCode: ctx.site.code,
            adIds: [ad.id],
            path: pagePath,
          })}
        >
          {ad.image ? <img src={ad.image} alt={ad.name} loading="lazy" /> : <div className="ad-text">{ad.name}</div>}
        </a>
      ))}
    </div>
  );
}

/**
 * 评论区会员增强、回复定位与验证码加载均由岛脚本承担（islands/comments.ts、islands/captcha.ts），
 * 服务端只输出容器与 data 契约：section.comments[data-island=comments]、form#comment-form[data-member-api]。
 * 游客保持原生 form POST 零依赖；会员通道由岛在有 token 时改走 JSON 接口。
 */

/** 验证码行（站点开启时渲染；SVG 由 captcha 岛注入，点击刷新） */
function CommentCaptchaBox({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <div className="cms-captcha-box" style={{ display: 'flex', alignItems: 'center', gap: 8 }} data-island="captcha">
      <input type="hidden" name="captchaId" value="" />
      <label style={{ flex: 1 }}>验证码 <span className="req">*</span><input type="text" name="captchaAnswer" required autoComplete="off" placeholder="计算结果" /></label>
      <span className="cms-captcha-img" style={{ cursor: 'pointer', lineHeight: 0 }} />
    </div>
  );
}

/**
 * 互动问卷 / 投票由岛脚本 islands/survey 按 data-island="survey" 挂载：容器契约 data-site / data-site-id /
 * data-code / data-member-submit-api；正文里的 [互动:code] 标记由 applyInteractionMarkers 输出同一契约。
 */

/** 评论区：树形两级（顶级+回复）+ 点赞/回复 + 原生 form POST 提交（含蜜罐字段）；登录会员自动切会员通道 */
function CommentsBlock({ comments, form }: { comments: CmsCommentItem[]; form: CmsCommentFormConfig }) {
  const topLevel = comments.filter((cm) => cm.parentId === 0);
  const repliesOf = (id: number) => comments.filter((cm) => cm.parentId === id);
  const likeAction = (id: number) => `/api/public/cms/comments/${id}/like`;
  const renderItem = (cm: CmsCommentItem, isReply: boolean) => (
    <div className={isReply ? 'comment-item comment-reply' : 'comment-item'} key={cm.id} style={isReply ? { marginLeft: 24 } : undefined}>
      <div className="meta">
        <b>{cm.nickname}</b>
        {cm.isMember ? <span className="member-badge">会员</span> : null}
        <time>{cm.createdAt}</time>
      </div>
      <p>{cm.content}</p>
      <div className="comment-actions">
        <form method="post" action={likeAction(cm.id)} style={{ display: 'inline' }}>
          <input type="hidden" name="returnUrl" value={form.returnUrl} />
          <button type="submit" className="comment-like">赞 {cm.likeCount > 0 ? `(${cm.likeCount})` : ''}</button>
        </form>
        {!isReply ? (
          <button type="button" className="comment-reply-btn" data-comment-id={cm.id} data-nickname={cm.nickname}>回复</button>
        ) : null}
      </div>
      {!isReply ? repliesOf(cm.id).map((r) => renderItem(r, true)) : null}
    </div>
  );
  return (
    <section className="comments" data-island="comments">
      <h2>评论（{comments.length}）</h2>
      {topLevel.map((cm) => renderItem(cm, false))}
      <form className="front-form" id="comment-form" method="post" action={form.action} data-member-api={form.memberSubmitApi}>
        <input type="hidden" name="contentId" value={form.contentId} />
        <input type="hidden" name="returnUrl" value={form.returnUrl} />
        <input type="hidden" name="parentId" id="comment-parent-id" value="0" />
        <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <div id="reply-hint" style={{ display: 'none', fontSize: 13, color: '#59636e' }}>
          回复给：<span id="reply-target" /> <button type="button" id="cancel-reply">取消回复</button>
        </div>
        <label id="comment-nick-row">昵称 <span className="req">*</span><input type="text" name="nickname" required maxLength={50} /></label>
        <label>评论内容 <span className="req">*</span><textarea name="content" required maxLength={1000} /></label>
        <CommentCaptchaBox enabled={form.captchaEnabled} />
        <button type="submit">提交评论（审核后显示）</button>
      </form>
    </section>
  );
}

// ─── 首页 ─────────────────────────────────────────────────────────────────────
export function IndexTemplate(ctx: CmsHomeContext) {
  return <IndexBody ctx={ctx} channelBlocks={[]} />;
}

/**
 * 首页模板（Theme API 定义体）：站点主题参数配置了「首页栏目区块」（homeChannels，
 * 逗号分隔栏目标识）时，load() 并发读取各栏目最新内容，主栏渲染为多栏目区块；
 * 未配置时回落「最新发布」时间流。
 */
export const HomeTemplate = defineHomeTemplate({
  load: async ({ cms, site }) => ({ channelBlocks: await loadHomeBlocks(cms, site, { limit: 8, maxChannels: 8 }) }),
  Component: ({ data, ...ctx }) => <IndexBody ctx={ctx} channelBlocks={data.channelBlocks} />,
});

function IndexBody({ ctx, channelBlocks }: { ctx: CmsHomeContext; channelBlocks: CmsThemeContentCollection[] }) {
  const bannerImage = typeof ctx.site.themeConfig.bannerImage === 'string' ? ctx.site.themeConfig.bannerImage : null;
  const bannerLink = typeof ctx.site.themeConfig.bannerLink === 'string' ? ctx.site.themeConfig.bannerLink : null;
  const showHot = ctx.site.themeConfig.showHotSection !== false;
  return (
    <Layout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
      {bannerImage ? (
        <div className="home-banner">
          {bannerLink
            ? <a href={bannerLink} target="_blank" rel="noopener noreferrer"><img src={bannerImage} alt="banner" /></a>
            : <img src={bannerImage} alt="banner" />}
        </div>
      ) : (
        <div className="home-hero">
          <h1>{ctx.site.name}</h1>
          {ctx.site.description ? <p>{ctx.site.description}</p> : null}
        </div>
      )}
      <AdSlot ctx={ctx} code="home-ad" />
      <div className="home-grid">
        <section>
          {channelBlocks.length > 0 ? (
            channelBlocks.map((block) => (
              <section className="home-channel-block" key={block.channel!.code}>
                <h2 className="section-title">
                  <a href={block.channel!.url}>{block.channel!.name}</a>
                </h2>
                <div className="content-list">
                  {block.list.length === 0
                    ? <div className="empty">暂无内容</div>
                    : block.list.map((item) => <ContentItemRow key={item.id} item={item} />)}
                </div>
              </section>
            ))
          ) : (
            <>
              <h2 className="section-title">最新发布</h2>
              <div className="content-list">
                {ctx.latest.length === 0 ? <div className="empty">暂无内容</div> : ctx.latest.map((item) => <ContentItemRow key={item.id} item={item} />)}
              </div>
            </>
          )}
        </section>
        <aside>
          {ctx.homeSidebar ? <div dangerouslySetInnerHTML={{ __html: renderCmsWidgetHtml(ctx.homeSidebar) }} /> : null}
          {ctx.recommended.length > 0 ? (
            <div className="side-card">
              <h2 className="section-title">推荐阅读</h2>
              <ul className="side-list">
                {ctx.recommended.map((item) => (
                  <li key={item.id}><a href={item.url}>{item.title}</a></li>
                ))}
              </ul>
            </div>
          ) : null}
          {showHot && ctx.hot.length > 0 ? (
            <div className="side-card">
              <h2 className="section-title">热门排行</h2>
              <ul className="side-list ranked">
                {ctx.hot.map((item) => (
                  <li key={item.id}><a href={item.url}>{item.title}</a><time>{item.viewCount} 阅读</time></li>
                ))}
              </ul>
            </div>
          ) : null}
        </aside>
      </div>
    </Layout>
  );
}

// ─── 列表页 ───────────────────────────────────────────────────────────────────
export function ListTemplate(ctx: CmsListContext) {
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      <CmsFollowButton
        siteId={ctx.site.id}
        subjectType="channel"
        subjectId={ctx.channel.id}
        label={ctx.channel.name}
      />
      <div className="content-list">
        {ctx.items.length === 0 ? <div className="empty">该栏目暂无内容</div> : ctx.items.map((item) => <ContentItemRow key={item.id} item={item} />)}
      </div>
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

// ─── 详情页 ───────────────────────────────────────────────────────────────────

/** 正文多页分页导航（单页时不渲染） */
function BodyPagination({ p }: { p: CmsDetailContext['content']['bodyPagination'] }) {
  return <PageLinks p={p} container="nav" className="body-pagination" />;
}

/**
 * 会员互动条（点赞/收藏）：交互由 islands/likes.ts 按 data-island 挂载（契约：data-content-id 与子元素 id）。
 * 已登录 fetch 会员 API 并上报浏览历史；未登录点击跳会员端登录。静态页可用。
 */
function InteractionBar({ content }: { content: CmsDetailContext['content'] }) {
  return (
    <div className="interaction-bar" id="interaction-bar" data-island="likes" data-content-id={content.id}>
      <button type="button" id="btn-like" aria-label="点赞">👍 赞 <span id="like-count">{content.likeCount}</span></button>
      <button type="button" id="btn-fav" aria-label="收藏">⭐ 收藏 <span id="fav-count">{content.favoriteCount}</span></button>
      <span className="interaction-hint">登录会员后可点赞收藏，同步至会员中心</span>
    </div>
  );
}

/** 详情正文公共段：标题、元信息（作者 / 关注 / 来源 / 时间 / 阅读）、媒体、模型字段、正文、正文分页、附件 */
function ArticleBody({ ctx }: { ctx: CmsDetailContext }) {
  const { content } = ctx;
  return (
    <>
      <h1 style={titleStyleOf(content.titleStyle)}>{content.title}</h1>
      <div className="meta">
        {content.author ? <span>作者：{content.author}</span> : null}
        {content.author ? (
          <CmsFollowButton siteId={ctx.site.id} subjectType="author" subjectKey={content.author} label={content.author} />
        ) : null}
        {content.source ? <span>来源：{content.source}</span> : null}
        {content.publishedAt ? <time>{content.publishedAt}</time> : null}
        <span>{content.viewCount} 阅读</span>
      </div>
      <MediaBlock content={content} />
      {content.modelFields.length > 0 ? (
        <>
          <ModelFieldTable fields={content.modelFields} />
        </>
      ) : null}
      <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
      <BodyPagination p={content.bodyPagination} />
      <AttachmentSection items={content.attachments} />
    </>
  );
}

export function DetailTemplate(ctx: CmsDetailContext) {
  const { content } = ctx;
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article">
        <ArticleBody ctx={ctx} />
        <TagLinks tags={content.tags} className="tags" wrapName />
        <InteractionBar content={content} />
      </article>
      <ArticleNav prev={content.prev} next={content.next} />
      <RelatedArticles items={ctx.related} heading="h2" />
      <CommentsBlock comments={ctx.comments} form={ctx.commentForm} />
    </Layout>
  );
}

// ─── 单页 ─────────────────────────────────────────────────────────────────────
export function PageTemplate(ctx: CmsPageContext) {
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <SinglePageArticle ctx={ctx} />
      {ctx.form ? (
        <FrontForm
          form={ctx.form}
          radioLabelStyle={{ display: 'inline-flex', flexDirection: 'row', gap: 4, marginRight: 16 }}
          captchaBox={{
            mathBoxStyle: { display: 'flex', alignItems: 'center', gap: 8 },
            mathLabelStyle: { flex: 1 },
            mathInputAutoComplete: 'off',
            mathInputPlaceholder: '计算结果',
            mathImageStyle: { cursor: 'pointer', lineHeight: 0 },
          }}
        />
      ) : null}
    </Layout>
  );
}

// ─── 搜索结果页 ───────────────────────────────────────────────────────────────
export function SearchTemplate(ctx: CmsSearchContext) {
  return (
    <Layout ctx={ctx}>
      <h1 className="page-title">搜索「{ctx.keyword}」</h1>
      <SearchResultList
        ctx={ctx}
        renderItem={(r) => (
          <div className="content-item" key={r.id}>
            <div>
              <h3><SearchResultLink result={r} baseUrl={ctx.baseUrl} /></h3>
              <div className="summary" dangerouslySetInnerHTML={{ __html: r.snippet }} />
              <div className="meta">
                {r.channelName ? <span>{r.channelName}</span> : null}
                {r.publishedAt ? <time>{r.publishedAt}</time> : null}
              </div>
            </div>
          </div>
        )}
      />
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

// ─── 标签聚合页 ───────────────────────────────────────────────────────────────
export function TagTemplate(ctx: CmsTagPageContext) {
  return (
    <Layout ctx={ctx}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">标签：{ctx.tag.name}（{ctx.tag.contentCount}）</h1>
      <div className="content-list">
        {ctx.items.length === 0 ? <div className="empty">该标签下暂无内容</div> : ctx.items.map((item) => <ContentItemRow key={item.id} item={item} />)}
      </div>
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

// ─── 404 ─────────────────────────────────────────────────────────────────────
export function NotFoundTemplate(ctx: CmsNotFoundContext) {
  return (
    <Layout ctx={ctx}>
      <div className="empty">
        <h1 className="page-title">404 页面不存在</h1>
        <p>您访问的页面不存在或已下线。</p>
        <p><a href={`${ctx.baseUrl}/`}>返回首页</a></p>
      </div>
    </Layout>
  );
}

// ─── 可视化搭建页面（P3 Batch6）────────────────────────────────────────────────
export function CustomPageTemplate(ctx: CmsCustomPageContext) {
  return (
    <Layout ctx={ctx}>
      <div dangerouslySetInnerHTML={{ __html: ctx.blocksHtml }} />
    </Layout>
  );
}

// ─── 变体模板（站点默认模板 / 栏目 / 内容可按名称选用；样式自带 scoped <style>）────

/** 卡片列表：封面优先的响应式卡片网格（产品/案例/图集类栏目） */
export function ListCardTemplate(ctx: CmsListContext) {
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <style>{`
.card-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 20px; margin-top: 16px; }
.card-grid .card { border: 1px solid var(--border); border-radius: 10px; overflow: hidden; display: flex; flex-direction: column; }
.card-grid .card .cover { width: 100%; aspect-ratio: 16 / 10; object-fit: cover; display: block; background: var(--border); }
.card-grid .card .card-body { padding: 12px 14px 14px; display: flex; flex-direction: column; gap: 6px; }
.card-grid .card h3 { font-size: 15px; font-weight: 600; line-height: 1.4; }
.card-grid .card .summary { font-size: 13px; color: var(--text-2); display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
.card-grid .card .card-fields { display: flex; gap: 6px; flex-wrap: wrap; }
.card-grid .card .card-fields span { font-size: 12px; color: var(--primary); background: color-mix(in srgb, var(--primary) 10%, transparent); border-radius: 4px; padding: 1px 8px; }
.card-grid .card .meta { font-size: 12px; color: var(--text-2); margin-top: auto; display: flex; gap: 10px; }
@media (max-width: 900px) { .card-grid { grid-template-columns: repeat(2, 1fr); } }
@media (max-width: 560px) { .card-grid { grid-template-columns: 1fr; } }
      `}</style>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      {ctx.items.length === 0 ? <div className="empty">该栏目暂无内容</div> : (
        <div className="card-grid">
          {ctx.items.map((item) => (
            <a className="card" key={item.id} href={item.url}>
              {item.coverImage ? <img className="cover" src={item.coverImage} alt={item.title} loading="lazy" /> : null}
              <div className="card-body">
                <h3 style={titleStyleOf(item.titleStyle)}>
                  {item.isTop ? <span className="badge">置顶</span> : null}
                  {item.title}
                </h3>
                {item.summary ? <div className="summary">{item.summary}</div> : null}
                {item.modelFields.some((f) => f.displayValue) ? (
                  <div className="card-fields">
                    {item.modelFields.filter((f) => f.displayValue).map((f) => (
                      <span key={f.name} title={f.label}>{f.displayValue}</span>
                    ))}
                  </div>
                ) : null}
                <div className="meta">
                  {item.publishedAt ? <time>{item.publishedAt}</time> : null}
                  <span>{item.viewCount} 阅读</span>
                </div>
              </div>
            </a>
          ))}
        </div>
      )}
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

/** 紧凑列表：纯标题 + 日期行，无封面摘要（公告/文件/下载类栏目） */
export function ListCompactTemplate(ctx: CmsListContext) {
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <style>{`
.compact-list { margin-top: 8px; }
.compact-list li { list-style: none; display: flex; justify-content: space-between; align-items: baseline; gap: 16px; padding: 12px 0; border-bottom: 1px dashed var(--border); font-size: 15px; }
.compact-list li a { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.compact-list li time { color: var(--text-2); font-size: 13px; flex-shrink: 0; }
      `}</style>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <h1 className="page-title">{ctx.channel.name}</h1>
      {ctx.items.length === 0 ? <div className="empty">该栏目暂无内容</div> : (
        <ul className="compact-list">
          {ctx.items.map((item) => (
            <li key={item.id}>
              <a href={item.url} style={titleStyleOf(item.titleStyle)}>
                {item.isTop ? <span className="badge">置顶</span> : null}
                {item.title}
              </a>
              <PublishedDate value={item.publishedAt} />
            </li>
          ))}
        </ul>
      )}
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

/** 简洁详情：正文居中窄栏、隐藏评论区与相关阅读（公告/政策/制度类内容） */
export function DetailPlainTemplate(ctx: CmsDetailContext) {
  const { content } = ctx;
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <style>{`
.article-plain { max-width: 760px; margin: 0 auto; }
.article-plain h1 { text-align: center; }
.article-plain .meta { justify-content: center; }
      `}</style>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article article-plain">
        <ArticleBody ctx={ctx} />
      </article>
      <ArticleNav prev={content.prev} next={content.next} />
    </Layout>
  );
}

// ─── 前台统一互动问卷页 ───────────────────────────────────────────────────────
export function InteractionTemplate(ctx: CmsInteractionPageContext) {
  const { interaction } = ctx;
  return (
    <Layout ctx={ctx} currentUrl={`${ctx.baseUrl}/interaction/${interaction.code}/`}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article survey">
        <h1>{interaction.title}</h1>
        {interaction.description ? <p className="survey-desc">{interaction.description}</p> : null}
        {interaction.participantScope === 'member' ? <p className="survey-hint">本互动仅限登录会员参与</p> : null}
        <div className="cms-interaction" data-island="survey" data-site={ctx.site.code} data-site-id={ctx.site.id} data-code={interaction.code} data-member-submit-api={ctx.submit.memberSubmitApi}>
          <noscript>请启用 JavaScript 后参与互动。</noscript>
        </div>
      </article>
    </Layout>
  );
}
