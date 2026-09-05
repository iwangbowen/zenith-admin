import * as z from 'zod';
import { CAPTCHA_COMPLEXITIES } from '../constants';
import { defineSettingsModule } from '../module-def';

/** 登录与账号入口开关（登录页匿名可见，故为 public） */
export const authSettingsSchema = z.object({
  captchaEnabled: z.boolean().default(false)
    .meta({ title: '登录验证码', description: '开启后登录必须输入图形验证码' }),
  captchaComplexity: z.enum(CAPTCHA_COMPLEXITIES).default('medium')
    .meta({ title: '验证码复杂度', description: '仅在开启登录验证码后生效' }),
  allowRegistration: z.boolean().default(false)
    .meta({ title: '开放注册', description: '是否允许新用户自助注册' }),
  forgotPasswordEnabled: z.boolean().default(false)
    .meta({ title: '忘记密码', description: '是否开启邮件重置密码功能' }),
}).meta({ id: 'Settings.Auth' });

export type AuthSettings = z.output<typeof authSettingsSchema>;

export const authSettingsModule = defineSettingsModule({
  schema: authSettingsSchema,
  title: '登录与注册',
  description: '登录验证码、自助注册与找回密码入口',
  // 验证码在登录流程解析租户之前就要判定，只能是平台级
  scope: 'platform',
  readPermission: 'system:setting:view',
  writePermission: 'system:setting:update',
  visibility: { captchaEnabled: 'public', captchaComplexity: 'public', allowRegistration: 'public', forgotPasswordEnabled: 'public' },
  sort: 10,
});
