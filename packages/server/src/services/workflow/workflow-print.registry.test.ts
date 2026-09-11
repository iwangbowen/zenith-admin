/**
 * 审批表单 PII 字段登记：服务模块加载即把 WorkflowForm.phone / email / idCard 登记进敏感字段注册表，
 * 「数据脱敏」策略页据此列出可配置项。用真实注册表验证（mock 只隔离数据访问依赖）。
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./instances/queries', () => ({ getInstanceDetail: vi.fn() }));
vi.mock('../report/report-print.service', () => ({ loadEntityPrintTemplate: vi.fn() }));
vi.mock('../platform/dicts.service', () => ({ listDictItemsByCode: vi.fn() }));
vi.mock('./workflow-user-helpers', () => ({ loadWorkflowUserDisplays: vi.fn() }));
vi.mock('../../lib/context', () => ({ currentUser: () => ({ userId: 9, username: 'x', roles: [], tenantId: null }) }));
vi.mock('../../db', () => ({ db: {} }));

import { listSensitiveFieldEntries } from '../../lib/data-mask/registry';
import './workflow-print.service';

describe('workflow-print sensitive field registration', () => {
  it('登记 WorkflowForm 的手机号 / 邮箱 / 证件号三类字段，来源标记为 PRINT workflow_instance', () => {
    const entries = listSensitiveFieldEntries().filter((entry) => entry.entity === 'WorkflowForm');
    expect(entries.map((entry) => `${entry.field}:${entry.kind}`).sort()).toEqual(['email:email', 'idCard:id_card', 'phone:phone']);
    expect(entries.every((entry) => entry.operations.includes('PRINT workflow_instance'))).toBe(true);
  });
});
