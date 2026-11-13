import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Form } from '@douyinfe/semi-ui';
import type { NumberingRuleOption } from '@zenith/shared/platform';
import { WorkflowNumberingSettings } from './WorkflowNumberingSettings';

const state = vi.hoisted(() => ({ data: [] as NumberingRuleOption[], isFetching: false, isError: false }));
vi.mock('@/hooks/queries/numbering', () => ({ useNumberingRuleOptions: () => state }));
vi.mock('@/hooks/queries/report-print', () => ({ useWorkflowPrintTemplateOptions: () => ({ data: { list: [] }, isPending: false }) }));

const rule: NumberingRuleOption = { id: 7, code: 'workflow.custom', name: '审批编号', scene: 'workflow.instance', currentVersion: 2,
  versionId: 31, template: 'WF-{YYYYMMDD}-{categoryCode}-{SEQ:4}', requiredParameters: ['categoryCode'] };

beforeEach(() => { state.data = [rule]; state.isFetching = false; state.isError = false; });

describe('工作流编号规则引用', () => {
  it('选择规则时固定真实版本ID，并要求映射声明的业务参数', async () => {
    const onChange = vi.fn();
    const view = render(<Form><WorkflowNumberingSettings formFields={[{ key: 'category', label: '采购类别', type: 'text' }]} readOnly={false} onChange={onChange} /></Form>);
    fireEvent.click(screen.getByRole('combobox', { name: '流程编号规则' }));
    fireEvent.click(await screen.findByText('审批编号 · v2'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ ruleId: 7, versionId: 31, parameterMapping: {} }));
    view.rerender(<Form><WorkflowNumberingSettings value={{ ruleId: 7, versionId: 31, parameterMapping: {} }} formFields={[{ key: 'category', label: '采购类别', type: 'text' }]} readOnly={false} onChange={onChange} /></Form>);
    fireEvent.click(screen.getByRole('combobox', { name: '编号业务分类字段' }));
    fireEvent.click(await screen.findByText('采购类别（category）'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ ruleId: 7, versionId: 31, parameterMapping: { categoryCode: 'formData.category' } }));
  });

  it('保留已固定的历史版本，不因lookup最新版本变化自动升级', () => {
    const onChange = vi.fn();
    render(<Form><WorkflowNumberingSettings value={{ ruleId: 7, versionId: 20, parameterMapping: {} }} formFields={[]} readOnly={false} onChange={onChange} /></Form>);
    expect(onChange).not.toHaveBeenCalled();
  });
  it('自动匹配多个FORM字段编码或唯一名称，并保存真实字段映射', async () => {
    state.data = [{ ...rule, template: '{FORM.地区}-{SEQ:2}-{FORM.category}', requiredParameters: ['FORM.地区', 'FORM.category'] }];
    const fields = [{ key: 'regionCode', label: '地区', type: 'text' as const }, { key: 'category', label: '业务分类', type: 'select' as const }];
    const onChange = vi.fn();
    render(<Form><WorkflowNumberingSettings formFields={fields} readOnly={false} onChange={onChange} /></Form>);
    fireEvent.click(screen.getByRole('combobox', { name: '流程编号规则' }));
    fireEvent.click(await screen.findByText('审批编号 · v2'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ ruleId: 7, versionId: 31,
      parameterMapping: { 'FORM.地区': 'formData.regionCode', 'FORM.category': 'formData.category' } }));
  });
  it('同名FORM字段要求显式选择，修正一个字段不会清空其他映射', async () => {
    state.data = [{ ...rule, template: '{FORM.地区}-{SEQ}', requiredParameters: ['FORM.地区'] }];
    const onChange = vi.fn();
    render(<Form><WorkflowNumberingSettings value={{ ruleId: 7, versionId: 31, parameterMapping: {} }} formFields={[
      { key: 'region1', label: '地区', type: 'text' }, { key: 'region2', label: '地区', type: 'text' },
    ]} readOnly={false} onChange={onChange} /></Form>);
    fireEvent.click(screen.getByRole('combobox', { name: '编号表单字段 {FORM.地区}' }));
    fireEvent.click(await screen.findByText('地区（region2）'));
    await waitFor(() => expect(onChange).toHaveBeenLastCalledWith({ ruleId: 7, versionId: 31, parameterMapping: { 'FORM.地区': 'formData.region2' } }));
  });
});
