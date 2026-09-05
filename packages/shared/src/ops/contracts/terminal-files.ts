import * as z from 'zod';
import { defineContract, fileField, multipart, op } from '../../core/contract';
import { asyncTaskSchema } from '../../tasks/contracts/async-tasks';
import { FILE_CHECKSUM_ALGOS, FS_ENTRY_TYPES } from '../constants';
import {
  fsChmodSchema,
  fsCompressSchema,
  fsCreateEntrySchema,
  fsExtractSchema,
  fsRenameSchema,
  fsWriteTextSchema,
} from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 宿主机文件系统条目（permissions / uid / gid 仅 POSIX 平台返回） */
export const fsEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  type: z.enum(FS_ENTRY_TYPES),
  size: z.number(),
  mtime: z.string(),
  permissions: z.string().optional().meta({ description: 'Unix 权限字符串，如 rwxr-xr-x（Windows 下为空字符串）' }),
  uid: z.number().optional().meta({ description: '文件所属用户 ID（Windows 下为 0）' }),
  gid: z.number().optional().meta({ description: '文件所属用户组 ID（Windows 下为 0）' }),
}).meta({ id: 'FsEntry' });

export type FsEntry = z.infer<typeof fsEntrySchema>;

export const fsDirListingSchema = z.object({
  path: z.string(),
  parent: z.string().nullable(),
  entries: z.array(fsEntrySchema),
}).meta({ id: 'FsDirListing' });

export type FsDirListing = z.infer<typeof fsDirListingSchema>;

/** 文本文件内容；`etag` 保存时回传以检测并发编辑冲突 */
export const fsFileContentSchema = z.object({
  path: z.string(),
  content: z.string(),
  size: z.number(),
  etag: z.string(),
}).meta({ id: 'FsFileContent' });

export type FsFileContent = z.infer<typeof fsFileContentSchema>;

export const fsRootInfoSchema = z.object({
  home: z.string().meta({ description: '用户主目录' }),
  isWindows: z.boolean(),
  drives: z.array(z.string()).meta({ description: 'Windows 盘符列表（Unix 下为空数组）' }),
}).meta({ id: 'FsRootInfo' });

export type FsRootInfo = z.infer<typeof fsRootInfoSchema>;

export const terminalShellInfoSchema = z.object({
  id: z.string(),
  label: z.string(),
  path: z.string(),
  args: z.array(z.string()).optional().meta({ description: '传给 shell 可执行文件的额外启动参数（如 WSL distro 的 -d <name>）' }),
}).meta({ id: 'TerminalShellInfo' });

export type TerminalShellInfo = z.infer<typeof terminalShellInfoSchema>;

export const terminalShellListingSchema = z.object({
  platform: z.string(),
  shells: z.array(terminalShellInfoSchema),
  defaultShell: z.string(),
}).meta({ id: 'TerminalShellListing' });

export type TerminalShellListing = z.infer<typeof terminalShellListingSchema>;

export const fsChecksumResultSchema = z.object({
  algo: z.string(),
  hash: z.string(),
  size: z.number(),
}).meta({ id: 'FsChecksumResult' });

export type FsChecksumResult = z.infer<typeof fsChecksumResultSchema>;

/** 递归搜索结果；`truncated` 表示触顶提前结束，结果不完整 */
export const fsSearchResultSchema = z.object({
  entries: z.array(fsEntrySchema),
  truncated: z.boolean(),
}).meta({ id: 'FsSearchResult' });

export type FsSearchResult = z.infer<typeof fsSearchResultSchema>;

export const fsDirSizeSchema = z.object({
  size: z.number().meta({ description: '总字节数' }),
  files: z.number().meta({ description: '文件数' }),
  dirs: z.number().meta({ description: '子目录数' }),
  truncated: z.boolean().meta({ description: '是否因目录过大而截断统计' }),
}).meta({ id: 'FsDirSize' });

export type FsDirSize = z.infer<typeof fsDirSizeSchema>;

// ─── 入参 ────────────────────────────────────────────────────────────────────

export const fsOptionalPathQuery = z.object({
  path: z.string().optional().meta({ description: '目录路径，缺省为用户主目录' }),
});

export const fsPathQuery = z.object({
  path: z.string().min(1),
});

export const fsChecksumQuery = z.object({
  path: z.string().min(1),
  algo: z.enum(FILE_CHECKSUM_ALGOS).default('sha256'),
});

export const fsSearchQuery = z.object({
  dir: z.string().min(1),
  keyword: z.string().min(1).max(128),
});

/** 上传到目录：`path` 为目标目录，`file` 为文件本体 */
export const fsUploadBody = multipart(z.object({
  path: z.string(),
  file: fileField(),
}));

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const terminalFileContract = defineContract('/api/terminal-files', {
  rootInfo: op.get('/root-info', { response: fsRootInfoSchema, summary: '获取文件系统根信息（盘符、home 目录等）' }),
  list: op.get('/list', { query: fsOptionalPathQuery, response: fsDirListingSchema, summary: '列出目录内容' }),
  download: op.get('/download', { query: fsPathQuery, kind: 'file', summary: '下载文件' }),
  upload: op.post('/upload', { body: fsUploadBody, response: fsEntrySchema, summary: '上传文件到目录' }),
  shells: op.get('/shells', { response: terminalShellListingSchema, summary: '获取可用 shell 列表' }),
  content: op.get('/content', { query: fsPathQuery, response: fsFileContentSchema, summary: '读取文本文件内容' }),
  saveContent: op.put('/content', { body: fsWriteTextSchema, response: fsEntrySchema, summary: '保存文本文件内容' }),
  create: op.post('/create', { body: fsCreateEntrySchema, response: fsEntrySchema, summary: '新建文件或目录' }),
  rename: op.post('/rename', { body: fsRenameSchema, response: fsEntrySchema, summary: '重命名 / 移动文件或目录' }),
  remove: op.delete('/entry', { query: fsPathQuery, summary: '删除文件或目录' }),
  move: op.post('/move', { body: fsRenameSchema, response: fsEntrySchema, summary: '移动文件或目录' }),
  copy: op.post('/copy', { body: fsRenameSchema, response: fsEntrySchema, summary: '复制文件或目录' }),
  compress: op.post('/compress', { body: fsCompressSchema, response: asyncTaskSchema, summary: '压缩文件 / 目录为 ZIP（异步任务）' }),
  chmod: op.post('/chmod', { body: fsChmodSchema, summary: '修改文件 / 目录权限（chmod）' }),
  extract: op.post('/extract', { body: fsExtractSchema, response: asyncTaskSchema, summary: '解压压缩包（异步任务）' }),
  checksum: op.get('/checksum', { query: fsChecksumQuery, response: fsChecksumResultSchema, summary: '计算文件校验和' }),
  search: op.get('/search', { query: fsSearchQuery, response: fsSearchResultSchema, summary: '递归搜索文件名' }),
  dirSize: op.get('/dir-size', { query: fsPathQuery, response: fsDirSizeSchema, summary: '递归统计目录大小' }),
}, { tags: ['TerminalFiles'] });
