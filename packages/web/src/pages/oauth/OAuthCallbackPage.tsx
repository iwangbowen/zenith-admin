import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Spin, Toast } from '@douyinfe/semi-ui';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared/core';
import { oauthContract } from '@zenith/shared/identity';
import { api } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { markPostLoginHome } from '@/lib/post-login';
import type { MfaHandoffState } from '@/lib/mfa-handoff';
import { takeOAuthPending } from '@/lib/oauth-pending';

function isSafeRedirect(target: string | null | undefined): target is string {
  return !!target && target.startsWith('/') && !target.startsWith('//') && !target.startsWith('/\\');
}

/**
 * 第三方登录 / 绑定的统一回调页。
 * 回调 URL 里的 `state` 必须与跳转前暂存的一致（浏览器侧防登录 CSRF），服务端再单次消费；
 * 绑定意图走 `oauthContract.bind`（保持当前会话，不会被替换成第三方身份对应的账号）。
 */
export default function OAuthCallbackPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('正在处理第三方登录…');

  useEffect(() => {
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const pending = takeOAuthPending();
    const failTo = (path: string, text: string) => {
      setMessage(text);
      Toast.error(text);
      setTimeout(() => navigate(path, { replace: true }), 2000);
    };

    if (!code || !state || !provider) {
      setMessage('授权参数不完整');
      return;
    }
    if (!pending || pending.state !== state || pending.provider !== provider) {
      failTo(pending?.intent === 'bind' ? '/profile' : '/login', '第三方登录状态已失效或不是由本浏览器发起，请重新操作');
      return;
    }

    if (pending.intent === 'bind') {
      setMessage('正在绑定第三方账号…');
      api(oauthContract.bind, { body: { provider: pending.provider, code, state } }, { silent: true })
        .then(() => {
          Toast.success('绑定成功');
          navigate('/profile', { replace: true });
        })
        .catch((err: unknown) => failTo('/profile', (err instanceof ApiError && err.message) || '绑定失败'));
      return;
    }

    api(oauthContract.callback, { params: { provider }, body: { code, state } }, { silent: true })
      .then((data) => {
        if ('needBind' in data) {
          Toast.warning('未找到匹配账号，请先用密码登录，再在个人中心绑定该第三方账号');
          navigate('/login', { replace: true });
          return;
        }
        // 与密码登录共用 MFA 策略：命中挑战时交给登录页的验证表单完成
        if ('mfaRequired' in data) {
          const handoff: MfaHandoffState = { mfaChallenge: data, redirectTo: pending.redirectTo ?? null };
          navigate('/login', { replace: true, state: handoff });
          return;
        }
        localStorage.setItem(TOKEN_KEY, data.token.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, data.token.refreshToken);
        Toast.success('登录成功');
        markPostLoginHome();
        const target = isSafeRedirect(pending.redirectTo) ? pending.redirectTo : '/';
        navigate(target, { replace: true });
        // 强制刷新以重新获取用户信息（落地首页；redirectTo 由 HomeEntry / 路由守卫接管）
        globalThis.location.href = import.meta.env.BASE_URL;
      })
      .catch((err: unknown) => failTo('/login', (err instanceof ApiError && err.message) || '第三方登录失败'));
  }, [provider, searchParams, navigate]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <Spin size="large" />
      <span>{message}</span>
    </div>
  );
}
