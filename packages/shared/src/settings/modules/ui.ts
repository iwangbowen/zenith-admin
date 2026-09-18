import * as z from 'zod';
import { defineSettingsModule } from '../module-def';
import { preferencePolicySchema } from '../../preferences';

/** 管理后台界面开关（任意登录用户可见，布局据此渲染） */
export const uiSettingsSchema = z.object({
  watermark: z.object({
    enabled: z.boolean().default(false).meta({ title: '页面水印', description: '开启后全站叠加水印（防截图泄漏）' }),
    content: z.string().max(200).default('').meta({ title: '水印文本', description: '留空则显示当前用户名' }),
    fontSize: z.int().min(8).max(72).default(14).meta({ title: '字体大小（px）' }),
    opacity: z.int().min(1).max(100).default(15).meta({ title: '透明度（1-100）' }),
  }).prefault({}).meta({ title: '水印' }),
  quickChatEnabled: z.boolean().default(false)
    .meta({ title: '快捷聊天按钮', description: '全局开关，关闭后偏好设置中的相关选项同步隐藏' }),
  feedbackEntryEnabled: z.boolean().default(false)
    .meta({ title: '意见反馈入口', description: '显示在用户头像下拉菜单，关闭后用户无法提交反馈' }),
  preferencesEntryEnabled: z.boolean().default(true)
    .meta({ title: '偏好设置入口', description: '显示在用户头像下拉菜单，关闭后隐藏“偏好设置”（含锁屏密码设置）' }),
  preferences: preferencePolicySchema.prefault({}).meta({ title: '偏好默认值与用户权限', description: '设置所有用户的默认偏好，并控制每项是否允许个人覆盖' }),
}).meta({ id: 'Settings.Ui' });

export type UiSettings = z.output<typeof uiSettingsSchema>;

export const uiSettingsModule = defineSettingsModule({
  schema: uiSettingsSchema,
  title: '界面与体验',
  description: '页面水印、快捷聊天、意见反馈与偏好设置入口、偏好策略',
  scope: 'platform',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  visibility: { watermark: 'authenticated', quickChatEnabled: 'authenticated', feedbackEntryEnabled: 'authenticated', preferencesEntryEnabled: 'authenticated', preferences: 'authenticated' },
  sort: 30,
});
