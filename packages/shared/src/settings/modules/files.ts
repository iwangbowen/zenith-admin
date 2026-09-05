import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** 通用文件上传的默认 MIME 白名单（`*` / `*\/*` 表示放行全部） */
export const DEFAULT_UPLOAD_ALLOWED_TYPES = [
  'image/*', 'video/*', 'audio/*', 'application/pdf', 'text/plain', 'text/csv',
  'application/zip', 'application/x-zip-compressed',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.ms-excel', 'application/msword', 'application/vnd.ms-powerpoint',
] as const;

/** 通用文件上传（托管文件 / 分片上传）限制 */
export const filesSettingsSchema = z.object({
  uploadValidateType: z.boolean().default(true)
    .meta({ title: '校验真实文件类型', description: '基于 magic bytes 识别，防止伪造 MIME type 绕过校验' }),
  uploadAllowedTypes: z.array(z.string().trim().min(1).max(128)).max(200).default(() => [...DEFAULT_UPLOAD_ALLOWED_TYPES])
    .meta({ title: '允许的 MIME 类型', description: '支持通配符（如 image/*）；填 * 或 */* 放行全部类型' }),
  uploadMaxSizeMb: z.int().min(0).max(102_400).default(0)
    .meta({ title: '单文件大小上限（MB）', description: '0 表示不限制；超过的上传（含分片）将被拒绝' }),
}).meta({ id: 'Settings.Files' });

export type FilesSettings = z.output<typeof filesSettingsSchema>;

export const filesSettingsModule = defineSettingsModule({
  schema: filesSettingsSchema,
  title: '文件上传',
  description: '托管文件上传的类型校验与大小上限',
  scope: 'platform',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  sort: 40,
});
