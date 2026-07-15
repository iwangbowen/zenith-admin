/**
 * OAuth2 授权同意页面（独立页面，不在 AdminLayout 内）
 * 路由：/oauth2/authorize
 * 说明：
 *   - 未登录 → 跳转到 /login?redirect=当前URL
 *   - 已登录 → 展示应用信息和权限范围，用户选择同意/拒绝
 */
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Spin, Card, Avatar, Tag, Button, Space, Typography, Divider, Toast } from '@douyinfe/semi-ui';
import { ShieldCheck, X } from 'lucide-react';
import { OAUTH2_SCOPE_DESCRIPTIONS, TOKEN_KEY } from '@zenith/shared';
import type { OAuth2AuthorizeInfo } from '@zenith/shared';
import { request } from '@/utils/request';

const { Title, Text, Paragraph } = Typography;

export default function OAuth2AuthorizePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const clientId = searchParams.get('client_id') ?? '';
  const redirectUri = searchParams.get('redirect_uri') ?? '';
  const responseType = searchParams.get('response_type') ?? 'code';
  const scope = searchParams.get('scope') ?? 'openid';
  const state = searchParams.get('state') ?? '';
  const codeChallenge = searchParams.get('code_challenge') ?? '';
  const codeChallengeMethod = searchParams.get('code_challenge_method') ?? '';

  const [info, setInfo] = useState<OAuth2AuthorizeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // 检查是否已登录
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      const returnUrl = encodeURIComponent(globalThis.location.pathname + globalThis.location.search);
      navigate(`/login?redirect=${returnUrl}`, { replace: true });
      return;
    }

    if (!clientId || !redirectUri) {
      setError('缺少必要的授权参数（client_id / redirect_uri）');
      setLoading(false);
      return;
    }
    if (responseType !== 'code') {
      setError('仅支持 OAuth 2.1 授权码模式（response_type=code）');
      setLoading(false);
      return;
    }
    if (codeChallengeMethod && codeChallengeMethod !== 'S256') {
      setError('仅支持 PKCE S256');
      setLoading(false);
      return;
    }

    const qs = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: responseType ?? 'code',
      scope: scope ?? 'openid',
    }).toString();
    request.get<OAuth2AuthorizeInfo>(`/api/oauth2/authorize/info?${qs}`).then((res) => {
      if (res.code === 0 && res.data) {
        setInfo(res.data);
        // 如果已授权过相同权限，可以自动跳过（可选行为，这里选择仍然展示确认页）
      } else {
        setError(res.message || '获取应用信息失败');
      }
    }).catch((err: Error) => {
      setError(err.message || '应用信息加载失败');
    }).finally(() => setLoading(false));
  }, [clientId, redirectUri, responseType, scope, codeChallengeMethod, navigate]);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const res = await request.post<{ redirectUrl: string }>('/api/oauth2/authorize', {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope,
        state: state || undefined,
        code_challenge: codeChallenge || undefined,
        code_challenge_method: codeChallengeMethod === 'S256' ? 'S256' : undefined,
      }, { silent: true });
      if (res.code === 0 && res.data?.redirectUrl) {
        globalThis.location.href = res.data.redirectUrl;
      } else {
        Toast.error(res.message || '授权失败');
      }
    } catch {
      // handled by interceptor
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeny = () => {
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    globalThis.location.href = `${redirectUri}?error=access_denied&error_description=User%20denied%20access${stateParam}`;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Card style={{ maxWidth: 400, textAlign: 'center' }}>
          <X size={48} color="var(--semi-color-danger)" style={{ marginBottom: 16 }} />
          <Title heading={4}>授权请求无效</Title>
          <Paragraph type="tertiary">{error}</Paragraph>
        </Card>
      </div>
    );
  }

  if (!info) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--semi-color-bg-2)',
        padding: 24,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 460, borderRadius: 'var(--semi-border-radius-large)' }}>
        {/* 应用信息 */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {info.logoUrl ? (
            <Avatar src={info.logoUrl} size="extra-large" style={{ marginBottom: 12 }} />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'var(--semi-color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <ShieldCheck size={32} color="#fff" />
            </div>
          )}
          <Title heading={4} style={{ marginBottom: 4 }}>{info.name}</Title>
          {info.description && <Text type="tertiary">{info.description}</Text>}
        </div>

        <Divider />

        <div style={{ margin: '16px 0' }}>
          <Text strong>该应用请求以下权限：</Text>
          <div style={{ marginTop: 12 }}>
            {info.requestedScopes.map((s) => (
              <div
                key={s}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--semi-color-border)',
                }}
              >
                <Tag color="blue" size="small" style={{ marginTop: 2, flexShrink: 0 }}>{s}</Tag>
                <Text style={{ fontSize: 13 }}>{OAUTH2_SCOPE_DESCRIPTIONS[s] ?? s}</Text>
              </div>
            ))}
          </div>
        </div>

        {info.alreadyGranted && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--semi-color-success-light-default)', borderRadius: 'var(--semi-border-radius-medium)' }}>
            <Text type="success" size="small">✓ 您之前已授权该应用相同的权限，确认即可继续</Text>
          </div>
        )}

        <Divider />

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Text type="tertiary" size="small">
            授权后，{info.name} 将可以按上述权限访问您的账户信息。
          </Text>
        </div>

        <Space style={{ width: '100%', justifyContent: 'center', marginTop: 20 }}>
          <Button type="danger" theme="light" onClick={handleDeny} style={{ minWidth: 120 }}>
            拒绝
          </Button>
          <Button type="primary" loading={submitting} onClick={handleApprove} style={{ minWidth: 120 }}>
            同意授权
          </Button>
        </Space>
      </Card>
    </div>
  );
}
