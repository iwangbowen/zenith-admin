import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { fsChmodSchema, fsCreateEntrySchema, fsRenameSchema, fsWriteTextSchema } from '../validation';
import { sftpDirListingSchema, sftpFileContentSchema, sftpFileEntrySchema, sftpHomeSchema } from './ssh-sftp';
import { fsOptionalPathQuery, fsPathQuery, fsUploadBody } from './terminal-files';

// ─── 契约（按平台运维主机访问远程文件；实体与 SFTP 共用） ─────────────────────────

export const hostFileHostIdParam = z.object({
  hostId: z.coerce.number().int().positive().meta({ description: '运维主机 ID', example: 1 }),
});

export const hostFileContract = defineContract('/api/host-files', {
  home: op.get('/{hostId}/home', { access: { permission: 'system:file:use' }, params: hostFileHostIdParam, response: sftpHomeSchema, summary: '远程主机 home 目录' }),
  list: op.get('/{hostId}/list', { access: { permission: 'system:file:use' }, params: hostFileHostIdParam, query: fsOptionalPathQuery, response: sftpDirListingSchema, summary: '远程主机目录列表' }),
  content: op.get('/{hostId}/content', { access: { permission: 'system:file:use' }, params: hostFileHostIdParam, query: fsPathQuery, response: sftpFileContentSchema, summary: '读取远程主机文本文件' }),
  saveContent: op.put('/{hostId}/content', { access: { permission: 'system:file:write' }, audit: { description: '保存远程主机文件', recordBody: false }, params: hostFileHostIdParam, body: fsWriteTextSchema, response: sftpFileEntrySchema, summary: '保存远程主机文本文件' }),
  create: op.post('/{hostId}/create', { access: { permission: 'system:file:write' }, audit: '新建远程主机文件/目录', params: hostFileHostIdParam, body: fsCreateEntrySchema, response: sftpFileEntrySchema, summary: '新建远程主机文件或目录' }),
  rename: op.post('/{hostId}/rename', { access: { permission: 'system:file:write' }, audit: '重命名/移动远程主机文件', params: hostFileHostIdParam, body: fsRenameSchema, response: sftpFileEntrySchema, summary: '重命名 / 移动远程主机文件' }),
  remove: op.delete('/{hostId}/entry', { access: { permission: 'system:file:write' }, audit: '删除远程主机文件/目录', params: hostFileHostIdParam, query: fsPathQuery, summary: '删除远程主机文件或目录' }),
  chmod: op.post('/{hostId}/chmod', { access: { permission: 'system:file:write' }, audit: '修改远程主机文件权限', params: hostFileHostIdParam, body: fsChmodSchema, summary: '修改远程主机文件权限' }),
  download: op.get('/{hostId}/download', { access: { permission: 'system:file:use' }, params: hostFileHostIdParam, query: fsPathQuery, kind: 'file', summary: '下载远程主机文件' }),
  upload: op.post('/{hostId}/upload', { access: { permission: 'system:file:write' }, audit: { description: '上传远程主机文件', recordBody: false }, params: hostFileHostIdParam, body: fsUploadBody, response: sftpFileEntrySchema, summary: '上传文件到远程主机' }),
}, { auditModule: '文件管理器', tags: ['HostFiles'] });
