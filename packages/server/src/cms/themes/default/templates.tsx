import { CmsFollowButton, Layout } from './Layout';
import type {
  CmsBaseContext, CmsBreadcrumb, CmsContentItem, CmsHomeContext, CmsListContext,
  CmsDetailContext, CmsPageContext, CmsSearchContext, CmsNotFoundContext, CmsPagination,
  CmsCommentItem, CmsCommentFormConfig, CmsFrontFormConfig, CmsTagPageContext, CmsCustomPageContext,
  CmsInteractionPageContext,
} from '../types';
import { CmsFragmentContent } from '../blocks';
import {
  resolveCmsRenderedPagePath,
  signCmsAdRenderProof,
} from '../../../services/cms/cms-ad-render-proof';

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
  return <CmsFragmentContent fragment={ctx.fragments[code]} className={className} imageAlt={code} />;
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
 * 评论区会员增强：检测 zenith_member_token —— 有 token 时隐藏昵称输入并改走会员 API（JSON POST），
 * 401 自动回退游客表单；游客保持原生 form POST 零依赖。会员通道无需验证码，一并隐藏。
 */
const COMMENT_MEMBER_SCRIPT = `(function(){var f=document.getElementById('comment-form');if(!f)return;var api=f.getAttribute('data-member-api');var t=null;try{t=localStorage.getItem('zenith_member_token')}catch(e){}if(!t||!api)return;var nickRow=document.getElementById('comment-nick-row');if(nickRow){nickRow.style.display='none';var inp=nickRow.querySelector('input');if(inp){inp.required=false;inp.value='会员'}}var capRow=f.querySelector('.cms-captcha-box');if(capRow){capRow.style.display='none';var ci=capRow.querySelector('input[name="captchaAnswer"]');if(ci)ci.required=false}var hint=document.createElement('p');hint.style.cssText='font-size:12px;color:#59636e;margin:0';hint.textContent='已以会员身份登录，评论将使用会员昵称';f.insertBefore(hint,f.firstChild);f.addEventListener('submit',function(e){e.preventDefault();var content=f.querySelector('textarea[name="content"]').value.trim();if(!content)return;var parentId=Number(document.getElementById('comment-parent-id').value)||0;fetch(api,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({content:content,parentId:parentId})}).then(function(r){return r.json()}).then(function(r){if(r&&r.code===0){f.innerHTML='<p class="survey-done">'+(r.message||'评论已提交，审核通过后显示')+'</p>'}else if(r&&r.code===401){t=null;f.removeAttribute('data-member-api');if(nickRow){nickRow.style.display='';var i2=nickRow.querySelector('input');if(i2){i2.required=true;i2.value=''}}if(capRow){capRow.style.display=''}hint.remove();alert('会员登录已过期，请以游客身份提交或重新登录')}else{alert((r&&r.message)||'提交失败，请稍后再试')}}).catch(function(){alert('提交失败，请稍后再试')})});})();`;

/** 图形验证码加载：为页面上所有 .cms-captcha-box 拉取算术题 SVG，点击图片刷新 */
const CAPTCHA_SCRIPT = `(function(){function load(box){fetch('/api/public/cms/captcha').then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0)return;box.querySelector('input[name="captchaId"]').value=r.data.id;var img=box.querySelector('.cms-captcha-img');img.innerHTML=r.data.svg;img.title='看不清？点击刷新'}).catch(function(){})}document.querySelectorAll('.cms-captcha-box').forEach(function(box){load(box);var img=box.querySelector('.cms-captcha-img');if(img)img.addEventListener('click',function(){load(box)})});})();`;

/** 验证码行（站点开启时渲染；SVG 由脚本注入，点击刷新） */
function CaptchaBox({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <div className="cms-captcha-box" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="hidden" name="captchaId" value="" />
      <label style={{ flex: 1 }}>验证码 <span className="req">*</span><input type="text" name="captchaAnswer" required autoComplete="off" placeholder="计算结果" /></label>
      <span className="cms-captcha-img" style={{ cursor: 'pointer', lineHeight: 0 }} />
    </div>
  );
}

