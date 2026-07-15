import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banner,
  Button,
  Card,
  Col,
  Form,
  Row,
  Select,
  Space,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Play, RotateCcw } from 'lucide-react';
import type { OpenApiDebugResult } from '@zenith/shared';
import { useDebugMyApp, useMyAppList } from '@/hooks/queries/developer-apps';

const { Paragraph, Text, Title } = Typography;
type DebugPath = '/api/open/v1/ping' | '/api/open/v1/echo' | '/api/open/v1/userinfo';

const ENDPOINTS: Array<{ path: DebugPath; label: string; methods: Array<'GET' | 'POST'> }> = [
  { path: '/api/open/v1/ping', label: '连通性测试', methods: ['GET'] },
  { path: '/api/open/v1/echo', label: '参数回显', methods: ['GET', 'POST'] },
  { path: '/api/open/v1/userinfo', label: '应用上下文', methods: ['GET'] },
];

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default function ApiDebugConsolePage() {
  const [searchParams] = useSearchParams();
  const initialAppId = Number(searchParams.get('appId'));
  const appListQuery = useMyAppList({ page: 1, pageSize: 100 });
  const debugMutation = useDebugMyApp();
  const apps = useMemo(() => appListQuery.data?.list ?? [], [appListQuery.data]);
  const [appId, setAppId] = useState<number | undefined>(Number.isFinite(initialAppId) ? initialAppId : undefined);
  const [path, setPath] = useState<DebugPath>('/api/open/v1/ping');
  const [method, setMethod] = useState<'GET' | 'POST'>('GET');
  const [queryText, setQueryText] = useState('{\n  "message": "hello"\n}');
  const [bodyText, setBodyText] = useState('{\n  "message": "hello from debug console"\n}');
  const [result, setResult] = useState<OpenApiDebugResult | null>(null);
  const endpoint = useMemo(() => ENDPOINTS.find((item) => item.path === path)!, [path]);

  useEffect(() => {
    if (appId === undefined && apps.length > 0) setAppId(apps[0].id);
  }, [appId, apps]);

  const reset = () => {
    setPath('/api/open/v1/ping');
    setMethod('GET');
    setQueryText('{\n  "message": "hello"\n}');
    setBodyText('{\n  "message": "hello from debug console"\n}');
    setResult(null);
  };

  const execute = async () => {
    if (!appId) {
      Toast.warning('请先选择应用');
      return;
    }
    let query: Record<string, string> | undefined;
    let body: unknown;
    try {
      const parsed = queryText.trim() ? JSON.parse(queryText) as unknown : undefined;
      if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) throw new Error('query');
      query = parsed
        ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
        : undefined;
      body = method === 'POST' && bodyText.trim() ? JSON.parse(bodyText) : undefined;
    } catch {
      Toast.error('Query 与 Body 必须是合法 JSON');
      return;
    }
    const response = await debugMutation.mutateAsync({
      id: appId,
      values: { method, path, query, body },
    });
    setResult(response);
  };

  return (
    <div className="page-container">
      <Banner
        type="info"
        description="调试请求由服务端代签并发送到开放网关，不会在浏览器中暴露 AppSecret。沙箱应用不会消耗生产配额。"
        style={{ marginBottom: 16 }}
      />
      <Row gutter={16}>
        <Col xs={24} md={10}>
          <Card title={<Title heading={6} style={{ margin: 0 }}>构造请求</Title>}>
            <Form labelPosition="left" labelWidth={90}>
              <Select
                prefix="应用"
                value={appId}
                onChange={(value) => setAppId(Number(value))}
                optionList={apps.map((app) => ({
                  value: app.id,
                  label: `${app.name}（${app.environment === 'sandbox' ? '沙箱' : '生产'}）`,
                }))}
                loading={appListQuery.isFetching}
                style={{ width: '100%', marginBottom: 16 }}
              />
              <Select
                prefix="端点"
                value={path}
                onChange={(value) => {
                  const nextPath = value as DebugPath;
                  const next = ENDPOINTS.find((item) => item.path === nextPath)!;
                  setPath(nextPath);
                  if (!next.methods.includes(method)) setMethod(next.methods[0]);
                }}
                optionList={ENDPOINTS.map((item) => ({ value: item.path, label: `${item.label} · ${item.path}` }))}
                style={{ width: '100%', marginBottom: 16 }}
              />
              <Select
                prefix="方法"
                value={method}
                onChange={(value) => setMethod(value as 'GET' | 'POST')}
                optionList={endpoint.methods.map((value) => ({ value, label: value }))}
                style={{ width: '100%', marginBottom: 16 }}
              />
              <div style={{ marginBottom: 16 }}>
                <Text strong>Query JSON</Text>
                <TextArea value={queryText} onChange={setQueryText} rows={5} style={{ marginTop: 6 }} />
              </div>
              {method === 'POST' && (
                <div style={{ marginBottom: 16 }}>
                  <Text strong>Body JSON</Text>
                  <TextArea value={bodyText} onChange={setBodyText} rows={7} style={{ marginTop: 6 }} />
                </div>
              )}
              <Space style={{ marginTop: 8 }}>
                <Button type="primary" icon={<Play size={14} />} loading={debugMutation.isPending} onClick={() => void execute()}>发送请求</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={reset}>重置</Button>
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card title={<Title heading={6} style={{ margin: 0 }}>响应与签名过程</Title>}>
            {!result ? (
              <div style={{ padding: '56px 0', textAlign: 'center' }}>
                <Text type="tertiary">发送请求后将在这里展示网关响应与待签名串</Text>
              </div>
            ) : (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Tag color={result.statusCode < 400 ? 'green' : 'red'}>{result.statusCode}</Tag>
                  <Tag>{result.method}</Tag>
                  <Text>{result.durationMs} ms</Text>
                </Space>
                <Text strong>请求地址</Text>
                <Paragraph copyable style={{ wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)' }}>{result.requestUrl}</Paragraph>
                <Text strong>请求头</Text>
                <Paragraph copyable style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)', maxHeight: 180, overflow: 'auto' }}>
                  {JSON.stringify(result.requestHeaders, null, 2)}
                </Paragraph>
                {result.stringToSign && (
                  <>
                    <Text strong>待签名串</Text>
                    <Paragraph copyable style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)', maxHeight: 180, overflow: 'auto' }}>
                      {result.stringToSign}
                    </Paragraph>
                  </>
                )}
                <Text strong>响应体</Text>
                <Paragraph copyable style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)', maxHeight: 320, overflow: 'auto' }}>
                  {prettyJson(result.responseBody)}
                </Paragraph>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
