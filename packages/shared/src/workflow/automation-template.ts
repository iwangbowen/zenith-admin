import type { WorkflowAutomationAction } from './types';

export interface WorkflowAutomationTemplateContext {
  system: { instanceId: number; title: string; status: string; initiator: string; initiatorId: number };
  formData: Record<string, unknown>;
}

const SYSTEM_ALIASES = ['instanceId', 'title', 'status', 'initiator', 'initiatorId'] as const;
const BLOCKED_PATH_SEGMENTS = new Set(['__proto__', 'prototype', 'constructor']);
const TOKEN = /\{\{\s*([^{}]+?)\s*\}\}/g;
const SINGLE_TOKEN = /^\s*\{\{\s*([^{}]+?)\s*\}\}\s*$/;
const SEGMENT = /^(?:[\p{L}_$][\p{L}\p{N}_$-]*|\d+)$/u;

export class WorkflowAutomationTemplateError extends Error {
  constructor(message: string) { super(message); this.name = 'WorkflowAutomationTemplateError'; }
}

function variablePath(variable: string): string[] {
  const key = variable.trim();
  if ((SYSTEM_ALIASES as readonly string[]).includes(key)) return ['system', key];
  const parts = key.split('.');
  if (parts.length < 2 || !['system', 'formData'].includes(parts[0])
    || parts.some((part) => !SEGMENT.test(part) || BLOCKED_PATH_SEGMENTS.has(part))) {
    throw new WorkflowAutomationTemplateError(`自动化变量路径无效：${key}；表单字段请使用 formData.字段，系统值使用 system.字段`);
  }
  if (parts[0] === 'system' && (parts.length !== 2 || !(SYSTEM_ALIASES as readonly string[]).includes(parts[1]))) {
    throw new WorkflowAutomationTemplateError(`未知系统变量：${key}`);
  }
  return parts;
}

/** Only own data properties are readable; templates never invoke getters or expressions. */
export function resolveWorkflowAutomationVariable(variable: string, context: WorkflowAutomationTemplateContext): unknown {
  const parts = variablePath(variable);
  let value: unknown = context;
  for (const part of parts) {
    const descriptor = value !== null && typeof value === 'object' ? Object.getOwnPropertyDescriptor(value, part) : undefined;
    if (!descriptor || !('value' in descriptor) || descriptor.value === undefined) {
      throw new WorkflowAutomationTemplateError(`自动化变量不存在：${variable.trim()}`);
    }
    value = descriptor.value;
  }
  return value;
}

function tokens(template: string): RegExpMatchArray[] {
  const matches = [...template.matchAll(TOKEN)];
  const literal = template.replace(TOKEN, '');
  if (literal.includes('{{') || literal.includes('}}')) throw new WorkflowAutomationTemplateError('自动化模板变量括号不完整');
  for (const match of matches) variablePath(match[1]);
  return matches;
}

function text(value: unknown): string {
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
    throw new WorkflowAutomationTemplateError('自动化变量必须是 JSON 可表示的值');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new WorkflowAutomationTemplateError('自动化变量数值必须有限，不能使用 NaN 或 Infinity');
  if (typeof value === 'object' && value !== null) {
    try { return JSON.stringify(value); } catch { throw new WorkflowAutomationTemplateError('自动化变量不能转换为 JSON 文本'); }
  }
  return String(value);
}

export function renderWorkflowAutomationText(template: string, context: WorkflowAutomationTemplateContext): string {
  tokens(template);
  return template.replace(TOKEN, (_match, variable: string) => text(resolveWorkflowAutomationVariable(variable, context)));
}

/** Whole-value references preserve JSON types and never share the source object. */
export function renderWorkflowAutomationValue(template: string, context: WorkflowAutomationTemplateContext): unknown {
  tokens(template);
  const single = template.match(SINGLE_TOKEN);
  if (!single) return renderWorkflowAutomationText(template, context);
  const value = resolveWorkflowAutomationVariable(single[1], context);
  text(value); // Reject values that cannot travel through the JSON API boundary.
  try { return structuredClone(value); } catch { throw new WorkflowAutomationTemplateError('自动化变量不能复制为独立值'); }
}

export function renderWorkflowAutomationFields(fields: Record<string, string>, context: WorkflowAutomationTemplateContext): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).map(([key, template]) => [key, renderWorkflowAutomationValue(template, context)]));
}

function renderJson(value: unknown, context: WorkflowAutomationTemplateContext): unknown {
  if (typeof value === 'string') return renderWorkflowAutomationValue(value, context);
  if (Array.isArray(value)) return value.map((entry) => renderJson(entry, context));
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, renderJson(entry, context)]));
  return value;
}

export type WorkflowAutomationRenderedBody = { kind: 'json'; value: unknown } | { kind: 'text'; value: string };

function parseJsonTemplate(template: string): { parsed: true; value: unknown } | { parsed: false } {
  try { return { parsed: true, value: JSON.parse(template) }; }
  catch {
    if (/^\s*[[{]/.test(template) && !SINGLE_TOKEN.test(template)) {
      throw new WorkflowAutomationTemplateError('Webhook JSON 模板格式无效；变量值请放在 JSON 字符串节点中');
    }
    return { parsed: false };
  }
}

/** Parse before interpolation so quotes and typed arrays never corrupt JSON syntax. */
export function renderWorkflowAutomationBody(template: string, context: WorkflowAutomationTemplateContext): WorkflowAutomationRenderedBody {
  const parsed = parseJsonTemplate(template);
  if (parsed.parsed) return { kind: 'json', value: renderJson(parsed.value, context) };
  const value = renderWorkflowAutomationValue(template, context);
  return typeof value === 'string' ? { kind: 'text', value } : { kind: 'json', value };
}

function validateJsonStrings(value: unknown): void {
  if (typeof value === 'string') { tokens(value); return; }
  if (Array.isArray(value)) { value.forEach(validateJsonStrings); return; }
  if (value !== null && typeof value === 'object') Object.values(value).forEach(validateJsonStrings);
}

/** Save-time syntax validation is shared by Server and Demo; missing input is checked at execution. */
export function assertWorkflowAutomationTemplateSyntax(action: WorkflowAutomationAction): void {
  switch (action.type) {
    case 'startWorkflow':
      if (action.titleTemplate) tokens(action.titleTemplate);
      Object.values(action.formMapping ?? {}).forEach(tokens);
      break;
    case 'updateField': Object.values(action.fields).forEach(tokens); break;
    case 'sendMessage':
      tokens(action.title); tokens(action.content);
      action.buttons?.forEach((button) => { tokens(button.text); tokens(button.url); });
      break;
    case 'webhook': {
      const authority = action.url.match(/^https?:\/\/([^/?#]*)/i)?.[1];
      const fragmentIndex = action.url.indexOf('#');
      const fragment = fragmentIndex < 0 ? '' : action.url.slice(fragmentIndex + 1);
      if (authority === undefined || authority.includes('{{') || fragment.includes('{{')) {
        throw new WorkflowAutomationTemplateError('Webhook URL 的协议和主机必须固定，变量仅可用于路径或查询参数');
      }
      tokens(action.url); Object.values(action.headers ?? {}).forEach(tokens);
      if (action.bodyTemplate) {
        const parsed = parseJsonTemplate(action.bodyTemplate);
        if (parsed.parsed) validateJsonStrings(parsed.value); else tokens(action.bodyTemplate);
      }
      break;
    }
  }
}
