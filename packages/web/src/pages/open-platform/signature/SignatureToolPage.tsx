import { useRef } from 'react';
import { Button, Form, Typography, Banner, Tag, Card, Space, Spin } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { RefreshCw, KeyRound } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import { useSignatureAlgorithm, useVerifySignature, type SignatureVerifyValues } from '@/hooks/queries/open-platform';

const { Text, Title, Paragraph } = Typography;

const codeBlockStyle: React.CSSProperties = {
  background: 'var(--semi-color-fill-0)',
  padding: 12,
  borderRadius: 6,
  wordBreak: 'break-all',
  whiteSpace: 'pre-wrap',
  fontFamily: 'monospace',
  fontSize: 12,
};

function randomNonce(): string {
  try {
    return crypto.randomUUID().replace(/-/g, '');
  } catch {
    return Math.random().toString(16).slice(2) + Math.random().toString(16).slice(2);
  }
}

export default function SignatureToolPage() {
  const { hasPermission } = usePermission();
  const canUse = hasPermission('open:signature:use');
  const formApi = useRef<FormApi | null>(null);

  const docQuery = useSignatureAlgorithm(canUse);
  const verifyMutation = useVerifySignature();
  const doc = docQuery.data ?? null;
  const result = verifyMutation.data ?? null;

  function fillTimestamp() {
    formApi.current?.setValue('timestamp', String(Math.floor(Date.now() / 1000)));
  }
  function fillNonce() {
    formApi.current?.setValue('nonce', randomNonce());
  }

  async function handleSign() {
    let values: Record<string, string>;
    try {
      values = (await formApi.current?.validate()) as Record<string, string>;
    } catch {
      return;
    }
    await verifyMutation.mutateAsync(values as unknown as SignatureVerifyValues);
  }

  if (!canUse) {
    return <div className="page-container"><Banner type="warning" description="无权限访问签名验签工具" /></div>;
  }

  return (
    <div className="page-container">
      <Card style={{ marginBottom: 16 }} title={<Title heading={6} style={{ margin: 0 }}>签名算法说明</Title>}>
        <Spin spinning={docQuery.isFetching}>
          {doc ? (
            <div>
              <Space spacing={8} wrap style={{ marginBottom: 12 }}>
                <Tag color="blue">算法：{doc.algorithm}</Tag>
                <Tag color="orange">时间戳窗口：±{doc.timestampWindow}s</Tag>
              </Space>
              <Paragraph spacing="extended">
                <Text strong>请求头：</Text>
                <Space wrap style={{ marginLeft: 8 }}>
                  <Tag>{doc.headers.appKey}</Tag>
                  <Tag>{doc.headers.timestamp}</Tag>
                  <Tag>{doc.headers.nonce}</Tag>
                  <Tag>{doc.headers.signature}</Tag>
                </Space>
              </Paragraph>
              <Paragraph><Text strong>待签名串格式：</Text></Paragraph>
              <div style={codeBlockStyle}>{doc.stringToSignFormat}</div>
              <ol style={{ margin: '12px 0 0', paddingLeft: 20, lineHeight: 1.9 }}>
                {doc.steps.map((s, i) => <li key={i}><Text>{s}</Text></li>)}
              </ol>
            </div>
          ) : (
            <Text type="tertiary">加载中…</Text>
          )}
        </Spin>
      </Card>

      <Card title={<Title heading={6} style={{ margin: 0 }}>在线验签 / 生成签名</Title>}>
        <Banner
          type="info"
          description="输入应用 AppKey 与请求要素，系统使用该应用的签名密钥计算签名；若填写「待校验签名」，则额外返回是否匹配。"
          style={{ marginBottom: 16 }}
        />
        <Form
          getFormApi={(api) => { formApi.current = api; }}
          labelPosition="left"
          labelWidth={110}
          initValues={{ method: 'GET', path: '/api/open/v1/ping' }}
        >
          <Form.Input field="appKey" label="AppKey" placeholder="应用的 clientId" rules={[{ required: true, message: '请输入 AppKey' }]} />
          <Form.Select field="method" label="请求方法" style={{ width: '100%' }} optionList={['GET', 'POST', 'PUT', 'DELETE'].map((m) => ({ value: m, label: m }))} />
          <Form.Input field="path" label="请求路径" placeholder="/api/open/v1/ping" rules={[{ required: true, message: '请输入请求路径' }]} />
          <Form.Input field="query" label="Query" placeholder="如 a=1&b=2（可空）" />
          <Form.TextArea field="body" label="Body" placeholder="请求体原文（GET 可空）" rows={2} />
          <Form.Input
            field="timestamp"
            label="时间戳(秒)"
            placeholder="10 位秒级时间戳"
            rules={[{ required: true, message: '请输入时间戳' }]}
            suffix={<Button size="small" theme="borderless" icon={<RefreshCw size={13} />} onClick={fillTimestamp}>当前</Button>}
          />
          <Form.Input
            field="nonce"
            label="Nonce"
            placeholder="随机串"
            rules={[{ required: true, message: '请输入随机串' }]}
            suffix={<Button size="small" theme="borderless" icon={<KeyRound size={13} />} onClick={fillNonce}>生成</Button>}
          />
          <Form.Input field="signature" label="待校验签名" placeholder="可选；填写后返回是否匹配" />
          <div style={{ textAlign: 'right' }}>
            <Button type="primary" loading={verifyMutation.isPending} onClick={handleSign}>计算签名</Button>
          </div>
        </Form>

        {result && (
          <div style={{ marginTop: 16 }}>
            {result.matched !== undefined && (
              <Banner
                type={result.matched ? 'success' : 'danger'}
                description={result.matched ? '✓ 签名匹配' : '✗ 签名不匹配'}
                style={{ marginBottom: 12 }}
              />
            )}
            <Paragraph><Text strong>待签名串 (stringToSign)：</Text></Paragraph>
            <div style={codeBlockStyle}>{result.stringToSign}</div>
            <Paragraph style={{ marginTop: 12 }}><Text strong>签名 (X-Signature)：</Text></Paragraph>
            <Paragraph copyable={{ content: result.signature }} style={codeBlockStyle}>{result.signature}</Paragraph>
          </div>
        )}
      </Card>
    </div>
  );
}
