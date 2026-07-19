/** 采集中心：规则 CRUD + 任务中心执行 + 采集明细（P3 Batch5） */
import { useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, Modal, SideSheet, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import {
  useCmsChannelTree, useCmsCollectRules, useSaveCmsCollectRule, useDeleteCmsCollectRule,
  useRunCmsCollectRule, useCmsCollectItems, cmsCollectKeys,
} from '@/hooks/queries/cms';
import type { CmsChannel, CmsCollectRule, CmsCollectItem } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

function channelsToSelectTree(nodes: CmsChannel[]): { key: string; value: number; label: string; disabled: boolean; children?: ReturnType<typeof channelsToSelectTree> }[] {
  return nodes.map((n) => ({
    key: String(n.id),
    value: n.id,
    label: n.name,
    disabled: n.type !== 'list',
    children: n.children ? channelsToSelectTree(n.children) : undefined,
  }));
}

const ITEM_STATUS_META: Record<CmsCollectItem['status'], { label: string; color: 'green' | 'grey' | 'red' }> = {
  success: { label: '成功', color: 'green' },
  skipped: { label: '跳过', color: 'grey' },
  failed: { label: '失败', color: 'red' },
};

export default function CollectPage() {
  const { hasPermission } = usePermission();
  const isMobile = useIsMobile();
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const { page, pageSize, buildPagination, resetPage } = usePagination();
  const formApi = useRef<FormApi | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsCollectRule | null>(null);
  const [itemsRule, setItemsRule] = useState<CmsCollectRule | null>(null);
  const [itemsPage, setItemsPage] = useState(1);

  const listQuery = useCmsCollectRules({ page, pageSize, siteId, ...(keyword ? { keyword } : {}) });
  const treeQuery = useCmsChannelTree(siteId);
  const saveMutation = useSaveCmsCollectRule();
  const deleteMutation = useDeleteCmsCollectRule();
  const runMutation = useRunCmsCollectRule();
  const itemsQuery = useCmsCollectItems(itemsRule?.id, { page: itemsPage, pageSize: 10 });
  const { tasks, refresh: refreshTasks } = useMyAsyncTasks({ taskTypes: ['cms-collect-run'] });
  const runningTasks = useMemo(() => tasks.filter((t) => t.status === 'running' || t.status === 'pending'), [tasks]);

  function handleSearch() {
    setKeyword(keywordDraft.trim());
    resetPage();
    void qc.invalidateQueries({ queryKey: cmsCollectKeys.lists });
  }

  function handleReset() {
    setKeywordDraft('');
    setKeyword('');
    resetPage();
    void qc.invalidateQueries({ queryKey: cmsCollectKeys.lists });
  }

  function openCreate() {
    setEditingRecord(null);
    setModalVisible(true);
  }

  function openEdit(record: CmsCollectRule) {
    setEditingRecord(record);
    setModalVisible(true);
  }

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!editingRecord) values.siteId = siteId;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
  }

  async function handleRun(record: CmsCollectRule) {
    await runMutation.mutateAsync(record.id);
    Toast.success('采集任务已提交');
    refreshTasks();
  }

  const initValues = editingRecord
    ? {
        channelId: editingRecord.channelId,
        name: editingRecord.name,
        listUrl: editingRecord.listUrl,
        pageStart: editingRecord.pageStart,
        pageEnd: editingRecord.pageEnd,
        listSelector: editingRecord.listSelector,
        titleSelector: editingRecord.titleSelector,
        bodySelector: editingRecord.bodySelector,
        summarySelector: editingRecord.summarySelector ?? '',
        coverSelector: editingRecord.coverSelector ?? '',
        removeSelectors: editingRecord.removeSelectors,
        autoPublish: editingRecord.autoPublish,
        localizeImages: editingRecord.localizeImages,
        maxItems: editingRecord.maxItems,
        status: editingRecord.status,
        remark: editingRecord.remark ?? '',
      }
    : { pageStart: 1, pageEnd: 1, maxItems: 50, autoPublish: false, localizeImages: false, status: 'enabled', removeSelectors: [] };

  const columns: ColumnProps<CmsCollectRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 160 },
    { title: '目标栏目', dataIndex: 'channelName', width: 120, render: (v: string | null) => v ?? '-' },
    {
      title: '列表页 URL',
      dataIndex: 'listUrl',
      width: 260,
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 240 }}>{v}</Typography.Text>,
    },
    { title: '翻页', width: 90, render: (_: unknown, r) => (r.listUrl.includes('{page}') ? `${r.pageStart}-${r.pageEnd}` : '单页') },
    { title: '单次上限', dataIndex: 'maxItems', width: 90 },
    {
      title: '选项',
      width: 150,
      render: (_: unknown, r) => (
        <span>
          {r.autoPublish ? <Tag size="small" color="green" style={{ marginRight: 4 }}>自动发布</Tag> : <Tag size="small" style={{ marginRight: 4 }}>入草稿</Tag>}
          {r.localizeImages ? <Tag size="small" color="blue">图片本地化</Tag> : null}
        </span>
      ),
    },
    { title: '最近执行', dataIndex: 'lastRunAt', width: 150, render: (v: string | null) => v ?? '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right' as const,
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag size="small">停用</Tag>),
    },
    createOperationColumn<CmsCollectRule>({
      width: 210,
      desktopInlineKeys: ['run', 'items'],
      actions: (record) => [
        ...(hasPermission('cms:collect:run') && record.status === 'enabled' ? [{
          key: 'run',
          label: '执行采集',
          onClick: () => { void handleRun(record); },
        }] : []),
        {
          key: 'items',
          label: '明细',
          onClick: () => { setItemsPage(1); setItemsRule(record); },
        },
        ...(hasPermission('cms:collect:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }] : []),
        ...(hasPermission('cms:collect:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `删除规则「${record.name}」？`,
              content: '采集明细将一并删除，已入库内容不受影响',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  const itemColumns: ColumnProps<CmsCollectItem>[] = [
    {
      title: 'URL',
      dataIndex: 'url',
      width: 280,
      render: (v: string) => <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 260 }}>{v}</Typography.Text>,
    },
    { title: '标题', dataIndex: 'title', width: 200, render: (v: string | null) => v ?? '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: CmsCollectItem['status']) => <Tag size="small" color={ITEM_STATUS_META[v].color}>{ITEM_STATUS_META[v].label}</Tag>,
    },
    { title: '错误', dataIndex: 'error', width: 200, render: (v: string | null) => v ?? '-' },
    { title: '采集时间', dataIndex: 'createdAt', width: 170 },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); resetPage(); }} />
        <Input prefix={<Search size={14} />} placeholder="规则名称" value={keywordDraft} onChange={setKeywordDraft} showClear style={{ width: 200 }} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {hasPermission('cms:collect:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
        ) : null}
      </SearchToolbar>

      {runningTasks.length > 0 ? (
        <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {runningTasks.map((t) => <AsyncTaskProgress key={t.id} task={t} />)}
        </div>
      ) : null}

      <ConfigurableTable<CmsCollectRule>
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        rowKey="id"
        loading={listQuery.isFetching}
        scroll={{ x: 1310 }}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
      />

      <AppModal
        title={editingRecord ? '编辑采集规则' : '新增采集规则'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => setModalVisible(false)}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={640}
        closeOnEsc
      >
        <Form key={editingRecord?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }} allowEmpty initValues={initValues} labelPosition="left" labelWidth={110}>
          <Form.Input field="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} />
          <Form.TreeSelect field="channelId" label="目标栏目" style={{ width: '100%' }}
            treeData={channelsToSelectTree(treeQuery.data ?? [])}
            rules={[{ required: true, message: '请选择目标栏目' }]} />
          <Form.Input field="listUrl" label="列表页 URL" placeholder="https://example.com/news?page={page}（{page} 占位翻页）"
            rules={[{ required: true, message: '请输入列表页 URL' }]} />
          <Form.Slot label="翻页范围">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Form.InputNumber field="pageStart" noLabel min={1} style={{ width: 110 }} />
              <span>至</span>
              <Form.InputNumber field="pageEnd" noLabel min={1} style={{ width: 110 }} />
              <Form.InputNumber field="maxItems" noLabel min={1} max={200} style={{ width: 130 }} prefix="上限" />
            </div>
          </Form.Slot>
          <Form.Input field="listSelector" label="条目选择器" placeholder="如 .news-list li a"
            rules={[{ required: true, message: '请输入条目链接选择器' }]} />
          <Form.Input field="titleSelector" label="标题选择器" placeholder="如 h1.title"
            rules={[{ required: true, message: '请输入标题选择器' }]} />
          <Form.Input field="bodySelector" label="正文选择器" placeholder="如 .article-content"
            rules={[{ required: true, message: '请输入正文选择器' }]} />
          <Form.Input field="summarySelector" label="摘要选择器" placeholder="选填，如 .summary" />
          <Form.Input field="coverSelector" label="封面选择器" placeholder="选填，如 .cover img" />
          <Form.TagInput field="removeSelectors" label="清洗选择器" placeholder="回车添加：正文中要移除的节点（广告等）" />
          <Form.Slot label="采集选项">
            <div style={{ display: 'flex', gap: 24 }}>
              <Form.Switch field="autoPublish" noLabel label="自动发布" extraText="采集后直接发布并静态化" />
              <Form.Switch field="localizeImages" noLabel label="图片本地化" extraText="下载远程图片转存文件中心" />
            </div>
          </Form.Slot>
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>

      <SideSheet
        title={itemsRule ? `采集明细：${itemsRule.name}` : '采集明细'}
        visible={!!itemsRule}
        onCancel={() => setItemsRule(null)}
        width={isMobile ? '100%' : 760}
      >
        <ConfigurableTable<CmsCollectItem>
          bordered
          columns={itemColumns}
          dataSource={itemsQuery.data?.list ?? []}
          rowKey="id"
          loading={itemsQuery.isFetching}
          pagination={{
            currentPage: itemsPage,
            pageSize: 10,
            total: itemsQuery.data?.total ?? 0,
            onPageChange: setItemsPage,
          }}
        />
      </SideSheet>
    </div>
  );
}
