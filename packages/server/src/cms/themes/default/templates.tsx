import { Layout } from './Layout';
import type {
  CmsBaseContext, CmsBreadcrumb, CmsContentItem, CmsHomeContext, CmsListContext,
  CmsDetailContext, CmsPageContext, CmsSearchContext, CmsNotFoundContext, CmsPagination,
  CmsCommentItem, CmsCommentFormConfig, CmsFrontFormConfig, CmsTagPageContext, CmsCustomPageContext,
} from '../types';

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

const TYPE_BADGES: Record<string, string | null> = { article: null, album: '图集', media: '视频', link: '外链' };

function typeBadgeText(item: CmsContentItem): string | null {
  if (item.contentType === 'media') return item.mediaType === 'audio' ? '音频' : '视频';
  if (item.contentType === 'album') return item.imageCount > 1 ? `图集·${item.imageCount}` : '图集';
  return TYPE_BADGES[item.contentType] ?? null;
}

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
            {...(item.isExternal ? { target: '_blank', rel: 'noopener nofollow' } : {})}
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

function HtmlFragment({ ctx, code, className }: { ctx: CmsBaseContext; code: string; className?: string }) {
  const fragment = ctx.fragments[code];
  if (!fragment?.content) return null;
  if (fragment.type === 'image') {
    return <div className={className}><img src={fragment.content} alt={code} /></div>;
  }
  if (fragment.type === 'text') {
    return <div className={className}>{fragment.content}</div>;
  }
  return <div className={className} dangerouslySetInnerHTML={{ __html: fragment.content }} />;
}

/** 广告位：图片广告渲染图片，无图广告渲染文字条；点击经由计数中转 302 跳转 */
function AdSlot({ ctx, code }: { ctx: CmsBaseContext; code: string }) {
  const ads = ctx.ads[code];
  if (!ads || ads.length === 0) return null;
  return (
    <div className="ad-slot">
      {ads.map((ad) => (
        <a
          key={ad.id}
          href={ad.linkUrl ? `/api/public/cms/ads/${ad.id}/click` : '#'}
          target={ad.linkUrl ? '_blank' : '_self'}
          rel="noopener nofollow"
          aria-label={ad.name}
        >
          {ad.image ? <img src={ad.image} alt={ad.name} loading="lazy" /> : <div className="ad-text">{ad.name}</div>}
        </a>
      ))}
    </div>
  );
}

/** 评论区：树形两级（顶级+回复）+ 点赞/回复 + 原生 form POST 提交（含蜜罐字段） */
function CommentsBlock({ comments, form }: { comments: CmsCommentItem[]; form: CmsCommentFormConfig }) {
  const topLevel = comments.filter((cm) => cm.parentId === 0);
  const repliesOf = (id: number) => comments.filter((cm) => cm.parentId === id);
  const likeAction = (id: number) => `/api/public/cms/comments/${id}/like`;
  const renderItem = (cm: CmsCommentItem, isReply: boolean) => (
    <div className={isReply ? 'comment-item comment-reply' : 'comment-item'} key={cm.id} style={isReply ? { marginLeft: 24 } : undefined}>
      <div className="meta">
        <b>{cm.nickname}</b>
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
    <section className="comments">
      <h2>评论（{comments.length}）</h2>
      {topLevel.map((cm) => renderItem(cm, false))}
      <form className="front-form" id="comment-form" method="post" action={form.action}>
        <input type="hidden" name="contentId" value={form.contentId} />
        <input type="hidden" name="returnUrl" value={form.returnUrl} />
        <input type="hidden" name="parentId" id="comment-parent-id" value="0" />
        <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <div id="reply-hint" style={{ display: 'none', fontSize: 13, color: '#59636e' }}>
          回复给：<span id="reply-target" /> <button type="button" id="cancel-reply">取消回复</button>
        </div>
        <label>昵称 <span className="req">*</span><input type="text" name="nickname" required maxLength={50} /></label>
        <label>评论内容 <span className="req">*</span><textarea name="content" required maxLength={1000} /></label>
        <button type="submit">提交评论（审核后显示）</button>
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: 'document.querySelectorAll(".comment-reply-btn").forEach(function(b){b.addEventListener("click",function(){document.getElementById("comment-parent-id").value=b.dataset.commentId;document.getElementById("reply-target").textContent=b.dataset.nickname;document.getElementById("reply-hint").style.display="block";document.getElementById("comment-form").scrollIntoView({behavior:"smooth"});});});var c=document.getElementById("cancel-reply");if(c){c.addEventListener("click",function(){document.getElementById("comment-parent-id").value="0";document.getElementById("reply-hint").style.display="none";});}',
        }}
      />
    </section>
  );
}