function FormCaptcha({ config }: { config: CmsFrontFormConfig['captcha'] }) {
  if (config.provider === 'none') return null;
  if (config.provider === 'math') {
    return <><CaptchaBox enabled /><script dangerouslySetInnerHTML={{ __html: CAPTCHA_SCRIPT }} /></>;
  }
  if (!config.siteKey) return null;
  return (
    <>
      <div className="cf-turnstile" data-sitekey={config.siteKey} />
      <script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer />
    </>
  );
}

/**
 * 统一互动问卷组件：survey/poll 共用状态、提交与结果渲染；会员 token 存在时走会员 API。
 * captchaRequired 由服务端按互动策略与站点配置计算，客户端只渲染公开挑战。
 */
const INTERACTION_SCRIPT = `(function(){
var boxes=document.querySelectorAll('.cms-interaction');if(!boxes.length)return;
var token=null;try{token=localStorage.getItem('zenith_member_token')}catch(e){}
function esc(v){var d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML}
function headers(json){var h=json?{'Content-Type':'application/json'}:{};if(token)h.Authorization='Bearer '+token;return h}
function resultsHtml(data){if(!data)return '<p class="interaction-hint">结果暂不可见</p>';var html='<div class="interaction-results"><p>共 '+data.responseCount+' 人参与</p>';data.questions.forEach(function(q){html+='<section><h4>'+esc(q.label)+'</h4>';if(q.type==='text'){html+='<p class="interaction-hint">文本答案不公开展示</p>'}else{q.options.forEach(function(o){html+='<div class="poll-bar-row"><span class="poll-bar-label">'+esc(o.label)+'</span><span class="poll-bar-track"><span class="poll-bar-fill" style="width:'+o.percent+'%"></span></span><span class="poll-bar-num">'+o.count+' · '+o.percent+'%</span></div>'})}html+='</section>'});return html+'</div>'}
function showResults(box,data){box.innerHTML=resultsHtml(data)}
function loadMathCaptcha(form){var box=form.querySelector('.cms-captcha-box');if(!box)return;fetch('/api/public/cms/captcha').then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0)return;box.querySelector('[name=captchaId]').value=r.data.id;box.querySelector('.cms-captcha-img').innerHTML=r.data.svg}).catch(function(){})}
function loadTurnstile(form,state){var target=form.querySelector('.cms-turnstile');if(!target||!state.captcha.siteKey)return;function render(){if(!window.turnstile||target.dataset.widgetId)return;target.dataset.widgetId=String(window.turnstile.render(target,{sitekey:state.captcha.siteKey}))}if(window.turnstile){render();return}var script=document.querySelector('script[data-cms-turnstile]');if(!script){script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;script.dataset.cmsTurnstile='1';document.head.appendChild(script)}script.addEventListener('load',render,{once:true})}
function resetCaptcha(form,state){if(state.captcha.provider==='math')loadMathCaptcha(form);if(state.captcha.provider==='turnstile'&&window.turnstile){var target=form.querySelector('.cms-turnstile');if(target&&target.dataset.widgetId)window.turnstile.reset(target.dataset.widgetId)}}
function renderForm(box,state){var i=state.interaction;if(i.participantScope==='member'&&!token){box.innerHTML='<p class="interaction-hint">本互动仅限会员参与，<a href="/member.html#/">请先登录</a></p>';return}var html='';if(i.repeatPolicy==='multiple'&&state.resultsVisible&&state.results)html+='<div class="interaction-live-results">'+resultsHtml(state.results)+'</div>';html+='<form class="front-form interaction-form">';i.questions.forEach(function(q,n){html+='<fieldset class="survey-question"><legend>'+(n+1)+'. '+esc(q.label)+(q.required?' <span class="req">*</span>':'')+'</legend>';if(q.type==='text'){html+='<textarea name="q_'+q.id+'" maxlength="2000" '+(q.required?'required':'')+'></textarea>'}else{html+='<div class="survey-options">';q.options.forEach(function(o){html+='<label class="survey-option"><input type="'+(q.type==='multiple'?'checkbox':'radio')+'" name="q_'+q.id+'" value="'+esc(o.value)+'" '+(q.required&&q.type==='single'?'required':'')+'> '+esc(o.label)+'</label>'});html+='</div>'}html+='</fieldset>'});if(state.captcha.provider==='math')html+='<div class="cms-captcha-box"><input type="hidden" name="captchaId"><label>验证码 <input name="captchaAnswer" required autocomplete="off"></label><span class="cms-captcha-img"></span></div>';if(state.captcha.provider==='turnstile')html+='<div class="cms-turnstile"></div>';html+='<button type="submit">提交</button></form>';box.innerHTML=html;var f=box.querySelector('form');if(state.captcha.provider==='math')loadMathCaptcha(f);if(state.captcha.provider==='turnstile')loadTurnstile(f,state);
f.addEventListener('submit',function(e){e.preventDefault();var answers={};f.querySelectorAll('[name^=q_]').forEach(function(el){var k=el.name.slice(2);if(el.type==='checkbox'){if(el.checked)(answers[k]||(answers[k]=[])).push(el.value)}else if(el.type==='radio'){if(el.checked)answers[k]=el.value}else if(el.value)answers[k]=el.value});var payload={answers:answers,idempotencyKey:(Date.now().toString(36)+Math.random().toString(36).slice(2))};var ci=f.querySelector('[name=captchaId]'),ca=f.querySelector('[name=captchaAnswer]'),ct=f.querySelector('[name="cf-turnstile-response"]');if(ci)payload.captchaId=ci.value;if(ca)payload.captchaAnswer=ca.value;if(ct)payload.turnstileToken=ct.value;var url=token?'/api/member/cms/interactions/'+i.id+'/submit':'/api/public/cms/interactions/'+box.dataset.site+'/'+box.dataset.code+'/submit';fetch(url,{method:'POST',headers:headers(true),body:JSON.stringify(payload)}).then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0){alert(r&&r.message||'提交失败');resetCaptcha(f,state);return}if(i.repeatPolicy==='multiple'){var old=box.querySelector('.survey-done');if(old)old.remove();f.insertAdjacentHTML('beforebegin','<p class="survey-done">'+esc(r.message||'提交成功，可继续参与')+'</p>');var live=box.querySelector('.interaction-live-results');if(r.data&&r.data.results){if(live)live.outerHTML='<div class="interaction-live-results">'+resultsHtml(r.data.results)+'</div>';else box.insertAdjacentHTML('afterbegin','<div class="interaction-live-results">'+resultsHtml(r.data.results)+'</div>')}f.reset();resetCaptcha(f,state);return}if(r.data&&r.data.results)showResults(box,r.data.results);else box.innerHTML='<p class="survey-done">'+esc(r.message||'提交成功')+'</p>'}).catch(function(){alert('提交失败，请稍后再试');resetCaptcha(f,state)})})}
boxes.forEach(function(box){fetch('/api/public/cms/interactions/'+box.dataset.site+'/'+box.dataset.code,{headers:headers(false)}).then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0){box.style.display='none';return}var s=r.data;if(!s.open){showResults(box,s.results);return}if(s.resultsVisible&&s.submitted&&s.interaction.repeatPolicy!=='multiple'){showResults(box,s.results);return}renderForm(box,s)}).catch(function(){box.style.display='none'})});
})();`;

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
    <section className="comments">
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
        <CaptchaBox enabled={form.captchaEnabled} />
        <button type="submit">提交评论（审核后显示）</button>
      </form>
      <script
        dangerouslySetInnerHTML={{
          __html: 'document.querySelectorAll(".comment-reply-btn").forEach(function(b){b.addEventListener("click",function(){document.getElementById("comment-parent-id").value=b.dataset.commentId;document.getElementById("reply-target").textContent=b.dataset.nickname;document.getElementById("reply-hint").style.display="block";document.getElementById("comment-form").scrollIntoView({behavior:"smooth"});});});var c=document.getElementById("cancel-reply");if(c){c.addEventListener("click",function(){document.getElementById("comment-parent-id").value="0";document.getElementById("reply-hint").style.display="none";});}' + COMMENT_MEMBER_SCRIPT + (form.captchaEnabled ? CAPTCHA_SCRIPT : ''),
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
            <textarea name={f.name} required={f.required} minLength={f.minLength ?? undefined} maxLength={f.maxLength ?? 2000} />
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
          )}
        </label>
      ))}
      <FormCaptcha config={form.captcha} />
      <button type="submit">提交</button>
    </form>
  );
}

