import * as z from 'zod';
import { idParam, paginated } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { lazyRecursive } from '../../core/validation';
import { REPORT_DASHBOARD_VERSION_SOURCES } from '../constants';
import { REPORT_WIDGET_TYPES } from '../types';
import {
  createReportCommentSchema,
  createReportEmbedTokenSchema,
  createReportShareSchema,
  createReportVersionSchema,
  reportCommentListQuerySchema,
  reportVersionDiffQuerySchema,
  resolveReportCommentSchema,
  restoreReportVersionSchema,
  updateReportCommentSchema,
  updateReportShareSchema,
} from '../validation';
import { reportDashboardSnapshotSchema } from './dashboards';

// ─── 版本 ────────────────────────────────────────────────────────────────────

export const reportDashboardVersionSchema = z.object({
  id: z.int(),
  dashboardId: z.int(),
  version: z.int(),
  snapshot: reportDashboardSnapshotSchema,
  source: z.enum(REPORT_DASHBOARD_VERSION_SOURCES),
  remark: z.string().nullable().optional(),
  createdBy: z.int().nullable().optional(),
  createdAt: z.string(),
}).meta({ id: 'ReportDashboardVersion' });

export type ReportDashboardVersion = z.infer<typeof reportDashboardVersionSchema>;

export const reportDashboardVersionWidgetChangeSchema = z.object({
  id: z.string(),
  title: z.string(),
  type: z.enum(REPORT_WIDGET_TYPES),
  changedFields: z.array(z.string()).optional(),
}).meta({ id: 'ReportDashboardVersionWidgetChange' });

export type ReportDashboardVersionWidgetChange = z.infer<typeof reportDashboardVersionWidgetChangeSchema>;

export const reportDashboardVersionDiffSchema = z.object({
  leftLabel: z.string(),
  rightLabel: z.string(),
  summary: z.array(z.string()),
  widgets: z.object({
    added: z.array(reportDashboardVersionWidgetChangeSchema),
    removed: z.array(reportDashboardVersionWidgetChangeSchema),
    modified: z.array(reportDashboardVersionWidgetChangeSchema),
  }),
  layoutChanged: z.boolean(),
  filtersChanged: z.boolean(),
  configChanged: z.boolean(),
  metadataChanged: z.boolean(),
}).meta({ id: 'ReportDashboardVersionDiff' });

export type ReportDashboardVersionDiff = z.infer<typeof reportDashboardVersionDiffSchema>;

// ─── 公开分享 / 嵌入令牌 ─────────────────────────────────────────────────────

