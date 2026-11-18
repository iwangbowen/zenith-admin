import { describe, expect, it } from 'vitest';
import { notificationEventKeysInGroup, NOTIFICATION_EVENTS } from './notification-events';
import { inAppMessageContract } from './contracts/in-app-messages';

describe('notification inbox event scope', () => {
  it('uses catalog membership for every workflow event, including comments and consultations', () => {
    const keys = notificationEventKeysInGroup('workflow');
    expect(keys).toEqual(Object.entries(NOTIFICATION_EVENTS).filter(([, event]) => event.group === 'workflow').map(([key]) => key));
    expect(keys).toEqual(expect.arrayContaining(['workflow.task.created', 'workflow.task.cc', 'workflow.comment.mentioned', 'workflow.consult.invited', 'workflow.instance.returned', 'workflow.automation.message']));
    expect(keys).not.toContain('ops.monitor.alert');
  });
  it('shares the same validated group filter for lists, counts and mark-all', () => {
    for (const schema of [inAppMessageContract.list.query, inAppMessageContract.unreadCount.query, inAppMessageContract.markAllRead.body]) {
      expect(schema.safeParse({ eventGroup: 'workflow' }).success).toBe(true);
      expect(schema.safeParse({ eventGroup: 'not-a-group' }).success).toBe(false);
      expect(schema.safeParse({}).success).toBe(true);
    }
  });
});
