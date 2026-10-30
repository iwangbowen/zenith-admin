import { describe, it, expect } from 'vitest';
import { WORKFLOW_ADVANCING_JOB_TYPES } from './engine';

describe('WORKFLOW_ADVANCING_JOB_TYPES', () => {
  it('不包含 trigger_dispatch：fire-and-forget 触发器是"已发生事实"的外呼副作用，终态清场取消会导致紧邻结束节点的触发器永不执行', () => {
    expect(WORKFLOW_ADVANCING_JOB_TYPES).not.toContain('trigger_dispatch');
  });

  it('不包含通知类作业（领域事件消费者 / Webhook 投递）', () => {
    expect(WORKFLOW_ADVANCING_JOB_TYPES).not.toContain('webhook_delivery');
    expect(WORKFLOW_ADVANCING_JOB_TYPES).not.toContain('node_listener_delivery');
  });

  it('包含全部推进类作业', () => {
    expect([...WORKFLOW_ADVANCING_JOB_TYPES].sort()).toEqual(
      ['delay_wake', 'external_dispatch', 'subprocess_join', 'subprocess_spawn', 'task_timeout'].sort(),
    );
  });
});
