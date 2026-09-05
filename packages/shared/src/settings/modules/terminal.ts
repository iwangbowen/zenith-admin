import * as z from 'zod';
import { defineSettingsModule } from '../module-def';

/** Web 终端 / 文件管理器（运维域） */
export const terminalSettingsSchema = z.object({
  recordingEnabled: z.boolean().default(false)
    .meta({ title: '终端录屏', description: '开启后前端记录终端输入输出并在会话结束时提交' }),
  recordingRetainDays: z.int().min(0).max(3650).default(30)
    .meta({ title: '录屏保留天数', description: '超过天数的录屏由每日清理任务删除；0 表示不按天数清理' }),
  recordingMaxSizeMb: z.int().min(0).max(1_000_000).default(500)
    .meta({ title: '录屏总容量上限（MB）', description: '超出后按时间从旧到新删除；0 表示不限制' }),
  uploadMaxSizeMb: z.int().min(0).max(102_400).default(200)
    .meta({ title: '文件上传大小上限（MB）', description: '文件管理器 / SFTP 单文件上限；该链路整份读入内存，0 表示不限制' }),
}).meta({ id: 'Settings.Terminal' });

export type TerminalSettings = z.output<typeof terminalSettingsSchema>;

export const terminalSettingsModule = defineSettingsModule({
  schema: terminalSettingsSchema,
  title: 'Web 终端',
  description: '终端录屏与文件传输限制',
  scope: 'platform',
  feature: 'ops',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  // 前端创建终端会话时需要知道是否录制
  visibility: { recordingEnabled: 'authenticated' },
  sort: 50,
});
