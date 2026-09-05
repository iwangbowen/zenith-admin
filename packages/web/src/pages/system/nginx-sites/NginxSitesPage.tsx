import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Col, Form, Radio, Row, Tag, TextArea, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CheckCircle, RefreshCw } from 'lucide-react';
import { AppModal } from '@/components/AppModal';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import {
  nginxSiteKeys,
  useCreateNginxSite,
  useNginxSiteAction,
  useNginxSiteDetail,
  useNginxSitesOverview,
  useReloadNginx,
  useTestNginxConfig,
  useUpdateNginxSite,
} from '@/hooks/queries/nginx-sites';
import type { NginxInfo, NginxSite } from '@zenith/shared/ops';
import { useQueryClient } from '@tanstack/react-query';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { StatCard, StatGrid } from '@/components/charts/StatCard';

const { Text } = Typography;

const RUNNING_STATUS_TAG: Record<NginxInfo['runningStatus'], { color: 'green' | 'red' | 'grey'; text: string }> = {
  running: { color: 'green', text: '运行中' },
  stopped: { color: 'red', text: '已停止' },
  unknown: { color: 'grey', text: '未知' },
};
const EMPTY_SITES: NginxSite[] = [];

interface CreateNginxSiteModalRecord {
  id: number;
}

/** 新建站点表单：静态站点填 root，反向代理填 proxyPass，提交时按类型择一 */
interface CreateNginxSiteFormValues {
  name: string;
  serverName: string;
  listenPort: number;
  type: 'static' | 'proxy';
  root?: string;
  proxyPass?: string;
  sslEnabled?: boolean;
}

