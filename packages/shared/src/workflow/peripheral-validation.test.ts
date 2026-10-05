import { describe, expect, it } from 'vitest';
import {
  createWorkflowConnectorSchema, updateWorkflowConnectorSchema, validateWorkflowConnectorConfig,
  createWorkflowScheduleSchema, updateWorkflowScheduleSchema,
  createWorkflowEventSubscriptionSchema, updateWorkflowEventSubscriptionSchema,
} from './validation';

const connector = { name: '采购归档', code: 'purchase-archive' };
const schedule = { definitionId: 2, name: '月度报销', initiatorId: 3, cronExpression: '0 9 1 * *' };
const subscription = { name: '合同归档', events: ['instance.approved'] as const };

describe('workflow peripheral configuration contracts', () => {
  it('requires actual HTTP configuration instead of saving an unusable empty connector', () => {
    expect(createWorkflowConnectorSchema.safeParse({ ...connector, type: 'http', config: {} }).success).toBe(false);
    expect(createWorkflowConnectorSchema.safeParse({ ...connector, type: 'http', config: { baseUrl: 'https://erp.example.com' } }).success).toBe(true);
  });

  it('accepts email and SMS channel configuration without requiring an HTTP base URL', () => {
    expect(createWorkflowConnectorSchema.safeParse({ ...connector, type: 'email', config: { to: 'finance@example.com', subject: '审批结果' } }).success).toBe(true);
    expect(createWorkflowConnectorSchema.safeParse({ ...connector, type: 'sms', config: { phone: '13800000000', templateCode: 'purchase-approved' } }).success).toBe(true);
  });

  it('rejects HTTP-shaped configuration for email and SMS', () => {
    const config = { baseUrl: 'https://erp.example.com', method: 'GET' };
    expect(createWorkflowConnectorSchema.safeParse({ ...connector, type: 'email', config }).success).toBe(false);
    expect(createWorkflowConnectorSchema.safeParse({ ...connector, type: 'sms', config }).success).toBe(false);
  });

  it('normalizes multiple email recipients and rejects invalid addresses', () => {
    const good = validateWorkflowConnectorConfig('email', { to: ' finance@example.com；manager@example.com ', subject: ' 审批结果 ' });
    expect(good.success && good.data).toEqual({ to: 'finance@example.com,manager@example.com', subject: '审批结果' });
    expect(validateWorkflowConnectorConfig('email', { to: 'not-an-address', subject: '审批结果' }).success).toBe(false);
  });

  it.each(['', 'invalid', '+1abc', '123'])('rejects invalid SMS destination %s', phone => {
    expect(validateWorkflowConnectorConfig('sms', { phone, templateCode: 'purchase-approved' }).success).toBe(false);
  });

  it('does not reset omitted connector fields during a name-only update', () => {
    expect(updateWorkflowConnectorSchema.parse({ name: '新的名称' })).toEqual({ name: '新的名称' });
  });

  it.each(['*/10 * * * * *', '0 0 9 * * MON'])('rejects a seconds-based workflow schedule %s', cronExpression => {
    expect(createWorkflowScheduleSchema.safeParse({ ...schedule, cronExpression }).success).toBe(false);
    expect(updateWorkflowScheduleSchema.safeParse({ cronExpression }).success).toBe(false);
  });

  it('accepts five-field schedules and preserves omitted planning fields in updates', () => {
    expect(createWorkflowScheduleSchema.safeParse(schedule).success).toBe(true);
    expect(updateWorkflowScheduleSchema.parse({ name: '更名' })).toEqual({ name: '更名' });
  });

  it('requires a connector for relative subscription addresses', () => {
    expect(createWorkflowEventSubscriptionSchema.safeParse({ ...subscription, url: '/contracts' }).success).toBe(false);
    expect(createWorkflowEventSubscriptionSchema.safeParse({ ...subscription, url: '/contracts', connectorId: 2 }).success).toBe(true);
    expect(createWorkflowEventSubscriptionSchema.safeParse({ ...subscription, url: 'https://erp.example.com/contracts' }).success).toBe(true);
  });

  it('allows partial subscription edits to be validated against the persisted connector', () => {
    expect(updateWorkflowEventSubscriptionSchema.parse({ url: '/new-contracts' })).toEqual({ url: '/new-contracts' });
    expect(updateWorkflowEventSubscriptionSchema.parse({ name: '更名' })).toEqual({ name: '更名' });
  });

  it.each(['//outside.example.com', 'javascript:alert(1)', '\\\\outside.example.com', 'http:malformed'])('rejects malformed callback %s', url => {
    expect(createWorkflowEventSubscriptionSchema.safeParse({ ...subscription, url, connectorId: 2 }).success).toBe(false);
  });
});
