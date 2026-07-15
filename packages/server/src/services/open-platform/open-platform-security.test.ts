import { describe, expect, it } from 'vitest';
import {
  createDeveloperOAuth2ClientSchema,
  isSafeOAuthRedirectUri,
  updateOAuth2ClientSchema,
} from '@zenith/shared';

describe('开放平台安全约束', () => {
  it('拒绝可执行脚本的 OAuth 回调协议', () => {
    expect(isSafeOAuthRedirectUri('javascript:alert(document.domain)//')).toBe(false);
    expect(isSafeOAuthRedirectUri('data:text/html,<script>alert(1)</script>')).toBe(false);
    expect(createDeveloperOAuth2ClientSchema.safeParse({
      name: 'unsafe',
      redirectUris: ['javascript:alert(1)//'],
      allowedScopes: ['openid'],
      grantTypes: ['authorization_code'],
      isPublic: true,
      signEnabled: false,
      ipAllowlist: [],
      environment: 'sandbox',
    }).success).toBe(false);
  });

  it('允许 HTTPS、localhost 和原生应用自定义协议', () => {
    expect(isSafeOAuthRedirectUri('https://client.example.com/oauth/callback')).toBe(true);
    expect(isSafeOAuthRedirectUri('http://localhost:5373/oauth/callback')).toBe(true);
    expect(isSafeOAuthRedirectUri('myapp://oauth/callback')).toBe(true);
  });

  it('部分更新不会注入创建时默认值', () => {
    expect(updateOAuth2ClientSchema.parse({ status: 'disabled' })).toEqual({ status: 'disabled' });
  });
});
