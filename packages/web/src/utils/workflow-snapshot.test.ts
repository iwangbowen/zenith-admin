import { describe, expect, it } from 'vitest';
import type { WorkflowFlowData } from '@zenith/shared/workflow';
import { pickPendingConditionValues } from './workflow-snapshot';

const flow = {
  nodes: [],
  edges: [{
    id: 'e1',
    source: 'gw',
    target: 'next',
    conditions: [{ type: 'and', rules: [{ field: 'action', operator: 'eq', value: '正常' }] }],
  }],
} as unknown as WorkflowFlowData;

describe('pickPendingConditionValues', () => {
  it('只保留分支条件引用到的字段', () => {
    expect(pickPendingConditionValues(flow, { action: '疑难', title: '无关字段' })).toEqual({ action: '疑难' });
  });

  it('没有引用字段时返回 undefined，避免空查询参数', () => {
    expect(pickPendingConditionValues(flow, { title: '无关字段' })).toBeUndefined();
    expect(pickPendingConditionValues(flow, null)).toBeUndefined();
    expect(pickPendingConditionValues(null, { action: '正常' })).toBeUndefined();
  });

  it('序列化超长时退化为不传，避免超出接口参数上限', () => {
    expect(pickPendingConditionValues(flow, { action: 'x'.repeat(8000) })).toBeUndefined();
  });
});
