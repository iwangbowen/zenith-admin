import { useEffect, useState } from 'react';
import { Banner, Button, Form, Tag, Toast, Tabs, TabPane, TextArea, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, Send } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import { useListSearch } from '@/hooks/useListSearch';
import {
  useCmsRedirectList, useSaveCmsRedirect, useDeleteCmsRedirect, cmsRedirectKeys,
  useCmsLinkWordList, useSaveCmsLinkWord, useDeleteCmsLinkWord, cmsLinkWordKeys,
  useCmsPushLogList, useCmsPush, useAllCmsSites, useCmsDeadlinkCheck,
} from '@/hooks/queries/cms';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { CMS_PUSH_ENGINE_LABELS } from '@zenith/shared/cms';
import type { CmsRedirect, CmsLinkWord, CmsPushLog } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';

import { useUrlTabState } from '@/hooks/useUrlTabState';
interface KeywordSearch { keyword: string }
const defaultKeywordSearch: KeywordSearch = { keyword: '' };

// ─── 301 重定向 Tab ───────────────────────────────────────────────────────────
function RedirectsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch,
  } = useListSearch<KeywordSearch>({ defaults: defaultKeywordSearch, listKey: cmsRedirectKeys.lists });
  const listQuery = useCmsRedirectList({ page, pageSize, siteId: siteId ?? 0, keyword: submittedParams.keyword || undefined }, siteId !== undefined);
  const saveMutation = useSaveCmsRedirect();
  const modal = useEditModal<CmsRedirect, Partial<CmsRedirect>, Record<string, unknown>>({
    entityName: '重定向',
    save: saveMutation,
    defaults: { redirectType: '301' as unknown as number, status: 'enabled' },
    toValues: (record) => ({ fromPath: record.fromPath, toUrl: record.toUrl, redirectType: String(record.redirectType) as unknown as number, status: record.status, remark: record.remark ?? '' }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return { ...values, redirectType: Number(values.redirectType), ...(!isEdit ? { siteId } : {}) };
    },
  });
  const deleteMutation = useDeleteCmsRedirect();
  const canManage = hasPermission('cms:seo:manage');

  const columns: ColumnProps<CmsRedirect>[] = [
    { title: '来源路径', dataIndex: 'fromPath', width: 240 },
    { title: '目标地址', dataIndex: 'toUrl', minWidth: 260 },
    { title: '类型', dataIndex: 'redirectType', width: 80, render: (v: number) => <Tag size="small" color={v === 301 ? 'blue' : 'orange'}>{v}</Tag> },
    { title: '备注', dataIndex: 'remark', width: 160, render: (v: string | null) => v ?? '-' },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsRedirect>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该规则吗？',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('删除成功');
              },
            });
          },
        },
      ] : [],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        <KeywordInput placeholder="搜索来源路径..." value={draftParams.keyword} onChange={(keyword) => setDraftParams({ keyword })} onSearch={handleSearch} />
        <SearchButton onClick={handleSearch} />
        {canManage ? <CreateButton onClick={modal.openCreate} /> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无重定向规则"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <AppModal {...modal.modalProps} width={520}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="fromPath" label="来源路径" placeholder="/old-page.html（须以 / 开头）" rules={[{ required: true, message: '请输入来源路径' }]} />
          <Form.Input field="toUrl" label="目标地址" placeholder="/news/ 或 https://..." rules={[{ required: true, message: '请输入目标地址' }]} />
          <Form.RadioGroup field="redirectType" label="跳转类型">
            <Form.Radio value="301">301 永久</Form.Radio>
            <Form.Radio value="302">302 临时</Form.Radio>
          </Form.RadioGroup>
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </>
  );
}