export default function NginxSitesPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const canManage = hasPermission('system:nginx:manage');
  const canReload = hasPermission('system:nginx:reload');
  const [keyword, setKeyword] = useState('');
  const [editorVisible, setEditorVisible] = useState(false);
  const [editorName, setEditorName] = useState<string | undefined>(undefined);
  const [editorContent, setEditorContent] = useState('');
  const [testResult, setTestResult] = useState<{ success: boolean; output: string } | null>(null);
  const overviewQuery = useNginxSitesOverview();
  const detailQuery = useNginxSiteDetail(editorName, editorVisible);
  const createMutation = useCreateNginxSite();
  const updateMutation = useUpdateNginxSite();
  const actionMutation = useNginxSiteAction();
  const testMutation = useTestNginxConfig();
  const reloadMutation = useReloadNginx();
  const info = overviewQuery.data?.info ?? null;
  const sites = overviewQuery.data?.sites ?? EMPTY_SITES;
  const editorSite = detailQuery.data ?? null;
  const createModal = useEditModal<CreateNginxSiteModalRecord, CreateNginxSiteFormValues>({
    entityName: '站点',
    save: {
      mutateAsync: async ({ values }) => {
        await createMutation.mutateAsync({
          body: {
            name: values.name,
            serverName: values.serverName,
            listenPort: values.listenPort,
            sslEnabled: !!values.sslEnabled,
            ...(values.type === 'proxy' ? { proxyPass: values.proxyPass } : { root: values.root }),
          },
        });
        return { id: 0 };
      },
      isPending: createMutation.isPending,
    },
    defaults: { name: '', serverName: '', listenPort: 80, type: 'static', sslEnabled: false },
    successMessage: () => '站点已创建',
  });

  useEffect(() => {
    if (editorVisible && detailQuery.data) setEditorContent(detailQuery.data.content);
  }, [editorVisible, detailQuery.data]);

  const filteredSites = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return sites;
    return sites.filter((site) => [site.name, site.serverName ?? '', site.configPath].some((value) => value.toLowerCase().includes(kw)));
  }, [keyword, sites]);

  const handleReset = () => {
    setKeyword('');
    void overviewQuery.refetch();
  };

  const openEditor = (name: string) => {
    setEditorVisible(true);
    setEditorName(name);
    setEditorContent('');
  };

  const handleSaveEditor = async () => {
    if (!editorSite) return;
    await updateMutation.mutateAsync({ params: { name: editorSite.name }, body: { content: editorContent } });
    Toast.success('配置已保存');
    setEditorVisible(false);
  };

  const handleAction = async (siteName: string, action: 'enable' | 'disable' | 'delete') => {
    await actionMutation.mutateAsync({ name: siteName, action });
    Toast.success(action === 'enable' ? '站点已启用' : action === 'disable' ? '站点已禁用' : '站点已删除');
  };

  const handleTest = async () => {
    const res = await testMutation.mutateAsync({});
    setTestResult(res);
  };

  const handleReload = async () => {
    await reloadMutation.mutateAsync({});
    Toast.success('Nginx 已重载');
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
    createOperationColumn<NginxSite>({
      width: 210,
      desktopInlineKeys: ['edit', 'toggle'],
      actions: (record) => [
        {
          key: 'edit',
          label: '查看/编辑',
          onClick: () => { openEditor(record.name); },
        },
        {
          key: 'accessLog',
          label: '访问日志',
          hidden: !record.accessLog,
          onClick: () => navigate(`/system/log-viewer?path=${encodeURIComponent(record.accessLog as string)}`),
        },
        {
          key: 'errorLog',
          label: '错误日志',
          hidden: !record.errorLog,
          onClick: () => navigate(`/system/log-viewer?path=${encodeURIComponent(record.errorLog as string)}`),
        },
        {
          key: 'ssl',
          label: 'SSL 证书',
          hidden: !record.sslEnabled,
          onClick: () => navigate('/system/ssl-certificates'),
        },
        {
          key: 'toggle',
          label: record.enabled ? '禁用' : '启用',
          loading: actionMutation.isPending && actionMutation.variables?.name === record.name,
          hidden: !canManage,
          onClick: () => { void handleAction(record.name, record.enabled ? 'disable' : 'enable'); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          loading: actionMutation.isPending && actionMutation.variables?.name === record.name,
          hidden: !canManage,
          onClick: () => {
            confirmDelete({
              onOk: () => { void handleAction(record.name, 'delete'); },
            });
          },
        },
      ],
    }),
  ];

  const runningTag = RUNNING_STATUS_TAG[info?.runningStatus ?? 'unknown'];

  return (
    <div className="page-container">
      {!info?.installed && (
        <Banner
          type="warning"
          closeIcon={null}
          style={{ marginBottom: 16 }}
          description="当前环境未检测到可用的 Nginx(Windows 平台不支持 Nginx 站点管理)。"
        />
      )}

      <div style={{ marginBottom: 16 }}>
        <StatGrid minItemWidth={210}>
          <StatCard
            title="安装状态"
            value={info?.installed ? '已安装' : '未安装'}
            accent={info?.installed ? 'var(--semi-color-success)' : 'var(--semi-color-text-2)'}
          />
          <StatCard
            title="运行状态"
            value={runningTag.text}
            accent={runningTag.color === 'green'
              ? 'var(--semi-color-success)'
              : runningTag.color === 'red'
                ? 'var(--semi-color-danger)'
                : 'var(--semi-color-text-2)'}
          />
          <StatCard title="版本" value={info?.version ?? '—'} />
          <StatCard title="主配置" value={info?.configPath ? '已发现' : '—'} sub={info?.configPath ?? undefined} />
          <StatCard title="站点配置目录" value={info?.sitesAvailable ? '已发现' : '—'} sub={info?.sitesAvailable ?? undefined} />
          <StatCard title="启用目录" value={info?.sitesEnabled ? '已发现' : '—'} sub={info?.sitesEnabled ?? undefined} />
        </StatGrid>
      </div>

      <SearchToolbar
        primary={(
          <>
            <KeywordInput placeholder="搜索站点名 / 域名 / 配置路径" value={keyword} onChange={setKeyword} width={260} />
            <SearchButton onClick={() => { void queryClient.invalidateQueries({ queryKey: nginxSiteKeys.lists }); }} />
            <ResetButton onClick={handleReset} />
            {canManage && <CreateButton onClick={createModal.openCreate}>新增站点</CreateButton>}
          </>
        )}
        actions={(
          <>
            {canManage && <Button type="primary" theme="light" icon={<CheckCircle size={14} />} loading={testMutation.isPending} onClick={() => void handleTest()}>测试配置</Button>}
            {canReload && <Button type="primary" theme="light" icon={<RefreshCw size={14} />} loading={reloadMutation.isPending} onClick={() => void handleReload()}>重载 Nginx</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索站点名 / 域名 / 配置路径" value={keyword} onChange={setKeyword} width={260} />
            <SearchButton onClick={() => { void queryClient.invalidateQueries({ queryKey: nginxSiteKeys.lists }); }} />
            {canManage && <CreateButton onClick={createModal.openCreate}>新增站点</CreateButton>}
          </>
        )}
        mobileActions={(
          <>
            <ResetButton onClick={handleReset} />
            {canManage && <Button type="primary" theme="light" icon={<CheckCircle size={14} />} loading={testMutation.isPending} onClick={() => void handleTest()}>测试配置</Button>}
            {canReload && <Button type="primary" theme="light" icon={<RefreshCw size={14} />} loading={reloadMutation.isPending} onClick={() => void handleReload()}>重载 Nginx</Button>}
          </>
        )}
        actionTitle="Nginx 操作"
      />

      <ConfigurableTable
        bordered
        rowKey="name"
        dataSource={filteredSites}
        columns={columns}
        loading={overviewQuery.isFetching}
        onRefresh={() => void overviewQuery.refetch()}
        refreshLoading={overviewQuery.isFetching}
        empty="暂无 Nginx 站点配置"
        pagination={{ pageSize: 20, showSizeChanger: true }}
      />

      <AppModal
        {...createModal.modalProps}
        width={660}
      >
        <Form key={createModal.formKey} {...createModal.formProps}>
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
        okButtonProps={{ loading: updateMutation.isPending, disabled: detailQuery.isFetching || !editorSite || !canManage }}
        footer={canManage && editorSite ? undefined : null}
        width={860}
      >
        {detailQuery.isFetching && <Text type="secondary">配置加载中…</Text>}
        {!detailQuery.isFetching && editorSite && (
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
