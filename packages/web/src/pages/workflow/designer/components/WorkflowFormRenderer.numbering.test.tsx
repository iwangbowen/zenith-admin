import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import WorkflowFormRenderer from './WorkflowFormRenderer';

const fields: WorkflowFormField[] = [
  { key: 'number', label: '流程编号', type: 'serialNumber', defaultValue: 'FORGED-DEFAULT' },
  { key: 'reason', label: '事由', type: 'text' },
];

describe('流程实例编号控件', () => {
  it('只显示实例元数据，不显示或提交表单伪造值', async () => {
    let api: FormApi | undefined;
    render(<WorkflowFormRenderer fields={fields} instanceSerialNo="WF-20261011-0001" initValues={{ number: 'FORGED-CLIENT', reason: '采购' }} getFormApi={value => { api = value; }} />);
    expect(screen.getByText('WF-20261011-0001')).toBeInTheDocument();
    expect(screen.queryByText('FORGED-CLIENT')).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue('FORGED-CLIENT')).not.toBeInTheDocument();
    await waitFor(() => expect(api?.getValues()).toEqual({ reason: '采购' }));
    expect(await api?.validate()).toEqual({ reason: '采购' });
  });

  it('草稿和设计预览不制造编号，也不提交默认值', async () => {
    let api: FormApi | undefined;
    render(<WorkflowFormRenderer fields={fields} getFormApi={value => { api = value; }} />);
    expect(screen.queryByText('FORGED-DEFAULT')).not.toBeInTheDocument();
    await waitFor(() => expect(api?.getValues()).not.toHaveProperty('number'));
  });

  it('查看态在实例编号返回后更新，并清除嵌套容器中的伪造表单值', async () => {
    const nested: WorkflowFormField[] = [{ key: 'group', label: '单据信息', type: 'group', children: fields }];
    let api: FormApi | undefined;
    const view = render(<WorkflowFormRenderer fields={nested} readOnly readOnlyAsText initValues={{ number: 'FORGED', reason: '采购' }} getFormApi={value => { api = value; }} />);
    view.rerender(<WorkflowFormRenderer fields={nested} readOnly readOnlyAsText instanceSerialNo="WF-20261011-0002" initValues={{ number: 'FORGED', reason: '采购' }} getFormApi={value => { api = value; }} />);
    expect(screen.getByText('WF-20261011-0002')).toBeInTheDocument();
    expect(screen.queryByText('FORGED')).not.toBeInTheDocument();
    await waitFor(() => expect(api?.getValues()).not.toHaveProperty('number'));
  });
});
