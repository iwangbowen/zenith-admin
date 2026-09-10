import type { SurveyQuestion, SurveyState } from './api';
import { MATRIX_SEP, OTHER, questionName } from './render';

/** 表单运行态：当前页索引（0 基）+ 服务端状态 */
export interface FormState {
  page: number;
  interaction: SurveyState['interaction'];
}

const questionSelector = (q: Pick<SurveyQuestion, 'id'>) => `.survey-question[data-qid="${q.id}"]`;

export function fieldsetOf(form: HTMLFormElement, q: Pick<SurveyQuestion, 'id'>): HTMLFieldSetElement | null {
  return form.querySelector<HTMLFieldSetElement>(questionSelector(q));
}

function pageOf(fieldset: HTMLElement): number {
  return Number(fieldset.dataset.page || 1);
}

/** 出现过的页码升序（至少 [1]） */
export function pageList(form: HTMLFormElement): number[] {
  const pages: number[] = [];
  for (const fieldset of form.querySelectorAll<HTMLElement>('.survey-question')) {
    const page = pageOf(fieldset);
    if (!pages.includes(page)) pages.push(page);
  }
  pages.sort((a, b) => a - b);
  return pages.length ? pages : [1];
}

function pickedValues(form: HTMLFormElement, qid: string): string[] {
  const out: string[] = [];
  for (const el of form.querySelectorAll<HTMLInputElement>(`[name="q_${qid}"]`)) {
    if ((el.type === 'radio' || el.type === 'checkbox') && el.checked) out.push(el.value);
  }
  return out;
}

interface VisibleWhen {
  questionIndex: number;
  op: string;
  values: string[];
}

/** 条件显隐：依赖题未命中（或 none 命中）则标记 data-cond-hidden */
export function applyConditions(form: HTMLFormElement): void {
  for (const fieldset of form.querySelectorAll<HTMLElement>('.survey-question[data-cond]')) {
    let rule: VisibleWhen;
    try {
      rule = JSON.parse(fieldset.dataset.cond ?? '') as VisibleWhen;
    } catch {
      continue;
    }
    const source = form.querySelector<HTMLElement>(`.survey-question[data-index="${rule.questionIndex}"]`);
    if (!source) {
      fieldset.dataset.condHidden = '';
      continue;
    }
    const values = pickedValues(form, source.dataset.qid ?? '');
    const hit = values.some((v) => rule.values.includes(v));
    const hidden = rule.op === 'none' ? hit : !hit;
    fieldset.dataset.condHidden = hidden ? '1' : '';
  }
}

/** 重算可见性 / 禁用态 / 「其他」填空 / 分页条 */
export function refresh(form: HTMLFormElement, state: FormState): void {
  applyConditions(form);
  const pages = pageList(form);
  const index = Math.max(0, Math.min(state.page, pages.length - 1));
  state.page = index;
  const current = pages[index];
  for (const fieldset of form.querySelectorAll<HTMLFieldSetElement>('.survey-question')) {
    const condHidden = !!fieldset.dataset.condHidden;
    // 分页只影响可见性；只有条件未命中的题目才 disabled，保证跨页答案一起提交
    fieldset.hidden = condHidden || pageOf(fieldset) !== current;
    fieldset.disabled = condHidden;
  }
  for (const el of form.querySelectorAll<HTMLInputElement>('.survey-option-other input[type=radio],.survey-option-other input[type=checkbox]')) {
    const text = el.closest('.survey-options')?.querySelector<HTMLInputElement>('.survey-other-text');
    if (!text) continue;
    text.disabled = !el.checked;
    if (!el.checked) text.value = '';
  }
  const pager = form.querySelector<HTMLElement>('.survey-pager');
  if (!pager) return;
  const last = index === pages.length - 1;
  const progress = pager.querySelector<HTMLElement>('.survey-progress');
  if (progress) progress.textContent = pages.length > 1 ? `第 ${index + 1} / ${pages.length} 页` : '';
  const prev = pager.querySelector<HTMLElement>('.survey-prev');
  const next = pager.querySelector<HTMLElement>('.survey-next');
  const submit = pager.querySelector<HTMLElement>('.survey-submit');
  if (prev) prev.hidden = index === 0;
  if (next) next.hidden = last;
  if (submit) submit.hidden = !last;
}

function otherValue(fieldset: HTMLElement, name: string, value: string): string {
  if (value !== OTHER) return value;
  const text = fieldset.querySelector<HTMLInputElement>(`[name="${name}_other"]`)?.value.trim() ?? '';
  return text ? `${OTHER}:${text}` : OTHER;
}

