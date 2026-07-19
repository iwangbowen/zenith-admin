import { Layout } from './Layout';
import type {
  CmsBaseContext, CmsBreadcrumb, CmsContentItem, CmsHomeContext, CmsListContext,
  CmsDetailContext, CmsPageContext, CmsSearchContext, CmsNotFoundContext, CmsPagination,
  CmsCommentItem, CmsCommentFormConfig, CmsFrontFormConfig, CmsTagPageContext,
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

function ContentItemRow({ item }: { item: CmsContentItem }) {
  return (
    <div className="content-item">
      {item.coverImage ? <img className="thumb" src={item.coverImage} alt={item.title} loading="lazy" /> : null}
      <div>
        <h3>
          {item.isTop ? <span className="badge">置顶</span> : null}
          {item.isHot ? <span className="badge hot">热门</span> : null}
          <a href={item.url}>{item.title}</a>
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

/** 广告位：图片广告渲染图片，无图广告渲染文字条 */
function AdSlot({ ctx, code }: { ctx: CmsBaseContext; code: string }) {
  const ads = ctx.ads[code];
  if (!ads || ads.length === 0) return null;
  return (
    <div className="ad-slot">
      {ads.map((ad) => (
        <a key={ad.name} href={ad.linkUrl ?? '#'} target={ad.linkUrl?.startsWith('http') ? '_blank' : '_self'} rel="noopener nofollow" aria-label={ad.name}>
          {ad.image ? <img src={ad.image} alt={ad.name} loading="lazy" /> : <div className="ad-text">{ad.name}</div>}
        </a>
      ))}
    </div>
  );
}

/** 评论区：已审核评论列表 + 原生 form POST 提交（含蜜罐字段，静态页零 JS 可用） */
function CommentsBlock({ comments, form }: { comments: CmsCommentItem[]; form: CmsCommentFormConfig }) {
  return (
    <section className="comments">
      <h2>评论（{comments.length}）</h2>
      {comments.map((cm, i) => (
        <div className="comment-item" key={`${cm.nickname}-${i}`}>
          <div className="meta"><b>{cm.nickname}</b><time>{cm.createdAt}</time></div>
          <p>{cm.content}</p>
        </div>
      ))}
      <form className="front-form" method="post" action={form.action}>
        <input type="hidden" name="contentId" value={form.contentId} />
        <input type="hidden" name="returnUrl" value={form.returnUrl} />
        <input className="hp" type="text" name="website" tabIndex={-1} autoComplete="off" aria-hidden="true" />
        <label>昵称 <span className="req">*</span><input type="text" name="nickname" required maxLength={50} /></label>
        <label>评论内容 <span className="req">*</span><textarea name="content" required maxLength={1000} /></label>
        <button type="submit">提交评论（审核后显示）</button>
      </form>
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
        <div className="body" dangerouslySetInnerHTML={{ __html: content.body }} />
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
