import type { SurveyContainer } from './api';
import type { FormState } from './form';

const DRAFT_PREFIX = 'zenith:cms-interaction-draft:';

interface Draft {
  page?: number;
  fields: Record<string, string | string[]>;
}

function draftKey(box: SurveyContainer): string {
  return `${DRAFT_PREFIX}${box.site}:${box.code}`;
}

/** 表单快照：仅 q_ 开头的字段；单选 / 多选存已勾选 value 数组 */
function snapshot(form: HTMLFormElement): Draft['fields'] {
  const data: Draft['fields'] = {};
  for (const el of form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input,textarea')) {
    if (!el.name || !el.name.startsWith('q_')) continue;
    if (el.type === 'radio' || el.type === 'checkbox') {
      if ((el as HTMLInputElement).checked) {
        const list = (data[el.name] as string[] | undefined) ?? [];
        list.push(el.value);
        data[el.name] = list;
      }
    } else if (el.value) {
      data[el.name] = el.value;
    }
  }
  return data;
}

export function saveDraft(box: SurveyContainer, form: HTMLFormElement, state: FormState): void {
  try {
    localStorage.setItem(draftKey(box), JSON.stringify({ page: state.page, fields: snapshot(form) } satisfies Draft));
  } catch {
    // 存储不可用时静默
  }
}

export function clearDraft(box: SurveyContainer): void {
  try {
    localStorage.removeItem(draftKey(box));
  } catch {
    // 存储不可用时静默
  }
}

/** 回填草稿；有任一字段生效时恢复页码并返回 true */
export function restoreDraft(box: SurveyContainer, form: HTMLFormElement, state: FormState): boolean {
  let raw: string | null;
  try {
    raw = localStorage.getItem(draftKey(box));
  } catch {
    return false;
  }
  if (!raw) return false;
  let data: Draft;
  try {
    data = JSON.parse(raw) as Draft;
  } catch {
    return false;
  }
  if (!data?.fields) return false;
  let applied = false;
  for (const [name, value] of Object.entries(data.fields)) {
    const nodes = form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>(`[name="${name}"]`);
    if (!nodes.length) continue;
    if (Array.isArray(value)) {
      for (const el of nodes) {
        if (value.includes(el.value)) {
          (el as HTMLInputElement).checked = true;
          applied = true;
        }
      }
    } else {
      const el = nodes[0];
      if (el.type !== 'radio' && el.type !== 'checkbox') {
        el.value = value;
        applied = true;
      }
    }
  }
  if (applied && typeof data.page === 'number') state.page = data.page;
  return applied;
}
