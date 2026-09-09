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
import { ArticleNav, Breadcrumbs, CAPTCHA_SCRIPT, FrontForm, MediaBlock, ModelFieldTable, PageLinks, Pagination, RelatedArticles, PublishedDate, SinglePageArticle, TagLinks, externalLinkProps, loadHomeBlocks, SearchResultLink, SearchResultList } from '../_shared';
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
 * 评论区会员增强：检测 zenith_member_token —— 有 token 时隐藏昵称输入并改走会员 API（JSON POST），
 * 401 自动回退游客表单；游客保持原生 form POST 零依赖。会员通道无需验证码，一并隐藏。
 */
const COMMENT_MEMBER_SCRIPT = `(function(){var f=document.getElementById('comment-form');if(!f)return;var api=f.getAttribute('data-member-api');var t=null;try{t=localStorage.getItem('zenith_member_token')}catch(e){}if(!t||!api)return;var nickRow=document.getElementById('comment-nick-row');if(nickRow){nickRow.style.display='none';var inp=nickRow.querySelector('input');if(inp){inp.required=false;inp.value='会员'}}var capRow=f.querySelector('.cms-captcha-box');if(capRow){capRow.style.display='none';var ci=capRow.querySelector('input[name="captchaAnswer"]');if(ci)ci.required=false}var hint=document.createElement('p');hint.style.cssText='font-size:12px;color:#59636e;margin:0';hint.textContent='已以会员身份登录，评论将使用会员昵称';f.insertBefore(hint,f.firstChild);f.addEventListener('submit',function(e){e.preventDefault();var content=f.querySelector('textarea[name="content"]').value.trim();if(!content)return;var parentId=Number(document.getElementById('comment-parent-id').value)||0;fetch(api,{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+t},body:JSON.stringify({content:content,parentId:parentId})}).then(function(r){return r.json()}).then(function(r){if(r&&r.code===0){f.innerHTML='<p class="survey-done">'+(r.message||'评论已提交，审核通过后显示')+'</p>'}else if(r&&r.code===401){t=null;f.removeAttribute('data-member-api');if(nickRow){nickRow.style.display='';var i2=nickRow.querySelector('input');if(i2){i2.required=true;i2.value=''}}if(capRow){capRow.style.display=''}hint.remove();alert('会员登录已过期，请以游客身份提交或重新登录')}else{alert((r&&r.message)||'提交失败，请稍后再试')}}).catch(function(){alert('提交失败，请稍后再试')})});})();`;

/** 验证码行（站点开启时渲染；SVG 由脚本注入，点击刷新） */
function CommentCaptchaBox({ enabled }: { enabled: boolean }) {
  if (!enabled) return null;
  return (
    <div className="cms-captcha-box" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <input type="hidden" name="captchaId" value="" />
      <label style={{ flex: 1 }}>验证码 <span className="req">*</span><input type="text" name="captchaAnswer" required autoComplete="off" placeholder="计算结果" /></label>
      <span className="cms-captcha-img" style={{ cursor: 'pointer', lineHeight: 0 }} />
    </div>
  );
}

/**
 * 统一互动问卷组件：survey/poll 共用状态、提交与结果渲染；会员 token 存在时走会员 API。
 * captchaRequired 由服务端按互动策略与站点配置计算，客户端只渲染公开挑战。
 */
