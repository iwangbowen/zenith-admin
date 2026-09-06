/**
 * 数据脱敏原语的服务端入口：实现位于 `@zenith/shared/core`（sensitive.ts），前后端与 Mock 共用同一份
 * fail-closed 实现。这里只做转发，保持既有 `lib/masking` 导入路径。
 *
 * 契约级脱敏（按查看者策略打码、回写保护、按需查看明文）见 `lib/data-mask/`。
 */
export {
  applyMask,
  looksMasked,
  maskAddress,
  maskBankCard,
  maskCustom,
  maskEmail,
  maskIdCard,
  maskName,
  maskPhone,
  previewMask,
  REDACTED_TEXT,
  type CustomMaskRule,
  type MaskType,
} from '@zenith/shared/core';
