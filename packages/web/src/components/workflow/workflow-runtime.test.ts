/**
 * 运行数据归属测试：协办必须归到邀请任务所属节点，不能制造不存在的节点或改变节点状态。
 */
import { describe, expect, it } from 'vitest';
import type { WorkflowTask, WorkflowTaskConsult } from '@zenith/shared/workflow';
import { buildNodeRuntimeMap } from './workflow-runtime';

function task(overrides: Partial<WorkflowTask> & Pick<WorkflowTask, 'id' | 'nodeKey'>): WorkflowTask {
  return {
    instanceId: 1, nodeName: '直属主管审批', nodeType: 'approve', activationId: 'a1', slotId: 1,
    taskKind: 'approval', waitReason: null, activatedAt: null, signPosition: null,
    assigneeId: 4, assigneeName: '李四', status: 'approved', comment: null, actionAt: null,
    createdAt: '2026-10-11 20:15:56',
    ...overrides,
  };
}

function consult(overrides: Partial<WorkflowTaskConsult> & Pick<WorkflowTaskConsult, 'id' | 'taskId'>): WorkflowTaskConsult {
  return {
    instanceId: 1, nodeName: '直属主管审批', inviterId: 4, inviterName: '李四',
    consulteeId: 5, consulteeName: '王五', question: null, opinion: null,
    status: 'pending', repliedAt: null, createdAt: '2026-10-11 20:20:00',
    ...overrides,
  };
}

describe('buildNodeRuntimeMap', () => {
  it('把协办按邀请任务归到所属节点，不改变节点状态', () => {
    const map = buildNodeRuntimeMap(
      [task({ id: 25, nodeKey: 'approve_manager' }), task({ id: 26, nodeKey: 'approve_finance', nodeName: '财务复核', assigneeName: '王五' })],
      [consult({ id: 2, taskId: 25, status: 'replied', opinion: '建议同意', repliedAt: '2026-10-11 20:25:00' })],
    );

    expect(map.get('approve_manager')?.status).toBe('approved');
    expect(map.get('approve_manager')?.consults).toEqual([
      { consulteeName: '王五', avatar: null, status: 'replied', question: null, opinion: '建议同意', repliedAt: '2026-10-11 20:25:00' },
    ]);
    expect(map.get('approve_finance')?.consults).toBeUndefined();
  });

  it('没有对应任务的协办不凭空造节点，未填姓名时回退到 #ID', () => {
    const map = buildNodeRuntimeMap(
      [task({ id: 25, nodeKey: 'approve_manager' })],
      [consult({ id: 3, taskId: 999 }), consult({ id: 4, taskId: 25, consulteeName: null })],
    );

    expect(map.size).toBe(1);
    expect(map.get('approve_manager')?.consults).toHaveLength(1);
    expect(map.get('approve_manager')?.consults?.[0].consulteeName).toBe('用户#5');
  });
});
