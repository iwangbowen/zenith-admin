import { apiJson, isOk } from './shared/api';
import { readMemberToken } from './shared/member';

/** 回复：点击评论的「回复」按钮把 parentId 写入表单并显示提示；「取消回复」还原 */
function wireReplies(section: HTMLElement, form: HTMLFormElement): void {
  const parentInput = form.querySelector<HTMLInputElement>('#comment-parent-id');
  const hint = form.querySelector<HTMLElement>('#reply-hint');
  const target = form.querySelector<HTMLElement>('#reply-target');
  for (const button of section.querySelectorAll<HTMLElement>('.comment-reply-btn')) {
    button.addEventListener('click', () => {
      if (parentInput) parentInput.value = button.dataset.commentId ?? '0';
      if (target) target.textContent = button.dataset.nickname ?? '';
      if (hint) hint.style.display = 'block';
      form.scrollIntoView({ behavior: 'smooth' });
    });
  }
  form.querySelector<HTMLElement>('#cancel-reply')?.addEventListener('click', () => {
    if (parentInput) parentInput.value = '0';
    if (hint) hint.style.display = 'none';
  });
}

/**
 * 会员增强：有会员 token 且表单声明 data-member-api 时，隐藏昵称与验证码行、改走会员 JSON 接口；
 * 401 自动回退游客表单。游客保持原生 form POST。
 */
function wireMemberSubmit(form: HTMLFormElement): void {
  const api = form.getAttribute('data-member-api');
  let token = readMemberToken();
  if (!token || !api) return;

  const nickRow = form.querySelector<HTMLElement>('#comment-nick-row');
  const nickInput = nickRow?.querySelector<HTMLInputElement>('input') ?? null;
  if (nickRow) {
    nickRow.style.display = 'none';
    if (nickInput) {
      nickInput.required = false;
      nickInput.value = '会员';
    }
  }
  const captchaRow = form.querySelector<HTMLElement>('.cms-captcha-box');
  const captchaInput = captchaRow?.querySelector<HTMLInputElement>('input[name="captchaAnswer"]') ?? null;
  if (captchaRow) {
    captchaRow.style.display = 'none';
    if (captchaInput) captchaInput.required = false;
  }
  const hint = document.createElement('p');
  hint.style.cssText = 'font-size:12px;color:#59636e;margin:0';
  hint.textContent = '已以会员身份登录，评论将使用会员昵称';
  form.insertBefore(hint, form.firstChild);

  const restoreGuestForm = () => {
    token = null;
    form.removeAttribute('data-member-api');
    if (nickRow) {
      nickRow.style.display = '';
      if (nickInput) {
        nickInput.required = true;
        nickInput.value = '';
      }
    }
    if (captchaRow) captchaRow.style.display = '';
    hint.remove();
  };

  form.addEventListener('submit', (event) => {
    if (!token) return;
    event.preventDefault();
    const content = form.querySelector<HTMLTextAreaElement>('textarea[name="content"]')?.value.trim() ?? '';
    if (!content) return;
    const parentId = Number(form.querySelector<HTMLInputElement>('#comment-parent-id')?.value) || 0;
    apiJson(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ content, parentId }),
    })
      .then((result) => {
        if (isOk(result)) {
          const done = document.createElement('p');
          done.className = 'survey-done';
          done.textContent = result.message || '评论已提交，审核通过后显示';
          form.replaceChildren(done);
        } else if (result?.code === 401) {
          restoreGuestForm();
          alert('会员登录已过期，请以游客身份提交或重新登录');
        } else {
          alert(result?.message || '提交失败，请稍后再试');
        }
      })
      .catch(() => alert('提交失败，请稍后再试'));
  });
}

/**
 * 评论区（`section.comments`）：回复定位 + 会员通道增强。验证码由独立的 captcha 岛负责。
 */
export function mountComments(el: HTMLElement): void {
  const form = el.querySelector<HTMLFormElement>('#comment-form');
  if (!form) return;
  wireReplies(el, form);
  wireMemberSubmit(form);
}
