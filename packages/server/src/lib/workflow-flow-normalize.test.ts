import { describe, expect, it } from 'vitest';
import { applyFlowAssigneeNames, collectFlowAssigneeIds, normalizeDefinitionFlowData } from './workflow-flow-normalize';
const graph = () => ({ nodes: [
  { id: 'start', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } },
  { id: 'legal', position: { x: 0, y: 120 }, data: { key: 'legal', type: 'approve', label: '法务', assigneeType: 'user', assigneeIds: [17, 13] } },
  { id: 'end', position: { x: 0, y: 240 }, data: { key: 'end', type: 'end', label: '结束' } },
], edges: [{ id: 'e1', source: 'start', target: 'legal' }, { id: 'e2', source: 'legal', target: 'end' }] });
describe('canonical graph write boundary', () => {
  it('rejects a persisted tree', () => { expect(() => normalizeDefinitionFlowData({ ...graph(), process: { initiator: {} } })).toThrow(); });
  it('rejects incompatible condition values', () => { expect(() => normalizeDefinitionFlowData({ ...graph(), edges: [{ id: 'e1', source: 'start', target: 'legal', condition: { field: 'amount', operator: 'in', value: [1, 2] } }] })).toThrow(); });
  it('keeps cycles and exception edge metadata', () => { const input = { ...graph(), edges: [...graph().edges, { id: 'retry', source: 'legal', target: 'start', isException: true, label: '补充复核' }] }; expect(normalizeDefinitionFlowData(input)?.edges).toEqual(input.edges); });
  it('is idempotent and accepts an empty draft', () => { const once = normalizeDefinitionFlowData(graph()); expect(normalizeDefinitionFlowData(once)).toEqual(once); expect(normalizeDefinitionFlowData({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] }); expect(normalizeDefinitionFlowData(null)).toBeNull(); });
  it('enriches names without mutating source', () => { const input = graph(); expect(collectFlowAssigneeIds(input)).toEqual([17, 13]); const output = applyFlowAssigneeNames(input, new Map([[17, '张律师']])); expect(output?.nodes[1].data.assigneeNames).toEqual(['张律师', '用户#13']); expect(input.nodes[1].data).not.toHaveProperty('assigneeNames'); });
});
