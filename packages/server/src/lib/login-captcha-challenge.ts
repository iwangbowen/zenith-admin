import type { LoginCaptchaChallenge } from '@zenith/shared/identity';
import { generateCaptcha, resolveCaptchaComplexity } from './captcha';
import { getSettings } from './settings';

/**
 * 生成登录验证码挑战（管理员与会员共用）。
 *
 * 与 MFA 挑战同一模式：作为成功响应返回给刚失败的调用方（只有它能看到），
 * 前端展示验证码后带着 `captchaId` / `captchaCode` 重新提交登录。
 * 这样失败防护不会把账号锁死，真正的用户凭正确密码 + 验证码始终能登录。
 */
export async function issueLoginCaptchaChallenge(message: string): Promise<LoginCaptchaChallenge> {
  const { captchaComplexity } = await getSettings('auth');
  const { captchaId, captchaImage } = await generateCaptcha(resolveCaptchaComplexity(captchaComplexity));
  return { captchaRequired: true, captchaId, svg: captchaImage, message };
}