// ─── 内链词 Tab ───────────────────────────────────────────────────────────────
function LinkWordsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch,
  } = useListSearch<KeywordSearch>({ defaults: defaultKeywordSearch, listKey: cmsLinkWordKeys.lists });
  const listQuery = useCmsLinkWordList({ page, pageSize, siteId: siteId ?? 0, keyword: submittedParams.keyword || undefined }, siteId !== undefined);
  const saveMutation = useSaveCmsLinkWord();
  const modal = useEditModal<CmsLinkWord, Partial<CmsLinkWord>, Record<string, unknown>>({
    entityName: '内链词',
    save: saveMutation,
    defaults: { maxReplaces: 1, status: 'enabled' },
    labelWidth: 100,
    toValues: (record) => ({ keyword: record.keyword, url: record.url, maxReplaces: record.maxReplaces, status: record.status }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return { ...values, ...(!isEdit ? { siteId } : {}) };
    },
  });
  const deleteMutation = useDeleteCmsLinkWord();
  const canManage = hasPermission('cms:seo:manage');

  const columns: ColumnProps<CmsLinkWord>[] = [
    { title: '关键词', dataIndex: 'keyword', width: 160 },
    { title: '链接地址', dataIndex: 'url', minWidth: 280 },
    { title: '每篇最多替换', dataIndex: 'maxReplaces', width: 120 },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsLinkWord>({
      width: 150,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            confirmDelete({
              title: '确定要删除该内链词吗？',
              onOk: async () => {
                await deleteMutation.mutateAsync({ params: { id: record.id } });
                Toast.success('删除成功');
              },
            });
          },
        },
      ] : [],
    }),
  ];

  return (
    <>
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="内容详情页渲染时自动将正文中的关键词替换为站内链接（跳过已有链接区域），提升 SEO 内链密度。修改后新访问/重新生成的页面生效。" />
      <SearchToolbar>
        <KeywordInput placeholder="搜索关键词..." value={draftParams.keyword} onChange={(keyword) => setDraftParams({ keyword })} onSearch={handleSearch} />
        <SearchButton onClick={handleSearch} />
        {canManage ? <CreateButton onClick={modal.openCreate} /> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无内链词"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <AppModal {...modal.modalProps} width={520}>
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Input field="keyword" label="关键词" rules={[{ required: true, message: '请输入关键词' }]} />
          <Form.Input field="url" label="链接地址" placeholder="/news/1.html 或 https://..." rules={[{ required: true, message: '请输入链接地址' }]} />
          <Form.InputNumber field="maxReplaces" label="每篇最多替换" min={1} max={10} style={{ width: 160 }} />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
        </Form>
      </AppModal>
    </>
  );
}

// ─── 搜索推送 Tab ─────────────────────────────────────────────────────────────
function PushTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const { page, pageSize, buildPagination } = usePagination();
  const [urlsText, setUrlsText] = useState('');
  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);
  const settings = (currentSite?.settings ?? {}) as Record<string, unknown>;
  const configured = Boolean(settings.baiduPushToken || settings.indexNowKey);

  const logsQuery = useCmsPushLogList({ page, pageSize, siteId: siteId ?? 0 }, siteId !== undefined);
  const pushMutation = useCmsPush();

  async function handlePush() {
    if (!siteId) return;
    const urls = urlsText.split('\n').map((s) => s.trim()).filter(Boolean);
    if (urls.length === 0) {
      Toast.warning('请输入要推送的 URL（每行一个）');
      return;
    }
    const results = await pushMutation.mutateAsync({ body: { siteId, urls } });
    const okCount = results.filter((r) => r.submitted).length;
    const skipped = results.filter((r) => !r.submitted).map((r) => r.reason).filter(Boolean);
    Toast.success(`已提交 ${okCount} 个引擎${skipped.length > 0 ? `；跳过：${skipped.join('、')}` : ''}`);
    setUrlsText('');
  }

  const columns: ColumnProps<CmsPushLog>[] = [
    { title: '引擎', dataIndex: 'engine', width: 130, render: (v: string) => CMS_PUSH_ENGINE_LABELS[v as keyof typeof CMS_PUSH_ENGINE_LABELS] ?? v },
    { title: 'URL 数', dataIndex: 'urls', width: 80, render: (v: string[]) => v.length },
    {
      title: '结果', dataIndex: 'success', width: 120,
      render: (v: boolean, record) => (v ? <Tag color="green" size="small">成功</Tag> : <Tag color="red" size="small">失败{record.statusCode ? `（${record.statusCode}）` : ''}</Tag>),
    },
    { title: '响应', dataIndex: 'response', width: 320, render: (v: string | null) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 300 }}>{v ?? '-'}</Typography.Text> },
    dateTimeColumn('推送时间', 'createdAt'),
  ];

  return (
    <>
      <Banner
        type={configured ? 'info' : 'warning'}
        closeIcon={null}
        style={{ marginBottom: 12 }}
        description={configured
          ? '内容发布后将自动推送到已配置的搜索引擎；此处也可手动批量推送历史 URL。'
          : '尚未配置推送凭证：请在「站点管理 → 编辑站点 → 搜索推送」中填写百度推送 Token 或 IndexNow Key，并绑定站点域名。'}
      />
      {hasPermission('cms:seo:push') ? (
        <div style={{ marginBottom: 16 }}>
          <TextArea
            value={urlsText}
            onChange={setUrlsText}
            rows={4}
            placeholder={'每行一个 URL（站内路径或完整地址），如：\n/news/1.html\nhttps://www.example.com/products/enterprise.html'}
          />
          <Button
            type="primary"
            icon={<Send size={14} />}
            style={{ marginTop: 8 }}
            loading={pushMutation.isPending}
            disabled={!siteId}
            onClick={() => void handlePush()}
          >
            手动推送
          </Button>
        </div>
      ) : null}
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={logsQuery.data?.list ?? []}
        loading={logsQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无推送记录"
        onRefresh={() => void logsQuery.refetch()}
        refreshLoading={logsQuery.isFetching}
        pagination={buildPagination(logsQuery.data?.total ?? 0)}
      />
    </>
  );
}

