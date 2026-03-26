import { useEffect, useState } from 'react';
import { useParams, useSearchParams, useNavigate } from 'react-router-dom';
import { Spin, Toast } from '@douyinfe/semi-ui';
import { TOKEN_KEY, REFRESH_TOKEN_KEY } from '@zenith/shared';
import { request } from '../../utils/request';

export default function OAuthCallbackPage() {
  const { provider } = useParams<{ provider: string }>();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('正在处理第三方登录…');

  useEffect(() => {
    const code = searchParams.get('code');
    if (!code || !provider) {
      setMessage('授权参数不完整');
      return;
    }

    request
      .post<{
        user?: Record<string, unknown>;
        token?: { accessToken: string; refreshToken: string };
        needBind?: boolean;
        oauthInfo?: { provider: string; openId: string; nickname: string; avatar?: string };
      }>(`/api/auth/oauth/${provider}/callback`, { code })
      .then((res) => {
        if (res.code === 0 && res.data?.token) {
          localStorage.setItem(TOKEN_KEY, res.data.token.accessToken);
          localStorage.setItem(REFRESH_TOKEN_KEY, res.data.token.refreshToken);
          Toast.success('登录成功');
          navigate('/', { replace: true });
          // 强制刷新以重新获取用户信息
          globalThis.location.href = '/';
        } else if (res.data?.needBind) {
          Toast.warning('未找到匹配账号，请先登录后在个人中心绑定');
          navigate('/login', { replace: true });
        } else {
          setMessage(res.message || '第三方登录失败');
          Toast.error(res.message || '第三方登录失败');
          setTimeout(() => navigate('/login', { replace: true }), 2000);
        }
      })
      .catch(() => {
        setMessage('第三方登录失败');
        setTimeout(() => navigate('/login', { replace: true }), 2000);
      });
  }, [provider, searchParams, navigate]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <Spin size="large" />
      <span>{message}</span>
    </div>
  );
}
