import { describe, expect, it } from 'vitest';
import { mapComment } from './report-comment.service';
import type { ReportDashboardCommentRow } from '../../db/schema';

const baseRow: ReportDashboardCommentRow = {
  id: 1,
  dashboardId: 1,
  widgetId: 'w1',
  parentId: null,
  content: 'hello',
  userId: 10,
  resolvedAt: null,
  resolvedBy: null,
  deletedAt: null,
  deletedBy: null,
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-01T00:00:00Z'),
};

describe('mapComment', () => {
  it('为作者返回编辑/删除/解决能力', () => {
    const dto = mapComment({ ...baseRow, user: { nickname: '张三', username: 'zhangsan', avatar: null } }, 10, false);
    expect(dto.userName).toBe('张三');
    expect(dto.canEdit).toBe(true);
    expect(dto.canDelete).toBe(true);
    expect(dto.canResolve).toBe(true);
  });

  it('对已注销用户显示占位名称', () => {
    const dto = mapComment({ ...baseRow, userId: null, user: null }, 1, true);
    expect(dto.userName).toBe('已注销用户');
  });

  it('对已删除评论输出占位内容', () => {
    const dto = mapComment({ ...baseRow, deletedAt: new Date('2026-01-02T00:00:00Z'), user: { nickname: null, username: 'tester', avatar: null } }, 99, true);
    expect(dto.content).toBe('该评论已删除');
  });
});
