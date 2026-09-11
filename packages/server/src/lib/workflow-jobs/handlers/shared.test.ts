import { describe, expect, it } from 'vitest';
import { renderWorkflowTemplate } from './shared';

describe('renderWorkflowTemplate', () => {
  const formData = { name: '张三', amount: 1200, ok: true, big: 10n, tags: ['a'], meta: { x: 1 }, empty: null };
  const extras = { instanceId: '42', nodeKey: 'approve', error: 'timeout' };

  it('替换表单标量与 extras 占位符', () => {
    expect(renderWorkflowTemplate('{{form.name}} 申请 {{form.amount}} 元（{{form.ok}}/{{form.big}}）#{{instanceId}}@{{nodeKey}}: {{error}}', formData, extras))
      .toBe('张三 申请 1200 元（true/10）#42@approve: timeout');
  });

  it('空值 / 对象 / 未知占位符渲染为空串', () => {
    expect(renderWorkflowTemplate('[{{form.empty}}][{{form.tags}}][{{form.meta}}][{{form.missing}}][{{unknown}}]', formData, extras))
      .toBe('[][][][][]');
  });

  it('表单键允许两侧空白，extras 缺省为空对象', () => {
    expect(renderWorkflowTemplate('{{form. name }}/{{instanceId}}', formData)).toBe('张三/');
  });
});
