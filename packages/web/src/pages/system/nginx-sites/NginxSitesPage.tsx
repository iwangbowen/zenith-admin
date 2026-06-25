import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Banner,
  Button,
  Col,
  Form,
  Input,
  Popconfirm,
  Radio,
  Row,
  Space,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CheckCircle, Plus, RefreshCw, RotateCcw, Search } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';

interface NginxInfo {
  installed: boolean;
  version: string | null;
  configPath: string | null;
  sitesAvailable: string | null;
  sitesEnabled: string | null;
  runningStatus: 'running' | 'stopped' | 'unknown';
}

interface NginxSite {
  name: string;
  enabled: boolean;
  configPath: string;
  serverName: string | null;
  listenPort: number | null;
  root: string | null;
  sslEnabled: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

interface NginxSiteDetail extends NginxSite {
  content: string;
}

interface CreateFormValues {
  name: string;
  serverName: string;
  listenPort: number;
  type: 'static' | 'proxy';
  root?: string;
  proxyPass?: string;
  sslEnabled?: boolean;
}

const { Text } = Typography;

const RUNNING_STATUS_TAG: Record<NginxInfo['runningStatus'], { color: 'green' | 'red' | 'grey'; text: string }> = {
  running: { color: 'green', text: '运行中' },
  stopped: { color: 'red', text: '已停止' },
  unknown: { color: 'grey', text: '未知' },
};

export default function NginxSitesPage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:nginx:manage');
  const canReload = hasPermission('system:nginx:reload');
  const [info, setInfo] = useState<NginxInfo | null>(null);
  const [sites, setSites] = useState<NginxSite[]>([]);
  const [keyword, setKeyword] = useState('');
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<Record<string, boolean>>({});
  const [createVisible, setCreateVisible] = useState(false);
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorLoading, setEditorLoading] = useState(false);
  const [savingEditor, setSavingEditor] = useState(false);
  const [editorSite, setEditorSite] = useState<NginxSiteDetail | null>(null);
  const [editorContent, setEditorContent] = useState('');
  const [testLoading, setTestLoading] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; output: string } | null>(null);
  const [reloadLoading, setReloadLoading] = useState(false);
  const [submittingCreate, setSubmittingCreate] = useState(false);
  const createFormApi = useRef<FormApi<CreateFormValues> | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [infoRes, sitesRes] = await Promise.all([
        request.get<NginxInfo>('/api/nginx-sites/info', { silent: true }),
        request.get<NginxSite[]>('/api/nginx-sites', { silent: true }),
      ]);
      if (infoRes.code === 0) setInfo(infoRes.data);
      if (sitesRes.code === 0) setSites(sitesRes.data ?? []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const filteredSites = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return sites;
    return sites.filter((site) => [site.name, site.serverName ?? '', site.configPath].some((value) => value.toLowerCase().includes(kw)));
  }, [keyword, sites]);

  const handleReset = () => {
    setKeyword('');
    void fetchData();
  };

  const openEditor = async (name: string) => {
    setEditorVisible(true);
    setEditorLoading(true);
    setEditorSite(null);
    setEditorContent('');
    try {
      const res = await request.get<NginxSiteDetail>(`/api/nginx-sites/${encodeURIComponent(name)}`);
      if (res.code === 0 && res.data) {
        setEditorSite(res.data);
        setEditorContent(res.data.content);
      } else {
        setEditorVisible(false);
      }
    } finally {
      setEditorLoading(false);
    }
  };

  const handleCreate = async () => {
    const values = await createFormApi.current?.validate();
    if (!values) return;

    setSubmittingCreate(true);
    try {
      const res = await request.post('/api/nginx-sites', {
        name: values.name,
        serverName: values.serverName,
        listenPort: values.listenPort,
        sslEnabled: !!values.sslEnabled,
        ...(values.type === 'proxy' ? { proxyPass: values.proxyPass } : { root: values.root }),
      });
      if (res.code === 0) {
        Toast.success('站点已创建');
        setCreateVisible(false);
        createFormApi.current?.reset();
        void fetchData();
      }
    } finally {
      setSubmittingCreate(false);
    }
  };

  const handleSaveEditor = async () => {
    if (!editorSite) return;
    setSavingEditor(true);
    try {
      const res = await request.put(`/api/nginx-sites/${encodeURIComponent(editorSite.name)}`, { content: editorContent });
      if (res.code === 0) {
        Toast.success('配置已保存');
        setEditorVisible(false);
        void fetchData();
      }
    } finally {
      setSavingEditor(false);
    }
  };

  const handleAction = async (siteName: string, action: 'enable' | 'disable' | 'delete') => {
    setActionLoading((prev) => ({ ...prev, [siteName]: true }));
    try {
      const res = action === 'delete'
        ? await request.delete(`/api/nginx-sites/${encodeURIComponent(siteName)}`)
        : await request.post(`/api/nginx-sites/${encodeURIComponent(siteName)}/${action}`, {});
      if (res.code === 0) {
        Toast.success(action === 'enable' ? '站点已启用' : action === 'disable' ? '站点已禁用' : '站点已删除');
        void fetchData();
      }
    } finally {
      setActionLoading((prev) => ({ ...prev, [siteName]: false }));
    }
  };

  const handleTest = async () => {
    setTestLoading(true);
    try {
      const res = await request.post<{ success: boolean; output: string }>('/api/nginx-sites/test', {});
      if (res.code === 0 && res.data) setTestResult(res.data);
    } finally {
      setTestLoading(false);
    }
  };

  const handleReload = async () => {
    setReloadLoading(true);
    try {
      const res = await request.post('/api/nginx-sites/reload', {});
      if (res.code === 0) {
        Toast.success('Nginx 已重载');
        void fetchData();
      }
    } finally {
      setReloadLoading(false);
    }
  };

  const columns: ColumnProps<NginxSite>[] = [
    {
      title: '站点名',
      dataIndex: 'name',
      width: 180,
      render: (value: string) => <Typography.Text strong>{value}</Typography.Text>,
    },
    {
      title: '域名',
      dataIndex: 'serverName',
      render: renderEllipsis,
    },
    {
      title: '端口',
      dataIndex: 'listenPort',
      width: 100,
      render: (value: number | null) => value ?? '—',
    },
    {
      title: 'SSL',
      dataIndex: 'sslEnabled',
      width: 90,
      render: (value: boolean) => <Tag color={value ? 'green' : 'grey'} size="small">{value ? '已开启' : '未开启'}</Tag>,
    },
    createdAtColumn as ColumnProps<NginxSite>,
    {
      title: '状态',
      dataIndex: 'enabled',
      width: 100,
      fixed: 'right',
      render: (value: boolean) => <Tag color={value ? 'green' : 'grey'} size="small">{value ? '启用' : '禁用'}</Tag>,
    },
    {
      title: '操作',
      width: 220,
      fixed: 'right',
      render: (_: unknown, record: NginxSite) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => void openEditor(record.name)}>查看/编辑</Button>
          {canManage && (record.enabled
            ? <Button theme="borderless" size="small" loading={!!actionLoading[record.name]} onClick={() => void handleAction(record.name, 'disable')}>禁用</Button>
            : <Button theme="borderless" size="small" loading={!!actionLoading[record.name]} onClick={() => void handleAction(record.name, 'enable')}>启用</Button>)}
          {canManage && (
            <Popconfirm title="确定要删除吗？" onConfirm={() => void handleAction(record.name, 'delete')}>
              <Button theme="borderless" type="danger" size="small" loading={!!actionLoading[record.name]}>删除</Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  const runningTag = RUNNING_STATUS_TAG[info?.runningStatus ?? 'unknown'];

  return (
    <div className="page-container">
      {!info?.installed && (
        <Banner
          type="warning"
          closeIcon={null}
          style={{ marginBottom: 16 }}
          description="当前环境未检测到已安装的 Nginx。Windows 开发环境下接口会返回 mock 数据，写操作也会以模拟模式执行。"
        />
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)' }}>
          <Text type="secondary" size="small">安装状态</Text>
          <div style={{ marginTop: 8 }}><Tag color={info?.installed ? 'green' : 'grey'}>{info?.installed ? '已安装' : '未安装'}</Tag></div>
        </div>
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)' }}>
          <Text type="secondary" size="small">运行状态</Text>
          <div style={{ marginTop: 8 }}><Tag color={runningTag.color}>{runningTag.text}</Tag></div>
        </div>
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)' }}>
          <Text type="secondary" size="small">版本</Text>
          <div style={{ marginTop: 8 }}><Text>{info?.version ?? '—'}</Text></div>
        </div>
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)' }}>
          <Text type="secondary" size="small">配置路径</Text>
          <div style={{ marginTop: 8 }}><Typography.Text style={{ wordBreak: 'break-all' }}>{info?.configPath ?? '—'}</Typography.Text></div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 16 }}>
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)' }}>
          <Text type="secondary" size="small">sites-available / conf.d</Text>
          <div style={{ marginTop: 8 }}><Typography.Text style={{ wordBreak: 'break-all' }}>{info?.sitesAvailable ?? '—'}</Typography.Text></div>
        </div>
        <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 16, background: 'var(--semi-color-bg-1)' }}>
          <Text type="secondary" size="small">sites-enabled</Text>
          <div style={{ marginTop: 8 }}><Typography.Text style={{ wordBreak: 'break-all' }}>{info?.sitesEnabled ?? '—'}</Typography.Text></div>
        </div>
      </div>

      <SearchToolbar
        primary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索站点名 / 域名 / 配置路径" value={keyword} onChange={setKeyword} showClear style={{ width: 260 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={() => void fetchData()}>查询</Button>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>新增站点</Button>}
          </>
        )}
        actions={(
          <>
            {canManage && <Button type="primary" theme="light" icon={<CheckCircle size={14} />} loading={testLoading} onClick={() => void handleTest()}>测试配置</Button>}
            {canReload && <Button type="primary" theme="light" icon={<RefreshCw size={14} />} loading={reloadLoading} onClick={() => void handleReload()}>重载 Nginx</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <Input prefix={<Search size={14} />} placeholder="搜索站点名 / 域名 / 配置路径" value={keyword} onChange={setKeyword} showClear style={{ width: 260 }} />
            <Button type="primary" icon={<Search size={14} />} onClick={() => void fetchData()}>查询</Button>
            {canManage && <Button type="primary" icon={<Plus size={14} />} onClick={() => setCreateVisible(true)}>新增站点</Button>}
          </>
        )}
        mobileActions={(
          <>
            <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
            {canManage && <Button type="primary" theme="light" icon={<CheckCircle size={14} />} loading={testLoading} onClick={() => void handleTest()}>测试配置</Button>}
            {canReload && <Button type="primary" theme="light" icon={<RefreshCw size={14} />} loading={reloadLoading} onClick={() => void handleReload()}>重载 Nginx</Button>}
          </>
        )}
        actionTitle="Nginx 操作"
      />

      <ConfigurableTable
        bordered
        rowKey="name"
        dataSource={filteredSites}
        columns={columns}
        loading={loading}
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
        empty="暂无 Nginx 站点配置"
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      <AppModal
        title="新增站点"
        visible={createVisible}
        onCancel={() => setCreateVisible(false)}
        onOk={() => void handleCreate()}
        okButtonProps={{ loading: submittingCreate }}
        width={660}
      >
        <Form<CreateFormValues>
          labelPosition="left"
          labelWidth={90}
          initValues={{ name: '', serverName: '', listenPort: 80, type: 'static', sslEnabled: false }}
          getFormApi={(api) => { createFormApi.current = api; }}
        >
          {({ values }) => (
            <>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="name" label="站点名" placeholder="如 example.com" rules={[{ required: true, message: '请输入站点名' }]} />
                </Col>
                <Col span={12}>
                  <Form.Input field="serverName" label="域名" placeholder="如 example.com www.example.com" rules={[{ required: true, message: '请输入域名' }]} />
                </Col>
              </Row>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.InputNumber field="listenPort" label="监听端口" min={1} max={65535} style={{ width: '100%' }} />
                </Col>
                <Col span={12}>
                  <Form.RadioGroup field="sslEnabled" label="SSL" type="button">
                    <Radio value>开启</Radio>
                    <Radio value={false}>关闭</Radio>
                  </Form.RadioGroup>
                </Col>
              </Row>
              <Form.RadioGroup field="type" label="站点类型">
                <Radio value="static">静态文件</Radio>
                <Radio value="proxy">反向代理</Radio>
              </Form.RadioGroup>
              {values.type === 'proxy'
                ? <Form.Input field="proxyPass" label="代理地址" placeholder="如 http://127.0.0.1:3000" rules={[{ required: true, message: '请输入反向代理地址' }]} />
                : <Form.Input field="root" label="根目录" placeholder="如 /var/www/example.com" rules={[{ required: true, message: '请输入站点根目录' }]} />}
            </>
          )}
        </Form>
      </AppModal>

      <AppModal
        title={editorSite ? `编辑配置 · ${editorSite.name}` : '编辑配置'}
        visible={editorVisible}
        onCancel={() => setEditorVisible(false)}
        onOk={() => void handleSaveEditor()}
        okButtonProps={{ loading: savingEditor, disabled: editorLoading || !editorSite || !canManage }}
        footer={canManage && editorSite ? undefined : null}
        width={860}
      >
        {editorLoading && <Text type="secondary">配置加载中…</Text>}
        {!editorLoading && editorSite && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Tag color={editorSite.enabled ? 'green' : 'grey'}>{editorSite.enabled ? '启用中' : '已禁用'}</Tag>
              <Tag color={editorSite.sslEnabled ? 'green' : 'grey'}>{editorSite.sslEnabled ? 'SSL 已开启' : 'SSL 未开启'}</Tag>
              <Text type="secondary">{editorSite.configPath}</Text>
            </div>
            <TextArea
              value={editorContent}
              onChange={setEditorContent}
              autosize={{ minRows: 18, maxRows: 28 }}
              disabled={!canManage}
              style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 13 }}
            />
          </div>
        )}
      </AppModal>

      <AppModal title="配置测试结果" visible={testResult !== null} onCancel={() => setTestResult(null)} footer={null} width={760}>
        {testResult && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <Tag color={testResult.success ? 'green' : 'red'}>{testResult.success ? '测试通过' : '测试失败'}</Tag>
            <TextArea
              value={testResult.output}
              readOnly
              autosize={{ minRows: 12, maxRows: 20 }}
              style={{ fontFamily: 'Consolas, Menlo, monospace', fontSize: 13 }}
            />
          </div>
        )}
      </AppModal>
    </div>
  );
}