/** 自定义表单（栏目绑定，原生 form POST） */
function FrontForm({ form }: { form: CmsFrontFormConfig }) {
  return (
    <form className="front-form" method="post" action={form.action}>
      <h2>{form.name}</h2>
      <input type="hidden" name="returnUrl" value={form.returnUrl} />
      <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
      {form.fields.map((f) => (
        <label key={f.name}>
          {f.label} {f.required ? <span className="req">*</span> : null}
          {f.fieldType === 'textarea' ? (
            <textarea name={f.name} required={f.required} maxLength={2000} />
          ) : f.fieldType === 'select' ? (
            <select name={f.name} required={f.required} defaultValue="">
              <option value="" disabled>请选择</option>
              {(f.options ?? []).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          ) : f.fieldType === 'radio' ? (
            <span>
              {(f.options ?? []).map((o) => (
                <label key={o.value} style={{ display: 'inline-flex', flexDirection: 'row', gap: 4, marginRight: 16 }}>
                  <input type="radio" name={f.name} value={o.value} required={f.required} /> {o.label}
                </label>
              ))}
            </span>
          ) : (
            <input type="text" name={f.name} required={f.required} maxLength={200} />
          )}
        </label>
      ))}
      <button type="submit">提交</button>
    </form>
  );
}

// ─── 首页 ─────────────────────────────────────────────────────────────────────
export function IndexTemplate(ctx: CmsHomeContext) {
  return (
    <Layout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
      <HtmlFragment ctx={ctx} code="home-banner" className="fragment-banner" />
      <AdSlot ctx={ctx} code="home-ad" />
      <div className="home-grid">
        <section>
          <h2 className="section-title">最新发布</h2>
          <div className="content-list">
            {ctx.latest.length === 0 ? <div className="empty">暂无内容</div> : ctx.latest.map((item) => <ContentItemRow key={item.id} item={item} />)}
          </div>
        </section>
        <aside>
          {ctx.recommended.length > 0 ? (
            <>
              <h2 className="section-title">推荐阅读</h2>
              <ul className="side-list">
                {ctx.recommended.map((item) => (
                  <li key={item.id}><a href={item.url}>{item.title}</a></li>
                ))}
              </ul>
            </>
          ) : null}
          {ctx.hot.length > 0 ? (
            <>
              <h2 className="section-title">热门排行</h2>
              <ul className="side-list">
                {ctx.hot.map((item) => (
                  <li key={item.id}><a href={item.url}>{item.title}</a><time>{item.viewCount} 阅读</time></li>
                ))}
              </ul>
            </>
          ) : null}
          <HtmlFragment ctx={ctx} code="home-side" />
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
      <div className="content-list">
        {ctx.items.length === 0 ? <div className="empty">该栏目暂无内容</div> : ctx.items.map((item) => <ContentItemRow key={item.id} item={item} />)}
      </div>
      <Pagination p={ctx.pagination} />
    </Layout>
  );
}

// ─── 详情页 ───────────────────────────────────────────────────────────────────
/** 形态区块：图集九宫格 / 音视频播放器（article/link 返回 null） */
function MediaBlock({ content }: { content: CmsDetailContext['content'] }) {
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

/** 正文多页分页导航（单页时不渲染） */
function BodyPagination({ p }: { p: CmsDetailContext['content']['bodyPagination'] }) {
  if (!p || p.totalPages <= 1) return null;
  return (
    <nav className="body-pagination">
      {p.prevUrl ? <a href={p.prevUrl}>上一页</a> : null}
      {p.pages.map((pg) => (
        pg.current
          ? <span key={pg.page} className="current">{pg.page}</span>
          : <a key={pg.page} href={pg.url}>{pg.page}</a>
      ))}
      {p.nextUrl ? <a href={p.nextUrl}>下一页</a> : null}
    </nav>
  );
}

export function DetailTemplate(ctx: CmsDetailContext) {
  const { content } = ctx;
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article">
        <h1>{content.title}</h1>
        <div className="meta">
          {content.author ? <span>作者：{content.author}</span> : null}
          {content.source ? <span>来源：{content.source}</span> : null}
          {content.publishedAt ? <time>{content.publishedAt}</time> : null}
          <span>{content.viewCount} 阅读</span>
        </div>
        <MediaBlock content={content} />
        <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
        <BodyPagination p={content.bodyPagination} />
        {content.tags.length > 0 ? (
          <div className="tags">
            {content.tags.map((t) => <a key={t.slug} href={t.url}><span>{t.name}</span></a>)}
          </div>
        ) : null}
      </article>
      {(content.prev || content.next) ? (
        <nav className="article-nav">
          {content.prev ? <span>上一篇：<a href={content.prev.url}>{content.prev.title}</a></span> : null}
          {content.next ? <span>下一篇：<a href={content.next.url}>{content.next.title}</a></span> : null}
        </nav>
      ) : null}
      {ctx.related.length > 0 ? (
        <section className="related-articles">
          <h2>相关阅读</h2>
          <ul>
            {ctx.related.map((r) => <li key={r.url}><a href={r.url}>{r.title}</a></li>)}
          </ul>
        </section>
      ) : null}
      <CommentsBlock comments={ctx.comments} form={ctx.commentForm} />
    </Layout>
  );
}

// ─── 单页 ─────────────────────────────────────────────────────────────────────
export function PageTemplate(ctx: CmsPageContext) {
  return (
    <Layout ctx={ctx} currentUrl={ctx.channel.url}>
      <Breadcrumbs items={ctx.breadcrumbs} />
      <article className="article">
        <h1>{ctx.channel.name}</h1>
        <div className="body" dangerouslySetInnerHTML={{ __html: ctx.contentHtml }} />
      </article>
      {ctx.form ? <FrontForm form={ctx.form} /> : null}
    </Layout>
  );
}

// ─── 搜索结果页 ───────────────────────────────────────────────────────────────
export function SearchTemplate(ctx: CmsSearchContext) {
  return (
    <Layout ctx={ctx}>
      <h1 className="page-title">搜索「{ctx.keyword}」</h1>
      <div className="content-list search-result">
        {ctx.results.length === 0 ? (
          <div className="empty">未找到相关内容</div>
        ) : ctx.results.map((r) => (
          <div className="content-item" key={r.id}>
            <div>
              <h3><a href={`${ctx.baseUrl}${r.url}`} dangerouslySetInnerHTML={{ __html: r.titleHighlight }} /></h3>
              <div className="summary" dangerouslySetInnerHTML={{ __html: r.snippet }} />
              <div className="meta">
                {r.channelName ? <span>{r.channelName}</span> : null}
                {r.publishedAt ? <time>{r.publishedAt}</time> : null}
              </div>
            </div>
          </div>
        ))}
      </div>
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
                <h3>
                  {item.isTop ? <span className="badge">置顶</span> : null}
                  {item.title}
                </h3>
                {item.summary ? <div className="summary">{item.summary}</div> : null}
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
              <a href={item.url}>
                {item.isTop ? <span className="badge">置顶</span> : null}
                {item.title}
              </a>
              {item.publishedAt ? <time>{item.publishedAt.slice(0, 10)}</time> : null}
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
        <h1>{content.title}</h1>
        <div className="meta">
          {content.author ? <span>作者：{content.author}</span> : null}
          {content.source ? <span>来源：{content.source}</span> : null}
          {content.publishedAt ? <time>{content.publishedAt}</time> : null}
          <span>{content.viewCount} 阅读</span>
        </div>
        <MediaBlock content={content} />
        <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
        <BodyPagination p={content.bodyPagination} />
      </article>
      {(content.prev || content.next) ? (
        <nav className="article-nav">
          {content.prev ? <span>上一篇：<a href={content.prev.url}>{content.prev.title}</a></span> : null}
          {content.next ? <span>下一篇：<a href={content.next.url}>{content.next.title}</a></span> : null}
        </nav>
      ) : null}
    </Layout>
  );
}