export const reportDashboardShareSchema = z.object({
  id: z.int(),
  dashboardId: z.int(),
  token: z.string(),
  enabled: z.boolean(),
  hasPassword: z.boolean().optional(),
  expireAt: z.string().nullable().optional(),
  maxAccessCount: z.int().nullable().optional(),
  allowedCidrs: z.array(z.string()).optional(),
  allowedIps: z.array(z.string()).optional(),
  accessCount: z.int().optional().meta({ description: '累计访问次数（只读聚合，含被拒绝的尝试）' }),
  lastAccessAt: z.string().nullable().optional(),
  createdBy: z.int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDashboardShare' });

export type ReportDashboardShare = z.infer<typeof reportDashboardShareSchema>;

export const reportDashboardEmbedTokenSchema = z.object({
  id: z.int(),
  dashboardId: z.int(),
  token: z.string(),
  allowedFilterIds: z.array(z.string()),
  fixedFilters: z.record(z.string(), z.unknown()),
  expireAt: z.string().nullable().optional(),
  revokedAt: z.string().nullable().optional(),
  remark: z.string().nullable().optional(),
  createdBy: z.int().nullable().optional(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'ReportDashboardEmbedToken' });

export type ReportDashboardEmbedToken = z.infer<typeof reportDashboardEmbedTokenSchema>;

// ─── 评论（协作批注）────────────────────────────────────────────────────────

/** 仪表盘评论；自引用结构（replies），类型需手写供递归 schema 标注 */
export type ReportDashboardComment = {
  id: number;
  dashboardId: number;
  widgetId?: string | null;
  parentId?: number | null;
  content: string;
  userId?: number | null;
  userName?: string | null;
  userAvatar?: string | null;
  resolvedAt?: string | null;
  resolvedBy?: number | null;
  resolvedByName?: string | null;
  deletedAt?: string | null;
  updatedAt: string;
  createdAt: string;
  replies?: ReportDashboardComment[];
  canEdit?: boolean;
  canDelete?: boolean;
  canResolve?: boolean;
};

export const reportDashboardCommentSchema: z.ZodType<ReportDashboardComment> = lazyRecursive(() => z.object({
  id: z.int(),
  dashboardId: z.int(),
  widgetId: z.string().nullable().optional().meta({ description: '关联组件 id（可空 = 整盘评论）' }),
  parentId: z.int().nullable().optional(),
  content: z.string(),
  userId: z.int().nullable().optional(),
  userName: z.string().nullable().optional(),
  userAvatar: z.string().nullable().optional(),
  resolvedAt: z.string().nullable().optional(),
  resolvedBy: z.int().nullable().optional(),
  resolvedByName: z.string().nullable().optional(),
  deletedAt: z.string().nullable().optional(),
  updatedAt: z.string(),
  createdAt: z.string(),
  replies: z.array(reportDashboardCommentSchema).optional(),
  canEdit: z.boolean().optional(),
  canDelete: z.boolean().optional(),
  canResolve: z.boolean().optional(),
})).meta({ id: 'ReportDashboardComment' });

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const reportVersionRestoreParam = z.object({
  id: z.coerce.number().int().positive().meta({ description: '仪表盘 ID', example: 1 }),
  versionId: z.coerce.number().int().positive().meta({ description: '版本 ID', example: 1 }),
});

export const reportShareIdParam = z.object({
  shareId: z.coerce.number().int().positive().meta({ description: '分享链接 ID', example: 1 }),
});

export const reportCommentIdParam = z.object({
  id: z.coerce.number().int().positive().meta({ description: '仪表盘 ID', example: 1 }),
  commentId: z.coerce.number().int().positive().meta({ description: '评论 ID', example: 1 }),
});

export const reportEmbedTokenIdParam = z.object({
  embedTokenId: z.coerce.number().int().positive().meta({ description: '嵌入令牌 ID', example: 1 }),
});

export const reportFavoriteResultSchema = z.object({ favorited: z.boolean() }).meta({ id: 'ReportDashboardFavoriteResult' });

/**
 * 仪表盘运维操作（版本 / 收藏 / 分享 / 嵌入令牌 / 评论）。
 * 与 `reportDashboardContract` 共用资源根路径；操作名在两个契约组间全局唯一。
 */
export const reportDashboardOpsContract = defineContract('/api/report/dashboards', {
  versions: op.get('/{id}/versions', { params: idParam, response: z.array(reportDashboardVersionSchema), summary: '版本列表' }),
  createVersion: op.post('/{id}/versions', { params: idParam, body: createReportVersionSchema, response: reportDashboardVersionSchema, summary: '保存版本快照' }),
  versionDiff: op.get('/{id}/versions/diff', { params: idParam, query: reportVersionDiffQuerySchema, response: reportDashboardVersionDiffSchema, summary: '版本差异比较' }),
  restoreVersion: op.post('/{id}/versions/{versionId}/restore', { params: reportVersionRestoreParam, body: restoreReportVersionSchema, summary: '恢复版本' }),
  favorite: op.post('/{id}/favorite', { params: idParam, response: reportFavoriteResultSchema, summary: '收藏 / 取消收藏' }),
  shares: op.get('/{id}/shares', { params: idParam, response: z.array(reportDashboardShareSchema), summary: '分享链接列表' }),
  createShare: op.post('/{id}/shares', { params: idParam, body: createReportShareSchema, response: reportDashboardShareSchema, summary: '创建分享链接' }),
  updateShare: op.put('/shares/{shareId}', { params: reportShareIdParam, body: updateReportShareSchema, response: reportDashboardShareSchema, summary: '更新分享链接' }),
  removeShare: op.delete('/shares/{shareId}', { params: reportShareIdParam, summary: '删除分享链接' }),
  embedTokens: op.get('/{id}/embed-tokens', { params: idParam, response: z.array(reportDashboardEmbedTokenSchema), summary: '嵌入令牌列表' }),
  createEmbedToken: op.post('/{id}/embed-tokens', { params: idParam, body: createReportEmbedTokenSchema, response: reportDashboardEmbedTokenSchema, summary: '创建嵌入令牌' }),
  revokeEmbedToken: op.post('/embed-tokens/{embedTokenId}/revoke', { params: reportEmbedTokenIdParam, summary: '撤销嵌入令牌' }),
  comments: op.get('/{id}/comments', { params: idParam, query: reportCommentListQuerySchema, response: paginated(reportDashboardCommentSchema), summary: '评论列表' }),
  createComment: op.post('/{id}/comments', { params: idParam, body: createReportCommentSchema, response: reportDashboardCommentSchema, summary: '发表评论' }),
  updateComment: op.put('/{id}/comments/{commentId}', { params: reportCommentIdParam, body: updateReportCommentSchema, response: reportDashboardCommentSchema, summary: '编辑评论' }),
  resolveComment: op.post('/{id}/comments/{commentId}/resolve', { params: reportCommentIdParam, body: resolveReportCommentSchema, response: reportDashboardCommentSchema, summary: '解决 / 重新打开评论' }),
  removeComment: op.delete('/{id}/comments/{commentId}', { params: reportCommentIdParam, summary: '删除评论' }),
}, { tags: ['报表仪表盘'] });
