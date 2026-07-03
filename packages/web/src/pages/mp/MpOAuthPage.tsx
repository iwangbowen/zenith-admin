import { useState } from 'react';
import { Button, Select, Input, Toast, Banner, Typography, Card, Tag } from '@douyinfe/semi-ui';
import { Link2, Copy } from 'lucide-react';
import { config } from '@/config';
import { SearchToolbar } from '@/components/SearchToolbar';
import { useMpAccounts } from './useMpAccounts';
import { MpAccountSwitcher } from './MpAccountSwitcher';
import { useGenerateMpJsConfig, useGenerateMpOAuthUrl } from '@/hooks/queries/mp-oauth';

const SCOPE_OPTIONS = [
  { label: 'snsapi_base（静默授权，仅取 openid）', value: 'snsapi_base' },
  { label: 'snsapi_userinfo（弹窗授权，取用户信息）', value: 'snsapi_userinfo' },
];

export default function MpOAuthPage() {
  const { accounts, currentId, setCurrentId, loading: accountsLoading } = useMpAccounts();
  const [scope, setScope] = useState<'snsapi_base' | 'snsapi_userinfo'>('snsapi_base');
  const [redirectUri, setRedirectUri] = useState('');
  const [state, setState] = useState('');
  const [genUrl, setGenUrl] = useState('');

  const [jsUrl, setJsUrl] = useState('');
  const [jsConfig, setJsConfig] = useState<{ appId: string; timestamp: number; nonceStr: string; signature: string } | null>(null);
  const generateUrlMutation = useGenerateMpOAuthUrl();
  const jsConfigMutation = useGenerateMpJsConfig();

  const handleJsConfig = async () => {
    if (!currentId) { Toast.error('请先选择公众号'); return; }
    if (!jsUrl.trim()) { Toast.error('请填写页面 URL'); return; }
    const data = await jsConfigMutation.mutateAsync({ accountId: currentId, url: jsUrl.trim() });
    setJsConfig(data);
  };

  const callbackUrl = currentId ? `${config.apiBaseUrl}/api/public/mp/oauth/${currentId}` : '';

  const handleGenerate = async () => {
    if (!currentId) { Toast.error('请先选择公众号'); return; }
    if (!redirectUri.trim()) { Toast.error('请填写回调地址'); return; }
    const data = await generateUrlMutation.mutateAsync({
      accountId: currentId, redirectUri: redirectUri.trim(), scope, state: state.trim() || undefined,
    });
    setGenUrl(data.url);
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); Toast.success('已复制'); } catch { Toast.error('复制失败'); }
  };

  const renderAccountFilter = () => (
    <MpAccountSwitcher accounts={accounts} value={currentId} onChange={setCurrentId} loading={accountsLoading} />
  );

  return (
    <div className="page-container">
      <SearchToolbar
        primary={renderAccountFilter()}
        mobilePrimary={renderAccountFilter()}
        filterTitle="网页授权筛选"
      />

      {!accountsLoading && accounts.length === 0 && (
        <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={{ marginBottom: 12 }} />
      )}

      <Card style={{ maxWidth: 760 }} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Typography.Title heading={6} style={{ margin: 0 }}>网页授权（OAuth2）链接生成</Typography.Title>
        <Banner type="info" fullMode={false} description={
          <span>用于 H5 页面获取用户 openid/unionid。请先在微信公众平台「接口权限 - 网页授权」中配置授权回调域名，再将下方回调地址作为 redirect_uri 使用。</span>
        } />

        <div>
          <Typography.Text type="secondary" size="small">授权作用域 scope</Typography.Text>
          <Select style={{ width: '100%', marginTop: 4 }} value={scope} onChange={(v) => setScope(v as 'snsapi_base' | 'snsapi_userinfo')} optionList={SCOPE_OPTIONS} />
        </div>

        <div>
          <Typography.Text type="secondary" size="small">回调地址 redirect_uri（用户授权后微信跳转的页面，须在已配置的授权域名下）</Typography.Text>
          <Input style={{ marginTop: 4 }} value={redirectUri} onChange={setRedirectUri} placeholder="https://your-h5.example.com/wechat/callback" />
        </div>

        <div>
          <Typography.Text type="secondary" size="small">state（可选，原样回传，可用于防 CSRF / 携带业务参数）</Typography.Text>
          <Input style={{ marginTop: 4 }} value={state} onChange={setState} placeholder="可选" maxLength={128} />
        </div>

        <div>
          <Button type="primary" icon={<Link2 size={14} />} loading={generateUrlMutation.isPending} disabled={!currentId} onClick={handleGenerate}>生成授权链接</Button>
        </div>

        {genUrl && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <Typography.Text type="secondary" size="small">授权跳转链接（在微信内打开）</Typography.Text>
            <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
              <Typography.Paragraph copyable={false} style={{ flex: 1, wordBreak: 'break-all', margin: 0, padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 6, fontSize: 12 }}>{genUrl}</Typography.Paragraph>
              <Button icon={<Copy size={14} />} onClick={() => void copy(genUrl)}>复制</Button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
          <Typography.Text type="secondary" size="small">本系统提供的公开回调端点（可作为 redirect_uri，返回 openid/unionid JSON）<Tag size="small" type="light" color="green" style={{ marginLeft: 6 }}>公开</Tag></Typography.Text>
          <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
            <Typography.Paragraph style={{ flex: 1, wordBreak: 'break-all', margin: 0, padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 6, fontSize: 12 }}>{callbackUrl || '请先选择公众号'}</Typography.Paragraph>
            {callbackUrl && <Button icon={<Copy size={14} />} onClick={() => void copy(callbackUrl)}>复制</Button>}
          </div>
        </div>
      </Card>

      <Card style={{ maxWidth: 760, marginTop: 16 }} bodyStyle={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <Typography.Title heading={6} style={{ margin: 0 }}>JS-SDK 配置签名（wx.config）</Typography.Title>
        <Banner type="info" fullMode={false} description="输入需要调用微信 JS-SDK 的页面完整 URL（不含 # 及其后部分），生成 wx.config 所需的签名参数。需先在公众平台配置「JS接口安全域名」。" />
        <div>
          <Typography.Text type="secondary" size="small">页面 URL</Typography.Text>
          <Input style={{ marginTop: 4 }} value={jsUrl} onChange={setJsUrl} placeholder="https://your-h5.example.com/page" />
        </div>
        <div>
          <Button type="primary" icon={<Link2 size={14} />} loading={jsConfigMutation.isPending} disabled={!currentId} onClick={handleJsConfig}>生成签名</Button>
        </div>
        {jsConfig && (
          <Typography.Paragraph style={{ wordBreak: 'break-all', margin: 0, padding: 8, background: 'var(--semi-color-fill-0)', borderRadius: 6, fontSize: 12, fontFamily: 'monospace' }}>
            {`wx.config({\n  appId: '${jsConfig.appId}',\n  timestamp: ${jsConfig.timestamp},\n  nonceStr: '${jsConfig.nonceStr}',\n  signature: '${jsConfig.signature}',\n  jsApiList: [...]\n})`}
          </Typography.Paragraph>
        )}
        {jsConfig && <Button icon={<Copy size={14} />} style={{ alignSelf: 'flex-start' }} onClick={() => void copy(JSON.stringify(jsConfig))}>复制 JSON</Button>}
      </Card>
    </div>
  );
}