const INTERACTION_SCRIPT = `(function(){
var boxes=document.querySelectorAll('.cms-interaction');if(!boxes.length)return;
var token=null;try{token=localStorage.getItem('zenith_member_token')}catch(e){}
var OTHER='__other__';var MSEP='::';var DRAFT_PREFIX='zenith:cms-interaction-draft:';
function esc(v){var d=document.createElement('div');d.textContent=String(v==null?'':v);return d.innerHTML.replace(/"/g,'&quot;').replace(/'/g,'&#39;')}
function headers(json){var h=json?{'Content-Type':'application/json'}:{};if(token)h.Authorization='Bearer '+token;return h}
function bars(opts){var h='';(opts||[]).forEach(function(o){h+='<div class="poll-bar-row"><span class="poll-bar-label">'+esc(o.label)+'</span><span class="poll-bar-track"><span class="poll-bar-fill" style="width:'+o.percent+'%"></span></span><span class="poll-bar-num">'+o.count+' \\u00b7 '+o.percent+'%</span></div>'});return h}
function resultsHtml(data){if(!data)return '<p class="interaction-hint">\\u7ed3\\u679c\\u6682\\u4e0d\\u53ef\\u89c1</p>';var html='<div class="interaction-results"><p>\\u5171 '+data.responseCount+' \\u4eba\\u53c2\\u4e0e</p>';data.questions.forEach(function(q){html+='<section><h4>'+esc(q.label)+'</h4>';if(q.type==='text'||q.type==='date'||q.type==='number'){html+='<p class="interaction-hint">\\u8be5\\u9898\\u7b54\\u6848\\u4e0d\\u516c\\u5f00\\u5c55\\u793a</p>'}else{if(q.npsScore!==null&&q.npsScore!==undefined)html+='<p class="interaction-metric">NPS\\uff1a'+q.npsScore+'</p>';else if(q.average!==null&&q.average!==undefined)html+='<p class="interaction-metric">\\u5e73\\u5747\\uff1a'+q.average+'</p>';html+=bars(q.options)}html+='</section>'});return html+'</div>'}
function showResults(box,data){box.innerHTML=resultsHtml(data)}
function loadMathCaptcha(form){var box=form.querySelector('.cms-captcha-box');if(!box)return;fetch('/api/public/cms/captcha').then(function(r){return r.json()}).then(function(r){if(!r||r.code!==0)return;box.querySelector('[name=captchaId]').value=r.data.id;box.querySelector('.cms-captcha-img').innerHTML=r.data.svg}).catch(function(){})}
function loadTurnstile(form,state){var target=form.querySelector('.cms-turnstile');if(!target||!state.captcha.siteKey)return;function render(){if(!window.turnstile||target.dataset.widgetId)return;target.dataset.widgetId=String(window.turnstile.render(target,{sitekey:state.captcha.siteKey}))}if(window.turnstile){render();return}var script=document.querySelector('script[data-cms-turnstile]');if(!script){script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.async=true;script.defer=true;script.dataset.cmsTurnstile='1';document.head.appendChild(script)}script.addEventListener('load',render,{once:true})}
function resetCaptcha(form,state){if(state.captcha.provider==='math')loadMathCaptcha(form);if(state.captcha.provider==='turnstile'&&window.turnstile){var target=form.querySelector('.cms-turnstile');if(target&&target.dataset.widgetId)window.turnstile.reset(target.dataset.widgetId)}}
function scalePoints(q){var min=q.type==='nps'?0:1;var max=q.type==='nps'?10:(q.ratingMax||5);var out=[];for(var i=min;i<=max;i++)out.push(String(i));return out}
function questionHtml(q,n){
var name='q_'+q.id;var req=q.required?' <span class="req">*</span>':'';
var h='<fieldset class="survey-question" data-qid="'+q.id+'" data-type="'+q.type+'" data-page="'+(q.pageNo||1)+'" data-index="'+n+'"';
if(q.visibleWhen)h+=' data-cond="'+esc(JSON.stringify(q.visibleWhen))+'"';
h+='><legend>'+(n+1)+'. '+esc(q.label)+req+'</legend>';
if(q.type==='text'){h+='<textarea name="'+name+'" maxlength="2000"></textarea>'}
else if(q.type==='date'){h+='<input type="date" name="'+name+'">'}
else if(q.type==='number'){h+='<input type="number" step="any" name="'+name+'">'}
else if(q.type==='rating'||q.type==='nps'){h+='<div class="survey-scale">';scalePoints(q).forEach(function(v){h+='<label class="survey-scale-item"><input type="radio" name="'+name+'" value="'+v+'"> '+v+'</label>'});h+='</div>'}
else if(q.type==='matrix'){h+='<div class="survey-matrix-wrap"><table class="survey-matrix"><thead><tr><th></th>';(q.options||[]).forEach(function(o){h+='<th>'+esc(o.label)+'</th>'});h+='</tr></thead><tbody>';(q.matrixRows||[]).forEach(function(r){h+='<tr><th scope="row">'+esc(r.label)+'</th>';(q.options||[]).forEach(function(o){h+='<td><input type="radio" name="'+name+'_'+esc(r.id)+'" value="'+esc(r.id+MSEP+o.value)+'"></td>'});h+='</tr>'});h+='</tbody></table></div>'}
else{var t=q.type==='multiple'?'checkbox':'radio';h+='<div class="survey-options">';(q.options||[]).forEach(function(o){h+='<label class="survey-option"><input type="'+t+'" name="'+name+'" value="'+esc(o.value)+'"> '+esc(o.label)+'</label>'});
if(q.allowOther){h+='<label class="survey-option survey-option-other"><input type="'+t+'" name="'+name+'" value="'+OTHER+'"> '+esc(q.otherLabel||'\\u5176\\u4ed6')+'</label><input class="survey-other-text" type="text" name="'+name+'_other" maxlength="200" placeholder="\\u8bf7\\u586b\\u5199" disabled>'}
h+='</div>';if(q.type==='multiple')h+='<span class="survey-choice-hint">\\u53ef\\u9009 '+q.minChoices+' ~ '+q.maxChoices+' \\u9879</span>'}
return h+'<p class="survey-error" hidden></p></fieldset>'}
function pickedValues(form,qid){var out=[];form.querySelectorAll('[name="q_'+qid+'"]').forEach(function(el){if((el.type==='radio'||el.type==='checkbox')&&el.checked)out.push(el.value)});return out}
function applyConditions(form){form.querySelectorAll('.survey-question[data-cond]').forEach(function(fs){var rule;try{rule=JSON.parse(fs.dataset.cond)}catch(e){return}var src=form.querySelector('.survey-question[data-index="'+rule.questionIndex+'"]');if(!src){fs.dataset.condHidden='';return}var vals=pickedValues(form,src.dataset.qid);var hit=vals.some(function(v){return rule.values.indexOf(v)>=0});var hidden=rule.op==='none'?hit:!hit;fs.dataset.condHidden=hidden?'1':''})}
function pageList(form){var pages=[];form.querySelectorAll('.survey-question').forEach(function(fs){var p=Number(fs.dataset.page||1);if(pages.indexOf(p)<0)pages.push(p)});pages.sort(function(a,b){return a-b});return pages.length?pages:[1]}
function refresh(form,state){
applyConditions(form);
var pages=pageList(form);var index=Math.max(0,Math.min(state.page,pages.length-1));state.page=index;var current=pages[index];
form.querySelectorAll('.survey-question').forEach(function(fs){
var condHidden=!!fs.dataset.condHidden;
// 分页只影响可见性；只有条件未命中的题目才 disabled，保证跨页答案一起提交
fs.hidden=condHidden||Number(fs.dataset.page||1)!==current;fs.disabled=condHidden});
form.querySelectorAll('.survey-option-other input[type=radio],.survey-option-other input[type=checkbox]').forEach(function(el){
var text=el.closest('.survey-options').querySelector('.survey-other-text');if(!text)return;
text.disabled=!el.checked;if(!el.checked)text.value=''});
var pager=form.querySelector('.survey-pager');if(!pager)return;
var last=index===pages.length-1;
pager.querySelector('.survey-progress').textContent=pages.length>1?('\\u7b2c '+(index+1)+' / '+pages.length+' \\u9875'):'';
pager.querySelector('.survey-prev').hidden=index===0;
pager.querySelector('.survey-next').hidden=last;
pager.querySelector('.survey-submit').hidden=!last}
function otherValue(fs,name,v){if(v!==OTHER)return v;var t=fs.querySelector('[name="'+name+'_other"]');var text=t&&t.value?t.value.trim():'';return text?OTHER+':'+text:OTHER}
function collect(form,state){var answers={};state.interaction.questions.forEach(function(q){
var fs=form.querySelector('.survey-question[data-qid="'+q.id+'"]');if(!fs||fs.disabled)return;var name='q_'+q.id;
if(q.type==='matrix'){var picks=[];fs.querySelectorAll('input[type=radio]').forEach(function(el){if(el.checked)picks.push(el.value)});if(picks.length)answers[q.id]=picks;return}
if(q.type==='multiple'){var vals=[];fs.querySelectorAll('input[name="'+name+'"]').forEach(function(el){if(el.checked)vals.push(otherValue(fs,name,el.value))});if(vals.length)answers[q.id]=vals;return}
if(q.type==='single'||q.type==='rating'||q.type==='nps'){var picked=null;fs.querySelectorAll('input[name="'+name+'"]').forEach(function(el){if(el.checked)picked=el.value});if(picked!==null)answers[q.id]=otherValue(fs,name,picked);return}
var el=fs.querySelector('[name="'+name+'"]');if(el&&el.value)answers[q.id]=el.value});return answers}
function setFieldError(fs,msg){var slot=fs.querySelector('.survey-error');if(!slot)return;slot.textContent=msg||'';slot.hidden=!msg;if(msg)fs.classList.add('survey-question-invalid');else fs.classList.remove('survey-question-invalid')}
function setFormError(form,msg){var slot=form.querySelector('.survey-form-error');if(!slot)return;slot.textContent=msg||'';slot.hidden=!msg}
function questionError(q,fs){
var name='q_'+q.id;
if(q.type==='matrix'){var rows=(q.matrixRows||[]).length;var picked=0;fs.querySelectorAll('input[type=radio]').forEach(function(el){if(el.checked)picked++});
if(picked===0)return q.required?'\\u8be5\\u9898\\u4e3a\\u5fc5\\u7b54\\u9898':null;
if(q.required&&picked<rows)return '\\u8bf7\\u4e3a\\u6bcf\\u4e00\\u884c\\u4f5c\\u7b54';return null}
if(q.type==='multiple'){var vals=[];fs.querySelectorAll('input[name="'+name+'"]').forEach(function(el){if(el.checked)vals.push(el.value)});
if(vals.length===0)return q.required?'\\u8be5\\u9898\\u4e3a\\u5fc5\\u7b54\\u9898':null;
var min=q.required?Math.max(1,q.minChoices):q.minChoices;
if(vals.length<min||vals.length>q.maxChoices)return '\\u9700\\u9009\\u62e9 '+min+'-'+q.maxChoices+' \\u9879\\uff0c\\u5f53\\u524d '+vals.length+' \\u9879';
if(vals.indexOf(OTHER)>=0){var t=fs.querySelector('[name="'+name+'_other"]');if(t&&!t.value.trim())return '\\u8bf7\\u586b\\u5199\\u300c\\u5176\\u4ed6\\u300d\\u7684\\u5185\\u5bb9'}return null}
if(q.type==='single'||q.type==='rating'||q.type==='nps'){var picked2=null;fs.querySelectorAll('input[name="'+name+'"]').forEach(function(el){if(el.checked)picked2=el.value});
if(picked2===null)return q.required?'\\u8be5\\u9898\\u4e3a\\u5fc5\\u7b54\\u9898':null;
if(picked2===OTHER){var t2=fs.querySelector('[name="'+name+'_other"]');if(t2&&!t2.value.trim())return '\\u8bf7\\u586b\\u5199\\u300c\\u5176\\u4ed6\\u300d\\u7684\\u5185\\u5bb9'}return null}
var el=fs.querySelector('[name="'+name+'"]');var v=el&&el.value?el.value.trim():'';
if(!v)return q.required?'\\u8be5\\u9898\\u4e3a\\u5fc5\\u7b54\\u9898':null;
if(q.type==='number'&&isNaN(Number(v)))return '\\u8bf7\\u586b\\u5199\\u6570\\u5b57';
return null}
function validate(form,state,onlyCurrentPage){var ok=true;var first=null;var firstPage=null;
var pages=pageList(form);var current=pages[state.page];
state.interaction.questions.forEach(function(q){var fs=form.querySelector('.survey-question[data-qid="'+q.id+'"]');if(!fs)return;
if(fs.disabled){setFieldError(fs,'');return}
if(onlyCurrentPage&&Number(fs.dataset.page||1)!==current)return;
var msg=questionError(q,fs);setFieldError(fs,msg);
if(msg){ok=false;if(!first){first=fs;firstPage=pages.indexOf(Number(fs.dataset.page||1))}}});
// 提交时若出错的题目在别的页，自动翻回该页再高亮，避免用户对着空白页找错
if(!ok&&firstPage!==null&&firstPage>=0&&firstPage!==state.page){state.page=firstPage;refresh(form,state)}
if(first)first.scrollIntoView({block:'center',behavior:'smooth'});
setFormError(form,ok?'':'\\u8bf7\\u5148\\u5b8c\\u5584\\u6807\\u7ea2\\u7684\\u9898\\u76ee');
return ok}
function draftKey(box){return DRAFT_PREFIX+box.dataset.site+':'+box.dataset.code}
function snapshot(form){var data={};form.querySelectorAll('input,textarea').forEach(function(el){
if(!el.name||el.name.indexOf('q_')!==0)return;
if(el.type==='radio'||el.type==='checkbox'){if(el.checked){if(!data[el.name])data[el.name]=[];data[el.name].push(el.value)}}
else if(el.value)data[el.name]=el.value});return data}
function saveDraft(box,form,state){try{localStorage.setItem(draftKey(box),JSON.stringify({page:state.page,fields:snapshot(form)}))}catch(e){}}
function clearDraft(box){try{localStorage.removeItem(draftKey(box))}catch(e){}}
function restoreDraft(box,form,state){
var raw=null;try{raw=localStorage.getItem(draftKey(box))}catch(e){}
if(!raw)return false;var data=null;try{data=JSON.parse(raw)}catch(e){}
if(!data||!data.fields)return false;var applied=false;
Object.keys(data.fields).forEach(function(name){var value=data.fields[name];
var nodes=form.querySelectorAll('[name="'+name+'"]');if(!nodes.length)return;
if(Array.isArray(value)){nodes.forEach(function(el){if(value.indexOf(el.value)>=0){el.checked=true;applied=true}})}
else{var el=nodes[0];if(el.type!=='radio'&&el.type!=='checkbox'){el.value=value;applied=true}}});
if(applied&&typeof data.page==='number')state.page=data.page;
return applied}
function renderForm(box,state){
var i=state.interaction;
if(i.participantScope==='member'&&!token){box.innerHTML='<p class="interaction-hint">\\u672c\\u4e92\\u52a8\\u4ec5\\u9650\\u4f1a\\u5458\\u53c2\\u4e0e\\uff0c<a href="/member.html#/">\\u8bf7\\u5148\\u767b\\u5f55</a></p>';return}
var html='';
if(i.repeatPolicy==='multiple'&&state.resultsVisible&&state.results)html+='<div class="interaction-live-results">'+resultsHtml(state.results)+'</div>';
html+='<form class="front-form interaction-form" novalidate>';
html+='<p class="survey-restored" hidden>\\u5df2\\u6062\\u590d\\u4e0a\\u6b21\\u586b\\u5199\\u7684\\u5185\\u5bb9 <button type="button" class="survey-clear-draft">\\u6e05\\u7a7a\\u91cd\\u586b</button></p>';
i.questions.forEach(function(q,n){html+=questionHtml(q,n)});
if(state.captcha.provider==='math')html+='<div class="cms-captcha-box"><input type="hidden" name="captchaId"><label>\\u9a8c\\u8bc1\\u7801 <input name="captchaAnswer" required autocomplete="off"></label><span class="cms-captcha-img"></span></div>';
if(state.captcha.provider==='turnstile')html+='<div class="cms-turnstile"></div>';
html+='<p class="survey-form-error" hidden></p>';
html+='<div class="survey-pager"><span class="survey-progress"></span><button type="button" class="survey-prev" hidden>\\u4e0a\\u4e00\\u9875</button><button type="button" class="survey-next" hidden>\\u4e0b\\u4e00\\u9875</button><button type="submit" class="survey-submit">\\u63d0\\u4ea4</button></div></form>';
box.innerHTML=html;
var f=box.querySelector('form');state.page=0;
if(state.captcha.provider==='math')loadMathCaptcha(f);
if(state.captcha.provider==='turnstile')loadTurnstile(f,state);
if(restoreDraft(box,f,state))f.querySelector('.survey-restored').hidden=false;
f.querySelector('.survey-clear-draft').addEventListener('click',function(){clearDraft(box);f.reset();state.page=0;f.querySelector('.survey-restored').hidden=true;f.querySelectorAll('.survey-question').forEach(function(fs){setFieldError(fs,'')});setFormError(f,'');refresh(f,state)});
f.addEventListener('change',function(e){refresh(f,state);
var fs=e.target.closest&&e.target.closest('.survey-question');if(fs&&fs.classList.contains('survey-question-invalid'))setFieldError(fs,'');
saveDraft(box,f,state)});
f.addEventListener('input',function(e){if(e.target.classList&&e.target.classList.contains('survey-other-text'))saveDraft(box,f,state)});
f.querySelector('.survey-prev').addEventListener('click',function(){setFormError(f,'');state.page-=1;refresh(f,state);saveDraft(box,f,state);f.scrollIntoView({block:'start'})});
f.querySelector('.survey-next').addEventListener('click',function(){if(!validate(f,state,true))return;state.page+=1;refresh(f,state);saveDraft(box,f,state);f.scrollIntoView({block:'start'})});
refresh(f,state);
f.addEventListener('submit',function(e){e.preventDefault();
if(!validate(f,state,false))return;
var ca0=f.querySelector('[name=captchaAnswer]');
if(ca0&&!ca0.value.trim()){setFormError(f,'\\u8bf7\\u586b\\u5199\\u9a8c\\u8bc1\\u7801');return}
var submitBtn=f.querySelector('.survey-submit');submitBtn.disabled=true;
var payload={answers:collect(f,state),idempotencyKey:(Date.now().toString(36)+Math.random().toString(36).slice(2))};
var ci=f.querySelector('[name=captchaId]'),ca=f.querySelector('[name=captchaAnswer]'),ct=f.querySelector('[name="cf-turnstile-response"]');
if(ci)payload.captchaId=ci.value;if(ca)payload.captchaAnswer=ca.value;if(ct)payload.turnstileToken=ct.value;
var memberUrl=box.dataset.memberSubmitApi;
if(!memberUrl&&box.dataset.siteId)memberUrl='/api/member/cms/interactions/'+i.id+'/submit?siteId='+encodeURIComponent(box.dataset.siteId);
var url=token?(memberUrl||'/api/member/cms/interactions/'+i.id+'/submit'):'/api/public/cms/interactions/'+box.dataset.site+'/'+box.dataset.code+'/submit';
fetch(url,{method:'POST',headers:headers(true),body:JSON.stringify(payload)}).then(function(r){return r.json()}).then(function(r){
submitBtn.disabled=false;
if(!r||r.code!==0){setFormError(f,(r&&r.message)||'\\u63d0\\u4ea4\\u5931\\u8d25');resetCaptcha(f,state);return}
clearDraft(box);
if(i.repeatPolicy==='multiple'){var old=box.querySelector('.survey-done');if(old)old.remove();
f.insertAdjacentHTML('beforebegin','<p class="survey-done">'+esc(r.message||'\\u63d0\\u4ea4\\u6210\\u529f\\uff0c\\u53ef\\u7ee7\\u7eed\\u53c2\\u4e0e')+'</p>');
var live=box.querySelector('.interaction-live-results');
if(r.data&&r.data.results){if(live)live.outerHTML='<div class="interaction-live-results">'+resultsHtml(r.data.results)+'</div>';else box.insertAdjacentHTML('afterbegin','<div class="interaction-live-results">'+resultsHtml(r.data.results)+'</div>')}
f.reset();state.page=0;setFormError(f,'');f.querySelector('.survey-restored').hidden=true;refresh(f,state);resetCaptcha(f,state);return}
if(r.data&&r.data.results)showResults(box,r.data.results);else box.innerHTML='<p class="survey-done">'+esc(r.message||'\\u63d0\\u4ea4\\u6210\\u529f')+'</p>'}).catch(function(){submitBtn.disabled=false;setFormError(f,'\\u63d0\\u4ea4\\u5931\\u8d25\\uff0c\\u8bf7\\u7a0d\\u540e\\u518d\\u8bd5');resetCaptcha(f,state)})})}
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
        <CommentCaptchaBox enabled={form.captchaEnabled} />
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
      <script dangerouslySetInnerHTML={{ __html: INTERACTION_SCRIPT }} />
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
        <div className="cms-interaction" data-site={ctx.site.code} data-site-id={ctx.site.id} data-code={interaction.code} data-member-submit-api={ctx.submit.memberSubmitApi}>
          <noscript>请启用 JavaScript 后参与互动。</noscript>
        </div>
      </article>
      <script dangerouslySetInnerHTML={{ __html: INTERACTION_SCRIPT }} />
    </Layout>
  );
}
