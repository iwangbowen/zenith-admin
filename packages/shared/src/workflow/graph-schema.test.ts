import { describe, expect, it } from 'vitest';
import { workflowFlowDataSchema } from './graph-schema';
import { createWorkflowDefinitionSchema, updateWorkflowDefinitionSchema, importWorkflowDefinitionSchema, createWorkflowTemplateSchema, updateWorkflowTemplateSchema, simulateWorkflowSchema, workflowHealthCheckSchema } from './validation';
import { SEED_WORKFLOW_DEFINITIONS, SEED_WORKFLOW_TEMPLATES } from '../seed/workflow';
const graph = { nodes: [{ id: 'start', position: { x: 0, y: 0 }, data: { key: 'start', type: 'start', label: '开始' } }], edges: [] };
describe('canonical workflow graph contract', () => {
  it.each([
    ['create definition', createWorkflowDefinitionSchema], ['update definition', updateWorkflowDefinitionSchema],
    ['import definition', importWorkflowDefinitionSchema], ['create template', createWorkflowTemplateSchema], ['update template', updateWorkflowTemplateSchema],
    ['simulation', simulateWorkflowSchema], ['health check', workflowHealthCheckSchema],
  ])('%s rejects a second persisted process model', (_name, schema) => {
    expect(schema.safeParse({ name: '测试', flowData: graph }).success).toBe(true);
    expect(schema.safeParse({ name: '测试', flowData: { ...graph, process: { initiator: {} } } }).success).toBe(false);
  });
  it('rejects incomplete graph nodes and unknown edge fields', () => {
    expect(workflowFlowDataSchema.safeParse({ nodes: [{ id: 'x', data: { type: 'approve' } }], edges: [] }).success).toBe(false);
    expect(workflowFlowDataSchema.safeParse({ ...graph, edges: [{ id: 'e', source: 'start', target: 'start', branchProps: {} }] }).success).toBe(false);
  });
  it('all official definitions and templates satisfy the same graph contract', () => {
    for (const item of [...SEED_WORKFLOW_DEFINITIONS, ...SEED_WORKFLOW_TEMPLATES]) {
      const parsed = workflowFlowDataSchema.safeParse(item.flowData);
      expect(parsed.success, item.name + ': ' + JSON.stringify(parsed.error?.issues)).toBe(true);
    }
  });
});
