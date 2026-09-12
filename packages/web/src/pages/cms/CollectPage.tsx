/** 采集中心：规则 CRUD + 任务中心执行 + 采集明细（P3 Batch5） */
import { useMemo, useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { Col, Form, Row, SideSheet, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import { useListSearch } from '@/hooks/useListSearch';
import { useMyAsyncTasks } from '@/hooks/useAsyncTasks';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import {
  useCmsChannelTree, useCmsCollectRules, useSaveCmsCollectRule, useDeleteCmsCollectRules,
  useRunCmsCollectRule, useCmsCollectItems, cmsCollectKeys,
} from '@/hooks/queries/cms';
import type { CmsCollectRule, CmsCollectItem } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { EMPTY_PLACEHOLDER, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';
import { channelsToSelectTree } from './channel-tree';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';

const ITEM_STATUS_META: Record<CmsCollectItem['status'], { label: string; color: 'green' | 'grey' | 'red' }> = {
  success: { label: '成功', color: 'green' },
  skipped: { label: '跳过', color: 'grey' },
  failed: { label: '失败', color: 'red' },
};
interface SearchParams { keyword: string }
const defaultSearchParams: SearchParams = { keyword: '' };

export default function CollectPage() {
  const { hasPermission } = usePermission();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const {
    page, pageSize, buildPagination, resetPage,
    bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: cmsCollectKeys.lists });
  const [itemsRule, setItemsRule] = useState<CmsCollectRule | null>(null);
  const itemsPagination = usePagination(10);

  const listQuery = useCmsCollectRules({ page, pageSize, siteId, keyword: submittedParams.keyword || undefined });
  const treeQuery = useCmsChannelTree(siteId);
  const saveMutation = useSaveCmsCollectRule();
  const modal = useEditModal<CmsCollectRule, Partial<CmsCollectRule>, Record<string, unknown>>({
    entityName: '采集规则',
    save: saveMutation,
    defaults: { pageStart: 1, pageEnd: 1, maxItems: 50, autoPublish: false, localizeImages: false, status: 'enabled', removeSelectors: [] },
    labelWidth: 110,
    toValues: (record) => ({
      channelId: record.channelId, name: record.name, listUrl: record.listUrl, pageStart: record.pageStart, pageEnd: record.pageEnd,
      listSelector: record.listSelector, titleSelector: record.titleSelector, bodySelector: record.bodySelector, summarySelector: record.summarySelector ?? '',
      coverSelector: record.coverSelector ?? '', removeSelectors: record.removeSelectors, autoPublish: record.autoPublish, localizeImages: record.localizeImages,
      maxItems: record.maxItems, status: record.status, remark: record.remark ?? '',
    }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      return { ...values, ...(!isEdit ? { siteId } : {}) };
    },
  });
  const deleteMutation = useDeleteCmsCollectRules();
  const runMutation = useRunCmsCollectRule();
  const itemsQuery = useCmsCollectItems(itemsRule?.id, { page: itemsPagination.page, pageSize: itemsPagination.pageSize });
  const { tasks, refresh: refreshTasks } = useMyAsyncTasks({ taskTypes: ['cms-collect-run'] });
  const runningTasks = useMemo(() => tasks.filter((t) => t.status === 'running' || t.status === 'pending'), [tasks]);

  async function handleRun(record: CmsCollectRule) {
    await runMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('采集任务已提交');
    refreshTasks();
  }

  const columns: ColumnProps<CmsCollectRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 160 },
    { title: '目标栏目', dataIndex: 'channelName', width: 120, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    { title: '列表页 URL', dataIndex: 'listUrl', minWidth: 260, render: renderEllipsis },
    { title: '翻页', width: 90, render: (_: unknown, r) => (r.listUrl.includes('{page}') ? `${r.pageStart}-${r.pageEnd}` : '单页') },
    { title: '单次上限', dataIndex: 'maxItems', width: 90, align: 'right' },
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
    dateTimeColumn('最近执行', 'lastRunAt'),
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
          onClick: () => { itemsPagination.setPage(1); setItemsRule(record); },
        },
        ...(hasPermission('cms:collect:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => modal.openEdit(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('cms:collect:delete'),
          title: `删除规则「${record.name}」？`,
          content: '采集明细将一并删除，已入库内容不受影响',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  const itemColumns: ColumnProps<CmsCollectItem>[] = [
    { title: 'URL', dataIndex: 'url', width: 280, render: renderEllipsis },
    { title: '标题', dataIndex: 'title', width: 200, render: renderEllipsis },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      render: (v: CmsCollectItem['status']) => <Tag size="small" color={ITEM_STATUS_META[v].color}>{ITEM_STATUS_META[v].label}</Tag>,
    },
    { title: '错误', dataIndex: 'error', width: 200, render: renderEllipsis },
    dateTimeColumn('采集时间', 'createdAt'),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <>
            <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); resetPage(); }} />
            <KeywordInput placeholder="规则名称" {...bindKeyword('keyword')} width={200} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={hasPermission('cms:collect:create') ? <CreateButton onClick={modal.openCreate} /> : null}
      />

      {runningTasks.length > 0 ? (
        <div style={{ marginBottom: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
          {runningTasks.map((t) => <AsyncTaskProgress key={t.id} task={t} />)}
        </div>
      ) : null}

      <ConfigurableTable<CmsCollectRule>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination })}
      />

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={720}
        footer={<ModalFooter {...modal.footerProps} okText="保存" />}
      >
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Section text="基础信息">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} />
              </Col>
              <Col span={12}>
                <Form.TreeSelect field="channelId" label="目标栏目" style={{ width: '100%' }}
                  treeData={channelsToSelectTree(treeQuery.data ?? [])}
                  rules={[{ required: true, message: '请选择目标栏目' }]} />
              </Col>
            </Row>
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
          </Form.Section>

          <Form.Section text="页面选择器">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="listSelector" label="条目选择器" placeholder="如 .news-list li a"
                  rules={[{ required: true, message: '请输入条目链接选择器' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="titleSelector" label="标题选择器" placeholder="如 h1.title"
                  rules={[{ required: true, message: '请输入标题选择器' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="bodySelector" label="正文选择器" placeholder="如 .article-content"
                  rules={[{ required: true, message: '请输入正文选择器' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="summarySelector" label="摘要选择器" placeholder="选填，如 .summary" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="coverSelector" label="封面选择器" placeholder="选填，如 .cover img" />
              </Col>
            </Row>
            <Form.TagInput field="removeSelectors" label="清洗选择器" placeholder="回车添加：正文中要移除的节点（广告等）" />
          </Form.Section>

          <Form.Section text="采集选项">
            <Form.Slot label="采集后处理">
              <div style={{ display: 'flex', gap: 24 }}>
                <Form.Switch field="autoPublish" noLabel label="自动发布" extraText="采集后直接发布并静态化" />
                <Form.Switch field="localizeImages" noLabel label="图片本地化" extraText="下载远程图片转存文件中心" />
              </div>
            </Form.Slot>
            <FormStatusRadioGroup />
            <Form.Input field="remark" label="备注" />
          </Form.Section>
        </Form>
      </SideSheet>

      <SideSheet
        title={itemsRule ? `采集明细：${itemsRule.name}` : '采集明细'}
        visible={!!itemsRule}
        onCancel={() => setItemsRule(null)}
        closeOnEsc
        width={760}
      >
        <ConfigurableTable<CmsCollectItem>
          columns={itemColumns}
          {...listTableProps(itemsQuery, {
            pagination: itemsPagination.buildPagination,
          })}
        />
      </SideSheet>
    </div>
  );
}
