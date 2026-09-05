import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { FS_ENTRY_TYPES } from '../constants';
import { fsChmodSchema, fsCreateEntrySchema, fsRenameSchema, fsWriteTextSchema } from '../validation';
import { fsOptionalPathQuery, fsPathQuery, fsUploadBody } from './terminal-files';

// ─── 实体（SFTP：个人 SSH 配置目标主机 / 平台运维主机共用） ─────────────────────

export const sftpFileEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(FS_ENTRY_TYPES),
  size: z.number(),
  mtime: z.string(),
  permissions: z.string().optional().meta({ description: 'Unix 权限字符串，如 rwxr-xr-x' }),
}).meta({ id: 'SftpFileEntry' });

export type SftpFileEntry = z.infer<typeof sftpFileEntrySchema>;

export const sftpDirListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(sftpFileEntrySchema),
}).meta({ id: 'SftpDirListing' });

export type SftpDirListing = z.infer<typeof sftpDirListingSchema>;

/** 远程文本文件内容；`etag` 保存时回传以检测并发编辑冲突 */
export const sftpFileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
  etag: z.string(),
}).meta({ id: 'SftpFileContent' });

export type SftpFileContent = z.infer<typeof sftpFileContentSchema>;

export const sftpHomeSchema = z.object({
  home: z.string().meta({ description: '远程用户主目录' }),
}).meta({ id: 'SftpHome' });

export type SftpHome = z.infer<typeof sftpHomeSchema>;

// ─── 契约（按当前用户的 SSH 配置访问远程主机） ───────────────────────────────────

export const sshSftpProfileIdParam = z.object({
  profileId: z.coerce.number().int().meta({ description: '当前用户的 SSH 配置 ID', example: 1 }),
});

export const sshSftpContract = defineContract('/api/ssh-sftp', {
  home: op.get('/{profileId}/home', { params: sshSftpProfileIdParam, response: sftpHomeSchema, summary: '获取远程 home 目录' }),
  list: op.get('/{profileId}/list', { params: sshSftpProfileIdParam, query: fsOptionalPathQuery, response: sftpDirListingSchema, summary: '列出远程目录内容' }),
  content: op.get('/{profileId}/content', { params: sshSftpProfileIdParam, query: fsPathQuery, response: sftpFileContentSchema, summary: '读取远程文本文件内容' }),
  saveContent: op.put('/{profileId}/content', { params: sshSftpProfileIdParam, body: fsWriteTextSchema, response: sftpFileEntrySchema, summary: '保存远程文本文件内容' }),
  create: op.post('/{profileId}/create', { params: sshSftpProfileIdParam, body: fsCreateEntrySchema, response: sftpFileEntrySchema, summary: '新建远程文件或目录' }),
  rename: op.post('/{profileId}/rename', { params: sshSftpProfileIdParam, body: fsRenameSchema, response: sftpFileEntrySchema, summary: '重命名 / 移动远程文件或目录' }),
  remove: op.delete('/{profileId}/entry', { params: sshSftpProfileIdParam, query: fsPathQuery, summary: '删除远程文件或目录' }),
  chmod: op.post('/{profileId}/chmod', { params: sshSftpProfileIdParam, body: fsChmodSchema, summary: '修改远程文件 / 目录权限' }),
  download: op.get('/{profileId}/download', { params: sshSftpProfileIdParam, query: fsPathQuery, kind: 'file', summary: '下载远程文件' }),
  upload: op.post('/{profileId}/upload', { params: sshSftpProfileIdParam, body: fsUploadBody, response: sftpFileEntrySchema, summary: '上传文件到远程目录' }),
}, { tags: ['SshSftp'] });
