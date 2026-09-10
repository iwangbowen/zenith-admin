import { MEMBER_LOGIN_URL } from '../shared/member';
import type { SurveyQuestion, SurveyState, SurveyStats } from './api';
import { h } from './dom';

/** 「其他」选项 value 与矩阵 row/option 分隔符（与服务端解析约定一致） */
export const OTHER = '__other__';
export const MATRIX_SEP = '::';

export function questionName(q: Pick<SurveyQuestion, 'id'>): string {
  return `q_${q.id}`;
}

function bars(options: SurveyStats['questions'][number]['options']): HTMLElement[] {
  return options.map((o) =>
    h('div', { class: 'poll-bar-row' },
      h('span', { class: 'poll-bar-label' }, o.label),
      h('span', { class: 'poll-bar-track' }, h('span', { class: 'poll-bar-fill', style: `width:${o.percent}%` })),
      h('span', { class: 'poll-bar-num' }, `${o.count} · ${o.percent}%`),
    ));
}

/** 结果区：选择题为条形图；文字 / 日期 / 数字题不公开；评分 / NPS 附均值 */
export function resultsElement(data: SurveyStats | null | undefined): HTMLElement {
  if (!data) return h('p', { class: 'interaction-hint' }, '结果暂不可见');
  const root = h('div', { class: 'interaction-results' }, h('p', null, `共 ${data.responseCount} 人参与`));
  for (const q of data.questions) {
    const section = h('section', null, h('h4', null, q.label));
    if (q.type === 'text' || q.type === 'date' || q.type === 'number') {
      section.appendChild(h('p', { class: 'interaction-hint' }, '该题答案不公开展示'));
    } else {
      if (q.npsScore !== null && q.npsScore !== undefined) section.appendChild(h('p', { class: 'interaction-metric' }, `NPS：${q.npsScore}`));
      else if (q.average !== null && q.average !== undefined) section.appendChild(h('p', { class: 'interaction-metric' }, `平均：${q.average}`));
      section.append(...bars(q.options));
    }
    root.appendChild(section);
  }
  return root;
}

function scalePoints(q: SurveyQuestion): string[] {
  const min = q.type === 'nps' ? 0 : 1;
  const max = q.type === 'nps' ? 10 : (q.ratingMax || 5);
  const out: string[] = [];
  for (let i = min; i <= max; i += 1) out.push(String(i));
  return out;
}

/** 单题 fieldset；data-* 供分页 / 条件显隐 / 校验定位，class 供主题样式 */
export function questionElement(q: SurveyQuestion, index: number): HTMLFieldSetElement {
  const name = questionName(q);
  const fieldset = h('fieldset', {
    class: 'survey-question',
    'data-qid': q.id,
    'data-type': q.type,
    'data-page': q.pageNo || 1,
    'data-index': index,
    'data-cond': q.visibleWhen ? JSON.stringify(q.visibleWhen) : null,
  });
  fieldset.appendChild(h('legend', null, `${index + 1}. ${q.label}`, q.required ? [' ', h('span', { class: 'req' }, '*')] : null));

  if (q.type === 'text') {
    fieldset.appendChild(h('textarea', { name, maxlength: 2000 }));
  } else if (q.type === 'date') {
    fieldset.appendChild(h('input', { type: 'date', name }));
  } else if (q.type === 'number') {
    fieldset.appendChild(h('input', { type: 'number', step: 'any', name }));
  } else if (q.type === 'rating' || q.type === 'nps') {
    fieldset.appendChild(h('div', { class: 'survey-scale' },
      scalePoints(q).map((v) => h('label', { class: 'survey-scale-item' }, h('input', { type: 'radio', name, value: v }), ` ${v}`))));
  } else if (q.type === 'matrix') {
    const table = h('table', { class: 'survey-matrix' },
      h('thead', null, h('tr', null, h('th'), q.options.map((o) => h('th', null, o.label)))),
      h('tbody', null, q.matrixRows.map((row) =>
        h('tr', null,
          h('th', { scope: 'row' }, row.label),
          q.options.map((o) => h('td', null, h('input', { type: 'radio', name: `${name}_${row.id}`, value: `${row.id}${MATRIX_SEP}${o.value}` })))))));
    fieldset.appendChild(h('div', { class: 'survey-matrix-wrap' }, table));
  } else {
    const inputType = q.type === 'multiple' ? 'checkbox' : 'radio';
    const options = h('div', { class: 'survey-options' },
      q.options.map((o) => h('label', { class: 'survey-option' }, h('input', { type: inputType, name, value: o.value }), ` ${o.label}`)));
    if (q.allowOther) {
      options.appendChild(h('label', { class: 'survey-option survey-option-other' }, h('input', { type: inputType, name, value: OTHER }), ` ${q.otherLabel || '其他'}`));
      options.appendChild(h('input', { class: 'survey-other-text', type: 'text', name: `${name}_other`, maxlength: 200, placeholder: '请填写', disabled: true }));
    }
    fieldset.appendChild(options);
    if (q.type === 'multiple') fieldset.appendChild(h('span', { class: 'survey-choice-hint' }, `可选 ${q.minChoices} ~ ${q.maxChoices} 项`));
  }
  fieldset.appendChild(h('p', { class: 'survey-error', hidden: true }));
  return fieldset;
}

export function memberOnlyHint(): HTMLElement {
  return h('p', { class: 'interaction-hint' }, '本互动仅限会员参与，', h('a', { href: MEMBER_LOGIN_URL }, '请先登录'));
}

/** 表单骨架：恢复提示 + 题目 + 验证码 + 错误提示 + 分页条 */
export function formElement(state: SurveyState): HTMLFormElement {
  const form = h('form', { class: 'front-form interaction-form', novalidate: true });
  form.appendChild(h('p', { class: 'survey-restored', hidden: true }, '已恢复上次填写的内容 ', h('button', { type: 'button', class: 'survey-clear-draft' }, '清空重填')));
  state.interaction.questions.forEach((q, index) => form.appendChild(questionElement(q, index)));
  if (state.captcha.provider === 'math') {
    form.appendChild(h('div', { class: 'cms-captcha-box' },
      h('input', { type: 'hidden', name: 'captchaId' }),
      h('label', null, '验证码 ', h('input', { name: 'captchaAnswer', required: true, autocomplete: 'off' })),
      h('span', { class: 'cms-captcha-img' })));
  }
  if (state.captcha.provider === 'turnstile') form.appendChild(h('div', { class: 'cms-turnstile' }));
  form.appendChild(h('p', { class: 'survey-form-error', hidden: true }));
  form.appendChild(h('div', { class: 'survey-pager' },
    h('span', { class: 'survey-progress' }),
    h('button', { type: 'button', class: 'survey-prev', hidden: true }, '上一页'),
    h('button', { type: 'button', class: 'survey-next', hidden: true }, '下一页'),
    h('button', { type: 'submit', class: 'survey-submit' }, '提交')));
  return form;
}

export function doneElement(message: string): HTMLElement {
  return h('p', { class: 'survey-done' }, message);
}

export function liveResultsElement(results: SurveyStats): HTMLElement {
  return h('div', { class: 'interaction-live-results' }, resultsElement(results));
}
