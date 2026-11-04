import { describe, expect, it, vi } from 'vitest';
import type { WorkflowDefinitionSnapshot } from '@zenith/shared/workflow';

const mocks = vi.hoisted(() => ({ adapter: { businessType: 'example.request' } }));

import { registerWorkflowBusinessAdapter, sealWorkflowBusinessAdapters, getWorkflowBusinessAdapter, getWorkflowDefinitionBusinessAdapter, getWorkflowInstanceBusinessAdapter } from './workflow-business';

registerWorkflowBusinessAdapter(mocks.adapter);
sealWorkflowBusinessAdapters();

const definition = (businessType?: string, formType: WorkflowDefinitionSnapshot['formType'] = 'custom'): WorkflowDefinitionSnapshot => ({
  id: 1, name: 'Example', description: null, categoryId: null, formId: null, formType,
  customForm: { businessType, createComponent: 'biz/example/Form' }, flowData: null,
  status: 'published', version: 1, tenantId: null,
});

describe('workflow business adapter boundary', () => {
  it('freezes registered adapters and rejects late registration', () => {
    expect(Object.isFrozen(getWorkflowBusinessAdapter('example.request'))).toBe(true);
    expect(() => registerWorkflowBusinessAdapter({ businessType: 'late' })).toThrow('冻结');
  });
  it('looks up a declared adapter without interpreting any business fields', () => {
    expect(getWorkflowBusinessAdapter('example.request')).toEqual(mocks.adapter);
    expect(getWorkflowDefinitionBusinessAdapter(definition('example.request'))).toEqual(mocks.adapter);
  });
  it('preserves ordinary designer and unbound custom/external workflows', () => {
    expect(getWorkflowDefinitionBusinessAdapter(definition())).toBeUndefined();
    expect(getWorkflowDefinitionBusinessAdapter(definition('unknown', 'designer'))).toBeUndefined();
    expect(getWorkflowDefinitionBusinessAdapter(definition('unknown', 'external'))).toBeUndefined();
  });
  it('rejects an unregistered custom business type instead of silently skipping its rules', () => {
    expect(() => getWorkflowDefinitionBusinessAdapter(definition('not-installed'))).toThrow('未注册');
  });
  it('resolves attached instances and rejects missing or mismatching frozen links', () => {
    expect(getWorkflowInstanceBusinessAdapter({ bizType: 'example.request', definitionSnapshot: definition('example.request') })).toEqual(mocks.adapter);
    expect(() => getWorkflowInstanceBusinessAdapter({ bizType: null, definitionSnapshot: definition('example.request') })).toThrow('业务关联');
    expect(() => getWorkflowInstanceBusinessAdapter({ bizType: 'other.request', definitionSnapshot: definition('example.request') })).toThrow('业务关联');
  });
});