/** 收集答案：跳过 disabled（条件未命中）的题目 */
export function collect(form: HTMLFormElement, state: FormState): Record<string, string | string[]> {
  const answers: Record<string, string | string[]> = {};
  for (const q of state.interaction.questions) {
    const fieldset = fieldsetOf(form, q);
    if (!fieldset || fieldset.disabled) continue;
    const name = questionName(q);
    const key = String(q.id);
    if (q.type === 'matrix') {
      const picks = [...fieldset.querySelectorAll<HTMLInputElement>('input[type=radio]')].filter((el) => el.checked).map((el) => el.value);
      if (picks.length) answers[key] = picks;
      continue;
    }
    if (q.type === 'multiple') {
      const values = [...fieldset.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].filter((el) => el.checked).map((el) => otherValue(fieldset, name, el.value));
      if (values.length) answers[key] = values;
      continue;
    }
    if (q.type === 'single' || q.type === 'rating' || q.type === 'nps') {
      const picked = [...fieldset.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find((el) => el.checked);
      if (picked) answers[key] = otherValue(fieldset, name, picked.value);
      continue;
    }
    const el = fieldset.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    if (el && el.value) answers[key] = el.value;
  }
  return answers;
}

export function setFieldError(fieldset: HTMLElement, message: string | null): void {
  const slot = fieldset.querySelector<HTMLElement>('.survey-error');
  if (!slot) return;
  slot.textContent = message || '';
  slot.hidden = !message;
  fieldset.classList.toggle('survey-question-invalid', !!message);
}

export function setFormError(form: HTMLFormElement, message: string): void {
  const slot = form.querySelector<HTMLElement>('.survey-form-error');
  if (!slot) return;
  slot.textContent = message;
  slot.hidden = !message;
}

function otherTextMissing(fieldset: HTMLElement, name: string): boolean {
  const text = fieldset.querySelector<HTMLInputElement>(`[name="${name}_other"]`);
  return !!text && !text.value.trim();
}

/** 单题校验：返回错误文案或 null */
export function questionError(q: SurveyQuestion, fieldset: HTMLFieldSetElement): string | null {
  const name = questionName(q);
  if (q.type === 'matrix') {
    const rows = q.matrixRows.length;
    const picked = [...fieldset.querySelectorAll<HTMLInputElement>('input[type=radio]')].filter((el) => el.checked).length;
    if (picked === 0) return q.required ? '该题为必答题' : null;
    if (q.required && picked < rows) return '请为每一行作答';
    return null;
  }
  if (q.type === 'multiple') {
    const values = [...fieldset.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].filter((el) => el.checked).map((el) => el.value);
    if (values.length === 0) return q.required ? '该题为必答题' : null;
    const min = q.required ? Math.max(1, q.minChoices) : q.minChoices;
    if (values.length < min || values.length > q.maxChoices) return `需选择 ${min}-${q.maxChoices} 项，当前 ${values.length} 项`;
    if (values.includes(OTHER) && otherTextMissing(fieldset, name)) return '请填写「其他」的内容';
    return null;
  }
  if (q.type === 'single' || q.type === 'rating' || q.type === 'nps') {
    const picked = [...fieldset.querySelectorAll<HTMLInputElement>(`input[name="${name}"]`)].find((el) => el.checked);
    if (!picked) return q.required ? '该题为必答题' : null;
    if (picked.value === OTHER && otherTextMissing(fieldset, name)) return '请填写「其他」的内容';
    return null;
  }
  const value = fieldset.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`)?.value.trim() ?? '';
  if (!value) return q.required ? '该题为必答题' : null;
  if (q.type === 'number' && Number.isNaN(Number(value))) return '请填写数字';
  return null;
}

/**
 * 校验（全部或仅当前页）：标出错误；若首个出错题在别的页则翻回该页；滚动到首个出错题。
 * 返回是否通过。
 */
export function validate(form: HTMLFormElement, state: FormState, onlyCurrentPage: boolean): boolean {
  let ok = true;
  let first: HTMLElement | null = null;
  let firstPage: number | null = null;
  const pages = pageList(form);
  const current = pages[state.page];
  for (const q of state.interaction.questions) {
    const fieldset = fieldsetOf(form, q);
    if (!fieldset) continue;
    if (fieldset.disabled) {
      setFieldError(fieldset, '');
      continue;
    }
    if (onlyCurrentPage && pageOf(fieldset) !== current) continue;
    const message = questionError(q, fieldset);
    setFieldError(fieldset, message);
    if (message) {
      ok = false;
      if (!first) {
        first = fieldset;
        firstPage = pages.indexOf(pageOf(fieldset));
      }
    }
  }
  // 提交时若出错的题目在别的页，自动翻回该页再高亮，避免用户对着空白页找错
  if (!ok && firstPage !== null && firstPage >= 0 && firstPage !== state.page) {
    state.page = firstPage;
    refresh(form, state);
  }
  first?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  setFormError(form, ok ? '' : '请先完善标红的题目');
  return ok;
}

export { MATRIX_SEP };
