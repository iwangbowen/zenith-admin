/**
 * 运行时设置（Settings）域常量：作用域、可见性、以及只在设置模块中出现的枚举。
 *
 * 业务域自有的枚举（MFA 模式、知识库可见性…）仍以各自 `constants.ts` 为 SSOT，
 * 设置模块通过 `z.enum(XXX)` 引用，不在此处复制。
 */

/** 设置模块的作用域：`platform` 只有平台一行；`tenant` 允许租户在平台值之上覆盖 */
export const SETTINGS_SCOPES = ['platform', 'tenant'] as const;
export type SettingsScope = (typeof SETTINGS_SCOPES)[number];

/**
 * 字段可见性（默认 `admin`）：
 * - `public`：匿名可读（登录页开关、公开密码策略）→ `GET /api/settings/public`
 * - `authenticated`：任意登录用户可读（水印、布局开关）→ `GET /api/settings/me`
 * - `admin`：仅持有模块读权限的管理员可读
 */
export const SETTINGS_VISIBILITIES = ['public', 'authenticated', 'admin'] as const;
export type SettingsVisibility = (typeof SETTINGS_VISIBILITIES)[number];

/** 登录验证码复杂度（svg-captcha 干扰强度档位） */
export const CAPTCHA_COMPLEXITIES = ['low', 'medium', 'high'] as const;
export type CaptchaComplexity = (typeof CAPTCHA_COMPLEXITIES)[number];
export const CAPTCHA_COMPLEXITY_LABELS: Record<CaptchaComplexity, string> = {
  low: '低（干扰少、易识别）',
  medium: '中（默认）',
  high: '高（干扰强、识别难度高）',
};

/** 模块名保留字：与 `/api/settings` 下的固定端点路径冲突，禁止用作模块 key / 路径 */
export const SETTINGS_RESERVED_MODULE_NAMES = ['public', 'me'] as const;