// ─── 首页 ─────────────────────────────────────────────────────────────────────
export function IndexTemplate(ctx: CmsHomeContext) {
  const bannerImage = typeof ctx.site.themeConfig.bannerImage === 'string' ? ctx.site.themeConfig.bannerImage : null;
  const bannerLink = typeof ctx.site.themeConfig.bannerLink === 'string' ? ctx.site.themeConfig.bannerLink : null;
  const showHot = ctx.site.themeConfig.showHotSection !== false;
  return (
    <Layout ctx={ctx} currentUrl={`${ctx.baseUrl}/`}>
      {bannerImage ? (
        <div className="fragment-banner">
          {bannerLink
            ? <a href={bannerLink} target="_blank" rel="noopener noreferrer"><img src={bannerImage} alt="banner" /></a>
            : <img src={bannerImage} alt="banner" />}
        </div>
      ) : null}
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
          {showHot && ctx.hot.length > 0 ? (
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

/**
 * 会员互动条（点赞/收藏）：内联 JS 读取会员 token（zenith_member_token），
 * 已登录 fetch 会员 API 并上报浏览历史；未登录点击跳会员端登录。静态页可用。
 */
const CONTENT_INTERACTION_SCRIPT = `(function(){var bar=document.getElementById('interaction-bar');if(!bar)return;var id=bar.getAttribute('data-content-id');var t=null;try{t=localStorage.getItem('zenith_member_token')}catch(e){}function hdr(){var h={'Content-Type':'application/json'};if(t)h.Authorization='Bearer '+t;return h}function api(m,p){return fetch('/api/member/cms/contents/'+id+p,{method:m,headers:hdr()}).then(function(r){return r.json()})}function paint(s){var lb=document.getElementById('btn-like'),fb=document.getElementById('btn-fav');if(!s||!lb||!fb)return;lb.classList.toggle('active',!!s.liked);fb.classList.toggle('active',!!s.favorited);document.getElementById('like-count').textContent=s.likeCount;document.getElementById('fav-count').textContent=s.favoriteCount;lb.dataset.on=s.liked?'1':'';fb.dataset.on=s.favorited?'1':''}if(t){api('GET','/interaction-state').then(function(r){if(r&&r.code===0)paint(r.data)}).catch(function(){});api('POST','/view').catch(function(){})}bar.addEventListener('click',function(e){var b=e.target.closest('button');if(!b)return;if(!t){location.href='/member.html#/';return}var isLike=b.id==='btn-like';var on=b.dataset.on==='1';api(on?'DELETE':'POST',isLike?'/like':'/favorite').then(function(r){if(r&&r.code===0)paint(r.data);else if(r&&r.code===401){location.href='/member.html#/'}}).catch(function(){})});})();`;

function InteractionBar({ content }: { content: CmsDetailContext['content'] }) {
  return (
    <>
      <div className="interaction-bar" id="interaction-bar" data-content-id={content.id}>
        <button type="button" id="btn-like" aria-label="点赞">👍 赞 <span id="like-count">{content.likeCount}</span></button>
        <button type="button" id="btn-fav" aria-label="收藏">⭐ 收藏 <span id="fav-count">{content.favoriteCount}</span></button>
        <span className="interaction-hint">登录会员后可点赞收藏，同步至会员中心</span>
      </div>
      <script dangerouslySetInnerHTML={{ __html: CONTENT_INTERACTION_SCRIPT }} />
    </>
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
          {content.author ? (
            <CmsFollowButton siteId={ctx.site.id} subjectType="author" subjectKey={content.author} label={content.author} />
          ) : null}
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
        <InteractionBar content={content} />
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
      <script dangerouslySetInnerHTML={{ __html: INTERACTION_SCRIPT }} />
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
          {content.author ? (
            <CmsFollowButton siteId={ctx.site.id} subjectType="author" subjectKey={content.author} label={content.author} />
          ) : null}
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
        <div className="cms-interaction" data-site={ctx.site.code} data-code={interaction.code}>
          <noscript>请启用 JavaScript 后参与互动。</noscript>
        </div>
      </article>
      <script dangerouslySetInnerHTML={{ __html: INTERACTION_SCRIPT }} />
    </Layout>
  );
}