// ─── 死链检测 Tab（P3）─────────────────────────────────────────────────────────
function DeadlinkTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const checkMutation = useCmsDeadlinkCheck();
  const { tasks, loading, refresh } = useMyAsyncTasks({ taskTypes: ['cms-deadlink-check'] });

  const columns: ColumnProps[] = [
    { title: '任务', dataIndex: 'title', width: 260 },
    { title: '进度', width: 280, render: (_: unknown, record) => <AsyncTaskProgress task={record} /> },
    dateTimeColumn('提交时间', 'createdAt'),
    dateTimeColumn('完成时间', 'completedAt'),
  ];

  return (
    <>
      <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="扫描已发布内容正文与友情链接中的链接：站内链接校验目标是否存在，外链探测可达性（限 200 条）。坏链明细在任务中心的任务详情中查看。" />
      <SearchToolbar>
        {hasPermission('cms:seo:manage') ? (
          <Button
            type="primary"
            icon={<Search size={14} />}
            loading={checkMutation.isPending}
            disabled={!siteId}
            onClick={async () => {
              if (!siteId) return;
              await checkMutation.mutateAsync({ body: { siteId } });
              Toast.success('死链检测任务已提交');
              refresh();
            }}
          >
            开始检测
          </Button>
        ) : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={tasks}
        loading={loading}
        rowKey="id"
        size="small"
        empty="暂无检测任务"
        onRefresh={refresh}
        refreshLoading={loading}
        pagination={false}
      />
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function SeoPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useUrlTabState(['redirects', 'link-words', 'push', 'deadlink'] as const, 'redirects');
  const canManage = hasPermission('cms:seo:manage');
  const canPush = hasPermission('cms:seo:push');
  useEffect(() => {
    const allowed = [...(canManage ? ['redirects', 'link-words', 'deadlink'] as const : []), ...(canPush ? ['push'] as const : [])];
    if (!allowed.includes(activeTab as never) && allowed[0]) setActiveTab(allowed[0]);
  }, [activeTab, canManage, canPush, setActiveTab]);

  return (
    <div className="page-container page-tabs-page">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
      </SearchToolbar>
      <Tabs collapsible="auto" activeKey={activeTab} onChange={(key) => setActiveTab(key as typeof activeTab)} type="line" lazyRender keepDOM={false}>
        {canManage ? <TabPane tab="301 重定向" itemKey="redirects">
          <RedirectsTab siteId={siteId} />
        </TabPane> : null}
        {canManage ? <TabPane tab="内链词" itemKey="link-words">
          <LinkWordsTab siteId={siteId} />
        </TabPane> : null}
        {canPush ? <TabPane tab="搜索推送" itemKey="push">
          <PushTab siteId={siteId} />
        </TabPane> : null}
        {canManage ? <TabPane tab="死链检测" itemKey="deadlink">
          <DeadlinkTab siteId={siteId} />
        </TabPane> : null}
      </Tabs>
    </div>
  );
}
