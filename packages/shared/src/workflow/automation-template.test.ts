import { describe, expect, it, vi } from 'vitest';
import { assertWorkflowAutomationTemplateSyntax, renderWorkflowAutomationBody, renderWorkflowAutomationFields,
  renderWorkflowAutomationText, renderWorkflowAutomationValue, resolveWorkflowAutomationVariable,
  WorkflowAutomationTemplateError, type WorkflowAutomationTemplateContext } from './automation-template';

const context = (): WorkflowAutomationTemplateContext => ({
  system: { instanceId: 7, title: '设备采购审批', status: 'approved', initiator: '张采购', initiatorId: 9 },
  formData: { title: '业务自填标题', status: '业务状态', amount: 28000, purchased: false, nothing: null,
    reviewers: [9, 10], assets: [{ name: '国产电脑', quantity: 4 }], dates: ['2026-10-05', '2026-10-06'],
    nested: { buyer: { name: '张"采购"\n经办', id: 9 } }, object: { note: '含引号"、斜杠\\和换行\n' } },
});

describe('automation template values', () => {
  it('keeps system variables and their explicit aliases separate from same-named business fields', () => {
    const ctx = context();
    expect(renderWorkflowAutomationText('{{title}} / {{system.title}} / {{formData.title}}', ctx)).toBe('设备采购审批 / 设备采购审批 / 业务自填标题');
    expect(renderWorkflowAutomationText('{{status}} / {{system.status}} / {{formData.status}}', ctx)).toBe('approved / approved / 业务状态');
  });
  it('preserves number, false, null, arrays, objects and date ranges for whole-value mappings', () => {
    const ctx = context();
    const fields = renderWorkflowAutomationFields({ amount: '{{formData.amount}}', flag: '{{formData.purchased}}',
      nothing: '{{formData.nothing}}', reviewers: '{{formData.reviewers}}', assets: '{{formData.assets}}',
      dates: '{{formData.dates}}', nested: '{{formData.nested}}' }, ctx);
    expect(fields).toEqual({ amount: 28000, flag: false, nothing: null, reviewers: [9, 10], assets: [{ name: '国产电脑', quantity: 4 }],
      dates: ['2026-10-05', '2026-10-06'], nested: ctx.formData.nested });
    (fields.assets as Array<{ quantity: number }>)[0].quantity = 99;
    (fields.reviewers as number[]).push(11);
    expect(ctx.formData.assets).toEqual([{ name: '国产电脑', quantity: 4 }]);
    expect(ctx.formData.reviewers).toEqual([9, 10]);
  });
  it('supports nested own-property paths and renders embedded values as text', () => {
    const ctx = context();
    expect(renderWorkflowAutomationValue(' {{formData.nested.buyer.id}} ', ctx)).toBe(9);
    expect(renderWorkflowAutomationText('金额={{formData.amount}}，已购={{formData.purchased}}，空={{formData.nothing}}', ctx)).toBe('金额=28000，已购=false，空=null');
    expect(resolveWorkflowAutomationVariable('formData.assets.0.quantity', ctx)).toBe(4);
  });
  it('fails explicitly for missing values rather than manufacturing blank financial data', () => {
    expect(() => renderWorkflowAutomationFields({ amount: '{{formData.missingAmount}}' }, context())).toThrow('自动化变量不存在：formData.missingAmount');
    expect(() => renderWorkflowAutomationText('金额={{formData.nested.missing}}', context())).toThrow(WorkflowAutomationTemplateError);
    expect(() => renderWorkflowAutomationValue('{{amount}}', context())).toThrow('表单字段请使用 formData.字段');
  });
  it('does not read inherited properties, getters, prototype paths or expressions', () => {
    const ctx = context(); const getter = vi.fn(() => 'unexpected');
    ctx.formData.inherited = Object.create({ amount: 500 });
    Object.defineProperty(ctx.formData, 'accessor', { get: getter });
    for (const path of ['formData.inherited.amount', 'formData.accessor', 'formData.__proto__', 'formData.constructor',
      'formData.object.prototype', 'formData.amount + 1', 'formData.assets[0]', 'system.unknown']) {
      expect(() => resolveWorkflowAutomationVariable(path, ctx)).toThrow(WorkflowAutomationTemplateError);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it('does not recursively execute template text contained in referenced data', () => {
    const ctx = context(); ctx.formData.note = '{{formData.missing}}';
    expect(renderWorkflowAutomationValue('{{formData.note}}', ctx)).toBe('{{formData.missing}}');
    expect(renderWorkflowAutomationText('说明：{{formData.note}}', ctx)).toBe('说明：{{formData.missing}}');
  });
  it('rejects non-finite numeric values at the JSON mapping boundary', () => {
    const ctx = context();
    for (const amount of [NaN, Infinity, -Infinity]) {
      ctx.formData.amount = amount;
      expect(() => renderWorkflowAutomationValue('{{formData.amount}}', ctx)).toThrow('数值必须有限');
    }
  });
});

describe('automation webhook JSON bodies', () => {
  it('renders JSON string nodes into typed values without breaking quoted descriptions', () => {
    const ctx = context();
    const body = renderWorkflowAutomationBody('{"amount":"{{formData.amount}}","reviewers":"{{formData.reviewers}}",'
      + '"flag":"{{formData.purchased}}","description":"经办={{formData.nested.buyer.name}}","extra":"{{formData.object}}"}', ctx);
    expect(body).toEqual({ kind: 'json', value: { amount: 28000, reviewers: [9, 10], flag: false,
      description: '经办=张"采购"\n经办', extra: ctx.formData.object } });
    expect(JSON.parse(JSON.stringify(body.value))).toEqual(body.value);
  });
  it('supports a whole JSON value, nested arrays and plain text separately', () => {
    expect(renderWorkflowAutomationBody('{{formData.assets}}', context())).toEqual({ kind: 'json', value: [{ name: '国产电脑', quantity: 4 }] });
    expect(renderWorkflowAutomationBody('["{{formData.reviewers}}", {"approved":"{{system.status}}"}]', context())).toEqual({ kind: 'json', value: [[9, 10], { approved: 'approved' }] });
    expect(renderWorkflowAutomationBody('报销金额={{formData.amount}}', context())).toEqual({ kind: 'text', value: '报销金额=28000' });
  });
  it('rejects malformed JSON and unknown references before any HTTP request', () => {
    expect(() => renderWorkflowAutomationBody('{"amount":{{formData.amount}}}', context())).toThrow('Webhook JSON 模板格式无效');
    expect(() => renderWorkflowAutomationBody('{"amount":"{{formData.missing}}"}', context())).toThrow('自动化变量不存在');
  });
  it('uses one syntax boundary for saved Server/Demo actions', () => {
    expect(() => assertWorkflowAutomationTemplateSyntax({ type: 'startWorkflow', definitionId: 3, formMapping: { amount: '{{amount}}' } })).toThrow(WorkflowAutomationTemplateError);
    expect(() => assertWorkflowAutomationTemplateSyntax({ type: 'webhook', url: 'https://example.test/{{system.instanceId}}',
      bodyTemplate: '{"people":"{{formData.reviewers}}"}' })).not.toThrow();
    expect(() => renderWorkflowAutomationText('{{formData.amount', context())).toThrow('括号不完整');
  });
  it('keeps HTTP authority fixed while permitting encoded variables in paths and queries', () => {
    for (const url of ['https://{{formData.host}}/erp', 'https://example.test:{{formData.port}}/erp', 'https://example.test/erp#{{system.instanceId}}']) {
      expect(() => assertWorkflowAutomationTemplateSyntax({ type: 'webhook', url })).toThrow('协议和主机必须固定');
    }
    expect(() => assertWorkflowAutomationTemplateSyntax({ type: 'webhook', url: 'https://example.test/erp/{{system.instanceId}}?vendor={{formData.vendor}}' })).not.toThrow();
  });
});
