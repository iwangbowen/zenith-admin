import type { CmsInteractionPublicState, CmsInteractionPublicStats, CmsInteractionSubmitResult } from '@zenith/shared/cms';
import { apiHeaders, apiJson, type ApiResult } from '../shared/api';

export type SurveyState = CmsInteractionPublicState;
export type SurveyStats = CmsInteractionPublicStats;
export type SurveyQuestion = SurveyState['interaction']['questions'][number];

/** 容器 data 契约（服务端 InteractionTemplate / 详情页互动块输出） */
export interface SurveyContainer {
  site: string;
  siteId: string | null;
  code: string;
  memberSubmitApi: string | null;
}

export function readContainer(el: HTMLElement): SurveyContainer {
  return {
    site: el.dataset.site ?? '',
    siteId: el.dataset.siteId ?? null,
    code: el.dataset.code ?? '',
    memberSubmitApi: el.dataset.memberSubmitApi ?? null,
  };
}

export function fetchState(box: SurveyContainer, token: string | null): Promise<ApiResult<SurveyState>> {
  return apiJson<SurveyState>(`/api/public/cms/interactions/${box.site}/${box.code}`, { headers: apiHeaders(token, false) });
}

export interface SubmitPayload {
  answers: Record<string, string | string[]>;
  idempotencyKey: string;
  captchaId?: string;
  captchaAnswer?: string;
  turnstileToken?: string;
}

/** 提交地址：会员优先用容器声明的接口，缺省时按 siteId 拼；游客走公开接口 */
export function submitUrl(box: SurveyContainer, interactionId: number, token: string | null): string {
  if (!token) return `/api/public/cms/interactions/${box.site}/${box.code}/submit`;
  let memberUrl = box.memberSubmitApi;
  if (!memberUrl && box.siteId) memberUrl = `/api/member/cms/interactions/${interactionId}/submit?siteId=${encodeURIComponent(box.siteId)}`;
  return memberUrl || `/api/member/cms/interactions/${interactionId}/submit`;
}

export function submitAnswers(url: string, token: string | null, payload: SubmitPayload): Promise<ApiResult<CmsInteractionSubmitResult>> {
  return apiJson<CmsInteractionSubmitResult>(url, { method: 'POST', headers: apiHeaders(token, true), body: JSON.stringify(payload) });
}

export function idempotencyKey(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2);
}

// ─── 验证码 ───────────────────────────────────────────────────────────────────

interface TurnstileApi {
  render: (el: HTMLElement, options: { sitekey: string }) => string;
  reset: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

const TURNSTILE_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

/** 算术验证码：拉取挑战填入表单内的 .cms-captcha-box */
export function loadMathCaptcha(form: HTMLFormElement): void {
  const box = form.querySelector<HTMLElement>('.cms-captcha-box');
  if (!box) return;
  apiJson<{ id: string; svg: string }>('/api/public/cms/captcha')
    .then((result) => {
      if (!result || result.code !== 0 || !result.data) return;
      const idInput = box.querySelector<HTMLInputElement>('[name=captchaId]');
      const image = box.querySelector<HTMLElement>('.cms-captcha-img');
      if (idInput) idInput.value = result.data.id;
      if (image) image.innerHTML = result.data.svg;
    })
    .catch(() => {});
}

/** Turnstile：按需注入官方脚本（explicit 模式），就绪后渲染到表单内 .cms-turnstile */
export function loadTurnstile(form: HTMLFormElement, siteKey: string | null): void {
  const target = form.querySelector<HTMLElement>('.cms-turnstile');
  if (!target || !siteKey) return;
  const render = () => {
    if (!window.turnstile || target.dataset.widgetId) return;
    target.dataset.widgetId = String(window.turnstile.render(target, { sitekey: siteKey }));
  };
  if (window.turnstile) {
    render();
    return;
  }
  let script = document.querySelector<HTMLScriptElement>('script[data-cms-turnstile]');
  if (!script) {
    script = document.createElement('script');
    script.src = TURNSTILE_SRC;
    script.async = true;
    script.defer = true;
    script.dataset.cmsTurnstile = '1';
    document.head.appendChild(script);
  }
  script.addEventListener('load', render, { once: true });
}

export function resetCaptcha(form: HTMLFormElement, captcha: SurveyState['captcha']): void {
  if (captcha.provider === 'math') loadMathCaptcha(form);
  if (captcha.provider === 'turnstile' && window.turnstile) {
    const target = form.querySelector<HTMLElement>('.cms-turnstile');
    if (target?.dataset.widgetId) window.turnstile.reset(target.dataset.widgetId);
  }
}
