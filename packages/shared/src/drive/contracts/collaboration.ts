import * as z from 'zod';
import { dateRangeBound, idParam, paginated, paginationQuery } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { DRIVE_ACTIVITY_ACTIONS } from '../constants';
import { driveMetadataSchema, updateDriveNodeCommentSchema, updateDriveNodeProfileSchema } from '../validation';
import { driveActivitySchema, driveNodeCommentParams, driveNodeCommentSchema } from './nodes';

export const driveNodeProfileSchema = z.object({
  nodeId: z.int(),
  description: z.string().nullable(),
  metadata: driveMetadataSchema,
}).meta({ id: 'DriveNodeProfile' });
export type DriveNodeProfile = z.infer<typeof driveNodeProfileSchema>;

export const driveSpaceActivitiesQuery = paginationQuery.extend({
  keyword: z.string().optional(),
  action: z.enum(DRIVE_ACTIVITY_ACTIONS).optional(),
  startTime: dateRangeBound('开始时间'),
  endTime: dateRangeBound('结束时间'),
});

export const driveCollaborationContract = defineContract('/api/drive/collaboration', {
  profile: op.get('/nodes/{id}/profile', { params: idParam, response: driveNodeProfileSchema, summary: '文件说明与自定义属性' }),
  saveProfile: op.put('/nodes/{id}/profile', { params: idParam, body: updateDriveNodeProfileSchema, response: driveNodeProfileSchema, summary: '更新文件说明与属性' }),
  subscription: op.get('/nodes/{id}/subscription', { params: idParam, response: z.boolean(), summary: '我的文件关注状态' }),
  subscribe: op.put('/nodes/{id}/subscription', { params: idParam, body: z.object({ subscribed: z.boolean() }), response: z.boolean(), summary: '关注或取消关注文件变更' }),
  editComment: op.put('/nodes/{id}/comments/{commentId}', { params: driveNodeCommentParams, body: updateDriveNodeCommentSchema, response: driveNodeCommentSchema, summary: '编辑文件评论' }),
  spaceActivities: op.get('/spaces/{id}/activities', { params: idParam, query: driveSpaceActivitiesQuery, response: paginated(driveActivitySchema), summary: '空间动态（按当前文件权限过滤）' }),
}, { tags: ['企业网盘-协作'] });
