import { isOk } from '../shared/api';
import { readMemberToken } from '../shared/member';
import {
  fetchState, idempotencyKey, loadMathCaptcha, loadTurnstile, readContainer, resetCaptcha, submitAnswers, submitUrl,
  type SubmitPayload, type SurveyContainer, type SurveyState,
} from './api';
import { replace } from './dom';
import { clearDraft, restoreDraft, saveDraft } from './draft';
import { collect, refresh, setFieldError, setFormError, validate, type FormState } from './form';
import { doneElement, formElement, liveResultsElement, memberOnlyHint, resultsElement } from './render';

function showResults(el: HTMLElement, state: SurveyState): void {
  replace(el, resultsElement(state.results));
}

function buildPayload(form: HTMLFormElement, state: FormState): SubmitPayload {
  const payload: SubmitPayload = { answers: collect(form, state), idempotencyKey: idempotencyKey() };
  const captchaId = form.querySelector<HTMLInputElement>('[name=captchaId]');
  const captchaAnswer = form.querySelector<HTMLInputElement>('[name=captchaAnswer]');
  const turnstile = form.querySelector<HTMLInputElement>('[name="cf-turnstile-response"]');
  if (captchaId) payload.captchaId = captchaId.value;
  if (captchaAnswer) payload.captchaAnswer = captchaAnswer.value;
  if (turnstile) payload.turnstileToken = turnstile.value;
  return payload;
}

function renderForm(el: HTMLElement, box: SurveyContainer, token: string | null, server: SurveyState): void {
  const { interaction } = server;
  if (interaction.participantScope === 'member' && !token) {
    replace(el, memberOnlyHint());
    return;
  }
  const state: FormState = { page: 0, interaction };
  const form = formElement(server);
  const showLive = interaction.repeatPolicy === 'multiple' && server.resultsVisible && server.results;
  replace(el, showLive && server.results ? liveResultsElement(server.results) : null, form);

  if (server.captcha.provider === 'math') loadMathCaptcha(form);
  if (server.captcha.provider === 'turnstile') loadTurnstile(form, server.captcha.siteKey);

  const restored = form.querySelector<HTMLElement>('.survey-restored')!;
  if (restoreDraft(box, form, state)) restored.hidden = false;

  form.querySelector<HTMLElement>('.survey-clear-draft')!.addEventListener('click', () => {
    clearDraft(box);
    form.reset();
    state.page = 0;
    restored.hidden = true;
    for (const fieldset of form.querySelectorAll<HTMLElement>('.survey-question')) setFieldError(fieldset, '');
    setFormError(form, '');
    refresh(form, state);
  });
  form.addEventListener('change', (event) => {
    refresh(form, state);
    const fieldset = (event.target as Element | null)?.closest<HTMLElement>('.survey-question');
    if (fieldset?.classList.contains('survey-question-invalid')) setFieldError(fieldset, '');
    saveDraft(box, form, state);
  });
  form.addEventListener('input', (event) => {
    if ((event.target as Element | null)?.classList.contains('survey-other-text')) saveDraft(box, form, state);
  });
  form.querySelector<HTMLElement>('.survey-prev')!.addEventListener('click', () => {
    setFormError(form, '');
    state.page -= 1;
    refresh(form, state);
    saveDraft(box, form, state);
    form.scrollIntoView({ block: 'start' });
  });
  form.querySelector<HTMLElement>('.survey-next')!.addEventListener('click', () => {
    if (!validate(form, state, true)) return;
    state.page += 1;
    refresh(form, state);
    saveDraft(box, form, state);
    form.scrollIntoView({ block: 'start' });
  });
  refresh(form, state);

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!validate(form, state, false)) return;
    const captchaAnswer = form.querySelector<HTMLInputElement>('[name=captchaAnswer]');
    if (captchaAnswer && !captchaAnswer.value.trim()) {
      setFormError(form, '请填写验证码');
      return;
    }
    const submitButton = form.querySelector<HTMLButtonElement>('.survey-submit')!;
    submitButton.disabled = true;
    submitAnswers(submitUrl(box, interaction.id, token), token, buildPayload(form, state))
      .then((result) => {
        submitButton.disabled = false;
        if (!isOk(result)) {
          setFormError(form, result?.message || '提交失败');
          resetCaptcha(form, server.captcha);
          return;
        }
        clearDraft(box);
        // 感谢语位于 data.message（合同 CmsInteractionSubmitResult）；信封 message 恒为 'success'，
        // 原内联脚本误读信封导致后台配置的感谢语从未展示
        const message = result.data.message;
        if (interaction.repeatPolicy === 'multiple') {
          el.querySelector('.survey-done')?.remove();
          form.before(doneElement(message || '提交成功，可继续参与'));
          if (result.data.results) {
            const live = el.querySelector('.interaction-live-results');
            const next = liveResultsElement(result.data.results);
            if (live) live.replaceWith(next);
            else el.prepend(next);
          }
          form.reset();
          state.page = 0;
          setFormError(form, '');
          restored.hidden = true;
          refresh(form, state);
          resetCaptcha(form, server.captcha);
          return;
        }
        if (result.data.results) replace(el, resultsElement(result.data.results));
        else replace(el, doneElement(message || '提交成功'));
      })
      .catch(() => {
        submitButton.disabled = false;
        setFormError(form, '提交失败，请稍后再试');
        resetCaptcha(form, server.captcha);
      });
  });
}

/**
 * 互动问卷 / 投票（`.cms-interaction`，容器契约：data-site / data-site-id / data-code / data-member-submit-api）。
 * 拉取公开状态：已关闭或已提交且结果可见 → 直接展示结果；否则渲染表单（题型、条件显隐、分页、验证码、草稿）。
 */
export function mountSurvey(el: HTMLElement): void {
  const box = readContainer(el);
  const token = readMemberToken();
  fetchState(box, token)
    .then((result) => {
      if (!isOk(result)) {
        el.style.display = 'none';
        return;
      }
      const state = result.data;
      if (!state.open) {
        showResults(el, state);
        return;
      }
      if (state.resultsVisible && state.submitted && state.interaction.repeatPolicy !== 'multiple') {
        showResults(el, state);
        return;
      }
      renderForm(el, box, token, state);
    })
    .catch(() => {
      el.style.display = 'none';
    });
}
