import * as z from 'zod';
import { idQuery, paginated, paginationQuery, queryEnum } from '../../core/api-schemas';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { DRIVE_NODE_TYPES, DRIVE_ROLES, DRIVE_SPACE_TYPES } from '../constants';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 开放应用可见的空间：仅被治理侧显式授权的空间，附带应用在该空间的角色 */
export const openDriveSpaceSchema = z.object({
  id: z.int(),
  name: z.string(),
  type: z.enum(DRIVE_SPACE_TYPES),
  role: z.enum(DRIVE_ROLES).meta({ description: '应用在该空间的最高角色（viewer / downloader / editor）' }),
  archived: z.boolean(),
  usedBytes: z.int(),
  quotaBytes: z.int().meta({ description: '0 = 不限' }),
}).meta({ id: 'OpenDriveSpace' });

export type OpenDriveSpace = z.infer<typeof openDriveSpaceSchema>;

/** 开放应用可见的节点元数据：不暴露内部对象 id / 存储路径 / 操作人 */
export const openDriveNodeSchema = z.object({
  id: z.int(),
  spaceId: z.int(),
  parentId: z.int().nullable(),
  type: z.enum(DRIVE_NODE_TYPES),
  name: z.string(),
  extension: z.string().nullable(),
  mimeType: z.string().nullable(),
  size: z.int(),
  contentHash: z.string().nullable(),
  version: z.int(),
  legalHold: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'OpenDriveNode' });

export type OpenDriveNode = z.infer<typeof openDriveNodeSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const openDriveNodeIdParam = z.object({
  id: z.coerce.number().int().positive().meta({ description: '节点 ID', example: 1 }),
});

export const openDriveChildrenQuery = paginationQuery.extend({
  spaceId: z.coerce.number().int().positive().meta({ description: '被授权的空间 ID' }),
  parentId: idQuery('父文件夹 ID；缺省为空间根级'),
  keyword: z.string().max(100).optional().meta({ description: '按名称模糊搜索（整个空间范围）' }),
  type: queryEnum(DRIVE_NODE_TYPES),
});

const openDriveUploadBody = multipart(z.object({
  file: fileField('要上传的文件（单请求；受空间配额、扩展名黑名单与魔数检查约束）'),
  spaceId: z.string().meta({ description: '目标空间 ID' }),
  parentId: z.string().optional().meta({ description: '目标文件夹 ID；缺省为空间根级' }),
  conflictPolicy: z.enum(['rename', 'version', 'fail']).optional().meta({ description: '同名策略，缺省 rename' }),
}));

// ─── 契约：开放网关网盘子路由（OAuth2 令牌或 AppKey 签名）────────────────────

/**
 * 开放应用只能看到治理侧「开放应用授权」中显式授权给它的空间；空间内再按授权角色裁剪：
 * viewer 只读元数据、downloader 可取内容、editor 可上传。没有任何越过授权的搜索或列举入口。
 */
export const openDriveContract = defineContract('/api/open', {
  spaces: op.get('/v1/drive/spaces', {
    security: 'open-gateway',
    response: z.array(openDriveSpaceSchema),
    summary: '当前应用被授权访问的网盘空间',
  }),
  nodes: op.get('/v1/drive/nodes', {
    security: 'open-gateway',
    query: openDriveChildrenQuery,
    response: paginated(openDriveNodeSchema),
    summary: '浏览被授权空间的目录（或按名称搜索）',
  }),
  node: op.get('/v1/drive/nodes/{id}', {
    security: 'open-gateway',
    params: openDriveNodeIdParam,
    response: openDriveNodeSchema,
    summary: '节点元数据',
  }),
  content: op.get('/v1/drive/nodes/{id}/content', {
    security: 'open-gateway',
    params: openDriveNodeIdParam,
    kind: 'file',
    summary: '下载文件当前版本内容（需授权角色 ≥ downloader）',
  }),
  upload: op.post('/v1/drive/nodes', {
    security: 'open-gateway',
    body: openDriveUploadBody,
    response: openDriveNodeSchema,
    summary: '上传文件到被授权空间（需 drive:write 与授权角色 editor）',
  }),
}, { tags: ['开放平台-企业网盘'] });
