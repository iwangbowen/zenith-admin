import { useMemo, useRef, useState } from 'react';
import dayjs from 'dayjs';
import {
  Banner,
  Button,
  Col,
  DatePicker,
  Form,
  Input,
  Modal,
  Row,
  Select,
  SideSheet,
  TabPane,
  Tabs,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, RotateCcw, Search } from 'lucide-react';
import {
  CMS_CONTENT_TYPES,
  CMS_CONTENT_TYPE_LABELS,
  CMS_DISTRIBUTION_CONFLICT_STRATEGIES,
  CMS_DISTRIBUTION_CONFLICT_STRATEGY_LABELS,
  CMS_DISTRIBUTION_MODES,
  CMS_DISTRIBUTION_MODE_LABELS,
  CMS_DISTRIBUTION_RUN_OUTCOME_LABELS,
  CMS_DISTRIBUTION_TASK_STATUSES,
  CMS_DISTRIBUTION_TASK_STATUS_LABELS,
  type CmsChannel,
  type CmsDistributionRule,
  type CmsDistributionRun,
} from '@zenith/shared';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import AppModal from '@/components/AppModal';
import ExportButton from '@/components/ExportButton';
import { SearchToolbar } from '@/components/SearchToolbar';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { createdAtColumn, renderEllipsis } from '@/utils/table-columns';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { useAllCmsSites, useCmsChannelTree } from '@/hooks/queries/cms';
import { useAsyncTaskAction } from '@/hooks/queries/async-tasks';
import {
  cmsDistributionKeys,
  useCmsDistributionRuleList,
  useCmsDistributionRunDetail,
  useCmsDistributionRunList,
  useDeleteCmsDistributionRule,
  useRunCmsDistributionRule,
  useSaveCmsDistributionRule,
} from '@/hooks/queries/cms-stage5';
import { useQueryClient } from '@tanstack/react-query';

interface RuleSearch {
  keyword: string;
  sourceSiteId?: number;
  targetSiteId?: number;
  mode?: string;
  status?: string;
}

interface RunSearch {
  ruleId?: number;
  siteId?: number;
  status?: string;
  range: Date[];
}

const EMPTY_RULE_SEARCH: RuleSearch = { keyword: '' };
const EMPTY_RUN_SEARCH: RunSearch = { range: [] };

function flattenChannels(nodes: CmsChannel[]): CmsChannel[] {
  return nodes.flatMap((node) => [node, ...flattenChannels(node.children ?? [])]);
}

export default function DistributionPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const rulePagination = usePagination();
  const runPagination = usePagination();
  const formApi = useRef<FormApi | null>(null);
  const { items: commonStatuses } = useDictItems('common_status');
  const { data: sites } = useAllCmsSites();
  const [ruleDraft, setRuleDraft] = useState<RuleSearch>(EMPTY_RULE_SEARCH);
  const [ruleSubmitted, setRuleSubmitted] = useState<RuleSearch>(EMPTY_RULE_SEARCH);
  const [runDraft, setRunDraft] = useState<RunSearch>(EMPTY_RUN_SEARCH);
  const [runSubmitted, setRunSubmitted] = useState<RunSearch>(EMPTY_RUN_SEARCH);
  const [editingRule, setEditingRule] = useState<CmsDistributionRule | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [formSourceSiteId, setFormSourceSiteId] = useState<number>();
  const [formTargetSiteId, setFormTargetSiteId] = useState<number>();
  const [formMode, setFormMode] = useState<string>('copy');
  const [detailRunId, setDetailRunId] = useState<number>();

  const ruleQuery = useCmsDistributionRuleList({
    page: rulePagination.page,
    pageSize: rulePagination.pageSize,
    keyword: ruleSubmitted.keyword || undefined,
    sourceSiteId: ruleSubmitted.sourceSiteId,
    targetSiteId: ruleSubmitted.targetSiteId,
    mode: ruleSubmitted.mode as CmsDistributionRule['mode'] | undefined,
    status: ruleSubmitted.status,
  });
  const runQuery = useCmsDistributionRunList({
    page: runPagination.page,
    pageSize: runPagination.pageSize,
    ruleId: runSubmitted.ruleId,
    siteId: runSubmitted.siteId,
    status: runSubmitted.status,
    startTime: runSubmitted.range[0] ? formatDateTimeForApi(runSubmitted.range[0]) : undefined,
    endTime: runSubmitted.range[1] ? formatDateTimeForApi(runSubmitted.range[1]) : undefined,
  });
  const runDetailQuery = useCmsDistributionRunDetail(detailRunId, detailRunId !== undefined);
  const saveMutation = useSaveCmsDistributionRule();
  const deleteMutation = useDeleteCmsDistributionRule();
  const runMutation = useRunCmsDistributionRule();
  const cancelRunMutation = useAsyncTaskAction('cancel');
  const resumeRunMutation = useAsyncTaskAction('resume');
  const restartRunMutation = useAsyncTaskAction('restart');
  const sourceChannelsQuery = useCmsChannelTree(formSourceSiteId);
  const targetChannelsQuery = useCmsChannelTree(formTargetSiteId);
  const sourceChannels = useMemo(() => flattenChannels(sourceChannelsQuery.data ?? []), [sourceChannelsQuery.data]);
  const targetChannels = useMemo(() => flattenChannels(targetChannelsQuery.data ?? []), [targetChannelsQuery.data]);

  function searchRules() {
    rulePagination.setPage(1);
    setRuleSubmitted(ruleDraft);
    void queryClient.invalidateQueries({ queryKey: cmsDistributionKeys.lists });
  }

  function resetRules() {
    rulePagination.setPage(1);
    setRuleDraft(EMPTY_RULE_SEARCH);
    setRuleSubmitted(EMPTY_RULE_SEARCH);
    void queryClient.invalidateQueries({ queryKey: cmsDistributionKeys.lists });
  }

  function searchRuns() {
    runPagination.setPage(1);
    setRunSubmitted(runDraft);
    void queryClient.invalidateQueries({ queryKey: cmsDistributionKeys.runs });
  }

  function resetRuns() {
    runPagination.setPage(1);
    setRunDraft(EMPTY_RUN_SEARCH);
    setRunSubmitted(EMPTY_RUN_SEARCH);
    void queryClient.invalidateQueries({ queryKey: cmsDistributionKeys.runs });
  }

  function openCreate() {
    setEditingRule(null);
    setFormSourceSiteId(undefined);
    setFormTargetSiteId(undefined);
    setFormMode('copy');
    setModalVisible(true);
  }

  function openEdit(rule: CmsDistributionRule) {
    setEditingRule(rule);
    setFormSourceSiteId(rule.sourceSiteId);
    setFormTargetSiteId(rule.targetSiteId);
    setFormMode(rule.mode);
    setModalVisible(true);
  }

  async function saveRule() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      return;
    }
    const publishedFrom = values.publishedFrom instanceof Date
      ? formatDateTimeForApi(values.publishedFrom)
      : null;
    const publishedTo = values.publishedTo instanceof Date
      ? formatDateTimeForApi(values.publishedTo)
      : null;
    const payload = {
      name: values.name,
      sourceSiteId: values.sourceSiteId,
      sourceChannelId: values.sourceChannelId ?? null,
      targetSiteId: values.targetSiteId,
      targetChannelId: values.targetChannelId,
      mode: values.mode,
      conflictStrategy: values.conflictStrategy,
      filters: {
        statuses: ['published'],
        contentTypes: values.contentTypes ?? [],
        keyword: String(values.keyword ?? '').trim() || null,
        publishedFrom,
        publishedTo,
      },
      scheduleCron: values.mode === 'scheduled' ? String(values.scheduleCron ?? '').trim() : null,
      status: values.status,
      remark: String(values.remark ?? '').trim() || null,
    };
    await saveMutation.mutateAsync({ id: editingRule?.id, values: payload });
    Toast.success(editingRule ? '分发规则已更新' : '分发规则已创建');
    setModalVisible(false);
  }

  async function runRule(rule: CmsDistributionRule) {
    await runMutation.mutateAsync(rule.id);
    Toast.success('分发任务已提交，可在“同步结果”查看进度');
  }

  async function toggleRule(rule: CmsDistributionRule) {
    await saveMutation.mutateAsync({
      id: rule.id,
      values: { status: rule.status === 'enabled' ? 'disabled' : 'enabled' },
    });
    Toast.success(rule.status === 'enabled' ? '规则已停用' : '规则已启用');
  }

  async function runTaskAction(run: CmsDistributionRun, action: 'cancel' | 'resume' | 'restart') {
    const mutation = action === 'cancel'
      ? cancelRunMutation
      : action === 'resume'
        ? resumeRunMutation
        : restartRunMutation;
    await mutation.mutateAsync(run.id);
    Toast.success(action === 'cancel' ? '已请求取消任务' : action === 'resume' ? '任务已恢复' : '任务已重新开始');
    void queryClient.invalidateQueries({ queryKey: cmsDistributionKeys.runs });
  }

  const ruleColumns: ColumnProps<CmsDistributionRule>[] = [
    { title: '规则名称', dataIndex: 'name', width: 190, render: renderEllipsis },
    {
      title: '来源',
      width: 210,
      render: (_: unknown, row) => `${row.sourceSiteName}${row.sourceChannelName ? ` / ${row.sourceChannelName}` : ' / 全站'}`,
    },
    {
      title: '目标',
      width: 210,
      render: (_: unknown, row) => `${row.targetSiteName} / ${row.targetChannelName}`,
    },
    {
      title: '模式',
      dataIndex: 'mode',
      width: 110,
      render: (value: CmsDistributionRule['mode']) => CMS_DISTRIBUTION_MODE_LABELS[value],
    },
    {
      title: '冲突策略',
      dataIndex: 'conflictStrategy',
      width: 110,
      render: (value: CmsDistributionRule['conflictStrategy']) => CMS_DISTRIBUTION_CONFLICT_STRATEGY_LABELS[value],
    },
    {
      title: '筛选条件',
      width: 220,
      render: (_: unknown, row) => {
        const parts = [
          row.filters.keyword ? `关键词：${row.filters.keyword}` : null,
          row.filters.contentTypes.length
            ? row.filters.contentTypes.map((type) => CMS_CONTENT_TYPE_LABELS[type]).join('、')
            : null,
        ].filter(Boolean);
        return parts.length ? parts.join('；') : '全部已发布内容';
      },
    },
    { title: '最近同步', dataIndex: 'lastRunAt', width: 170, render: (value: string | null) => value ?? '-' },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (value: CmsDistributionRule['status']) =>
        <Tag color={value === 'enabled' ? 'green' : 'grey'} size="small">
          {commonStatuses.find((item) => item.value === value)?.label ?? value}
        </Tag>,
    },
    createOperationColumn<CmsDistributionRule>({
      width: 210,
      desktopInlineKeys: ['run', 'edit'],
      actions: (rule) => {
        const actions: ResponsiveTableAction[] = [];
        if (hasPermission('cms:distribution:run')) actions.push({
          key: 'run',
          label: '执行',
          onClick: () => void runRule(rule),
          ...(rule.status !== 'enabled' ? { disabledReason: '规则已停用' } : {}),
        });
        if (hasPermission('cms:distribution:update')) actions.push({
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(rule),
        }, {
          key: 'toggle',
          label: rule.status === 'enabled' ? '停用' : '启用',
          onClick: () => void toggleRule(rule),
        });
        if (hasPermission('cms:distribution:delete')) actions.push({
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: `删除分发规则「${rule.name}」？`,
              content: '已物化内容会保留并解除规则关联；进行中的旧任务会因 revision/rule fence 安全取消。',
              onOk: async () => {
                await deleteMutation.mutateAsync(rule.id);
                Toast.success('规则已删除');
              },
            });
          },
        });
        return actions;
      },
    }),
  ];

  const runColumns: ColumnProps<CmsDistributionRun>[] = [
    { title: '任务', dataIndex: 'title', width: 240, render: renderEllipsis },
    { title: '规则', dataIndex: 'ruleName', width: 180, render: (value: string | null) => value ?? '-' },
    {
      title: '站点范围',
      width: 230,
      render: (_: unknown, run) => `${run.sourceSiteName ?? `#${run.sourceSiteId}`} → ${run.targetSiteName ?? `#${run.targetSiteId}`}`,
    },
    { title: '进度', width: 240, render: (_: unknown, run) => <AsyncTaskProgress task={run} /> },
    {
      title: '结果',
      width: 210,
      render: (_: unknown, run) => `成功 ${run.succeeded} / 跳过 ${run.skipped} / 冲突 ${run.conflicts} / 失败 ${run.failedCount}`,
    },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 90,
      fixed: 'right',
      render: (value: CmsDistributionRun['status']) => (
        <Tag color={value === 'success' ? 'green' : value === 'failed' ? 'red' : value === 'running' ? 'blue' : 'grey'} size="small">
          {CMS_DISTRIBUTION_TASK_STATUS_LABELS[value]}
        </Tag>
      ),
    },
    createOperationColumn<CmsDistributionRun>({
      width: 160,
      desktopInlineKeys: ['detail'],
      actions: (run) => {
        const actions: ResponsiveTableAction[] = [{
          key: 'detail',
          label: '详情',
          onClick: () => setDetailRunId(run.id),
        }];
        if (hasPermission('cms:distribution:run') && ['pending', 'running'].includes(run.status)) actions.push({
          key: 'cancel',
          label: '取消',
          danger: true,
          onClick: () => void runTaskAction(run, 'cancel'),
        });
        if (hasPermission('cms:distribution:run') && run.status === 'cancelled') actions.push({
          key: 'resume',
          label: '恢复',
          onClick: () => void runTaskAction(run, 'resume'),
        });
        if (hasPermission('cms:distribution:run') && ['failed', 'success', 'cancelled'].includes(run.status)) actions.push({
          key: 'restart',
          label: '重试',
          onClick: () => void runTaskAction(run, 'restart'),
        });
        return actions;
      },
    }),
  ];

  const itemColumns: ColumnProps<NonNullable<typeof runDetailQuery.data>['items'][number]>[] = [
    { title: '来源内容', dataIndex: 'label', width: 220, render: renderEllipsis },
    {
      title: '结果',
      width: 90,
      render: (_: unknown, item) => {
        const outcome = String(item.data?.outcome ?? item.status) as keyof typeof CMS_DISTRIBUTION_RUN_OUTCOME_LABELS;
        return CMS_DISTRIBUTION_RUN_OUTCOME_LABELS[outcome] ?? outcome;
      },
    },
    { title: '说明', dataIndex: 'message', width: 280, render: renderEllipsis },
    {
      title: '内容 ID',
      width: 170,
      render: (_: unknown, item) => `${item.data?.sourceContentId ?? '-'} → ${item.data?.targetContentId ?? '-'}`,
    },
    { title: '更新时间', dataIndex: 'updatedAt', width: 170 },
  ];

  const siteOptions = (sites ?? []).map((site) => ({ value: site.id, label: site.name }));
  const ruleOptions = (ruleQuery.data?.list ?? []).map((rule) => ({ value: rule.id, label: rule.name }));
  const formInitialValues = editingRule ? {
    name: editingRule.name,
    sourceSiteId: editingRule.sourceSiteId,
    sourceChannelId: editingRule.sourceChannelId ?? undefined,
    targetSiteId: editingRule.targetSiteId,
    targetChannelId: editingRule.targetChannelId,
    mode: editingRule.mode,
    conflictStrategy: editingRule.conflictStrategy,
    contentTypes: editingRule.filters.contentTypes,
    keyword: editingRule.filters.keyword ?? '',
    publishedFrom: editingRule.filters.publishedFrom ? dayjs(editingRule.filters.publishedFrom).toDate() : undefined,
    publishedTo: editingRule.filters.publishedTo ? dayjs(editingRule.filters.publishedTo).toDate() : undefined,
    scheduleCron: editingRule.scheduleCron ?? '',
    status: editingRule.status,
    remark: editingRule.remark ?? '',
  } : {
    mode: 'copy',
    conflictStrategy: 'skip',
    contentTypes: [],
    status: 'enabled',
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line">
        <TabPane tab="分发规则" itemKey="rules">
          <Banner
            type="info"
            closeIcon={null}
            style={{ marginBottom: 12 }}
            description="仅同步已发布内容；所有写入都先校验来源与目标 ACL。copy 生成独立草稿，mapping 生成正文跟随的映射草稿，scheduled 按 Cron 提交任务。"
          />
          <SearchToolbar
            primary={(
              <>
                <Input
                  prefix={<Search size={14} />}
                  value={ruleDraft.keyword}
                  placeholder="搜索规则名称"
                  showClear
                  style={{ width: 220 }}
                  onChange={(keyword) => setRuleDraft((value) => ({ ...value, keyword }))}
                  onEnterPress={searchRules}
                />
                <Select
                  placeholder="来源站点"
                  value={ruleDraft.sourceSiteId}
                  optionList={siteOptions}
                  showClear
                  style={{ width: 150 }}
                  onChange={(sourceSiteId) => setRuleDraft((value) => ({ ...value, sourceSiteId: sourceSiteId as number | undefined }))}
                />
                <Select
                  placeholder="模式"
                  value={ruleDraft.mode}
                  optionList={CMS_DISTRIBUTION_MODES.map((mode) => ({ value: mode, label: CMS_DISTRIBUTION_MODE_LABELS[mode] }))}
                  showClear
                  style={{ width: 130 }}
                  onChange={(mode) => setRuleDraft((value) => ({ ...value, mode: mode as string | undefined }))}
                />
                <Button type="primary" icon={<Search size={14} />} onClick={searchRules}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetRules}>重置</Button>
              </>
            )}
            filters={(
              <>
                <Select
                  placeholder="目标站点"
                  value={ruleDraft.targetSiteId}
                  optionList={siteOptions}
                  showClear
                  style={{ width: 150 }}
                  onChange={(targetSiteId) => setRuleDraft((value) => ({ ...value, targetSiteId: targetSiteId as number | undefined }))}
                />
                <Select
                  placeholder="规则状态"
                  value={ruleDraft.status}
                  optionList={commonStatuses.map((item) => ({ value: item.value, label: item.label }))}
                  showClear
                  style={{ width: 130 }}
                  onChange={(status) => setRuleDraft((value) => ({ ...value, status: status as string | undefined }))}
                />
              </>
            )}
            actions={hasPermission('cms:distribution:create') ? (
              <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button>
            ) : null}
            mobilePrimary={(
              <>
                <Input
                  prefix={<Search size={14} />}
                  value={ruleDraft.keyword}
                  placeholder="搜索规则"
                  showClear
                  onChange={(keyword) => setRuleDraft((value) => ({ ...value, keyword }))}
                />
                <Button type="primary" icon={<Search size={14} />} onClick={searchRules}>查询</Button>
                {hasPermission('cms:distribution:create') ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null}
              </>
            )}
            mobileActions={false}
            onFilterApply={searchRules}
            onFilterReset={resetRules}
          />
          <ConfigurableTable
            bordered
            columns={ruleColumns}
            dataSource={ruleQuery.data?.list ?? []}
            loading={ruleQuery.isFetching}
            rowKey="id"
            scroll={{ x: 1450 }}
            pagination={rulePagination.buildPagination(ruleQuery.data?.total ?? 0)}
            onRefresh={() => void ruleQuery.refetch()}
            refreshLoading={ruleQuery.isFetching}
          />
        </TabPane>

        <TabPane tab="同步结果" itemKey="runs">
          <SearchToolbar
            primary={(
              <Select
                placeholder="分发规则"
                value={runDraft.ruleId}
                optionList={ruleOptions}
                showClear
                filter
                style={{ width: 180 }}
                onChange={(ruleId) => setRunDraft((value) => ({ ...value, ruleId: ruleId as number | undefined }))}
              />
            )}
            filters={(
              <>
                <Select
                  placeholder="站点"
                  value={runDraft.siteId}
                  optionList={siteOptions}
                  showClear
                  style={{ width: 150 }}
                  onChange={(siteId) => setRunDraft((value) => ({ ...value, siteId: siteId as number | undefined }))}
                />
                <DatePicker
                  type="dateTimeRange"
                  value={runDraft.range}
                  onChange={(range) => setRunDraft((value) => ({ ...value, range: (range as Date[] | null) ?? [] }))}
                  style={{ width: 330 }}
                />
                <Select
                  placeholder="任务状态"
                  value={runDraft.status}
                  optionList={CMS_DISTRIBUTION_TASK_STATUSES.map((status) => ({
                    value: status,
                    label: CMS_DISTRIBUTION_TASK_STATUS_LABELS[status],
                  }))}
                  showClear
                  style={{ width: 130 }}
                  onChange={(status) => setRunDraft((value) => ({ ...value, status: status as string | undefined }))}
                />
              </>
            )}
            actions={(
              <>
                <Button type="primary" icon={<Search size={14} />} onClick={searchRuns}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={resetRuns}>重置</Button>
                {hasPermission('cms:distribution:export') ? (
                  <ExportButton
                    entity="cms.distribution-runs"
                    query={{
                      ruleId: runSubmitted.ruleId,
                      siteId: runSubmitted.siteId,
                      status: runSubmitted.status,
                      startTime: runSubmitted.range[0] ? formatDateTimeForApi(runSubmitted.range[0]) : undefined,
                      endTime: runSubmitted.range[1] ? formatDateTimeForApi(runSubmitted.range[1]) : undefined,
                    }}
                  />
                ) : null}
              </>
            )}
            mobilePrimary={(
              <>
                <Select
                  placeholder="分发规则"
                  value={runDraft.ruleId}
                  optionList={ruleOptions}
                  showClear
                  style={{ width: 180 }}
                  onChange={(ruleId) => setRunDraft((value) => ({ ...value, ruleId: ruleId as number | undefined }))}
                />
                <Button type="primary" icon={<Search size={14} />} onClick={searchRuns}>查询</Button>
              </>
            )}
            mobileActions={hasPermission('cms:distribution:export') ? (
              <ExportButton entity="cms.distribution-runs" query={{
                ruleId: runSubmitted.ruleId,
                siteId: runSubmitted.siteId,
                status: runSubmitted.status,
                startTime: runSubmitted.range[0] ? formatDateTimeForApi(runSubmitted.range[0]) : undefined,
                endTime: runSubmitted.range[1] ? formatDateTimeForApi(runSubmitted.range[1]) : undefined,
              }} variant="flat" />
            ) : null}
            onFilterApply={searchRuns}
            onFilterReset={resetRuns}
          />
          <ConfigurableTable
            bordered
            columns={runColumns}
            dataSource={runQuery.data?.list ?? []}
            loading={runQuery.isFetching}
            rowKey="id"
            scroll={{ x: 1350 }}
            pagination={runPagination.buildPagination(runQuery.data?.total ?? 0)}
            onRefresh={() => void runQuery.refetch()}
            refreshLoading={runQuery.isFetching}
          />
        </TabPane>
      </Tabs>

      <AppModal
        title={editingRule ? '编辑分发规则' : '新增分发规则'}
        visible={modalVisible}
        onOk={saveRule}
        onCancel={() => setModalVisible(false)}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={760}
        closeOnEsc
      >
        <Form
          key={editingRule?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          initValues={formInitialValues}
          labelPosition="left"
          labelWidth={100}
          onValueChange={(values) => {
            const sourceSiteId = Number(values.sourceSiteId) || undefined;
            const targetSiteId = Number(values.targetSiteId) || undefined;
            setFormSourceSiteId(sourceSiteId);
            setFormTargetSiteId(targetSiteId);
            setFormMode(String(values.mode ?? 'copy'));
          }}
        >
          <Form.Input field="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} />
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="sourceSiteId" label="来源站点" optionList={siteOptions} style={{ width: '100%' }}
                rules={[{ required: true, message: '请选择来源站点' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="sourceChannelId" label="来源栏目" showClear style={{ width: '100%' }}
                placeholder="留空同步全站栏目"
                optionList={sourceChannels.map((channel) => ({ value: channel.id, label: channel.name }))} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="targetSiteId" label="目标站点" optionList={siteOptions} style={{ width: '100%' }}
                rules={[{ required: true, message: '请选择目标站点' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="targetChannelId" label="目标栏目" style={{ width: '100%' }}
                optionList={targetChannels.map((channel) => ({ value: channel.id, label: channel.name }))}
                rules={[{ required: true, message: '请选择目标栏目' }]} />
            </Col>
          </Row>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Select field="mode" label="同步模式" style={{ width: '100%' }}
                optionList={CMS_DISTRIBUTION_MODES.map((mode) => ({ value: mode, label: CMS_DISTRIBUTION_MODE_LABELS[mode] }))} />
            </Col>
            <Col span={12}>
              <Form.Select field="conflictStrategy" label="冲突策略" style={{ width: '100%' }}
                optionList={CMS_DISTRIBUTION_CONFLICT_STRATEGIES.map((strategy) => ({
                  value: strategy,
                  label: CMS_DISTRIBUTION_CONFLICT_STRATEGY_LABELS[strategy],
                }))} />
            </Col>
          </Row>
          {formMode === 'scheduled' ? (
            <Form.Input
              field="scheduleCron"
              label="Cron"
              placeholder="如 0 2 * * *（Asia/Shanghai）"
              rules={[{ required: true, message: '定时同步必须配置 Cron' }]}
            />
          ) : null}
          <Form.Section text="过滤条件（状态固定为“已发布”，防止草稿跨站泄露）">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select field="contentTypes" label="内容形态" multiple showClear style={{ width: '100%' }}
                  optionList={CMS_CONTENT_TYPES.map((type) => ({ value: type, label: CMS_CONTENT_TYPE_LABELS[type] }))} />
              </Col>
              <Col span={12}>
                <Form.Input field="keyword" label="关键词" placeholder="匹配标题或摘要" />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}><Form.DatePicker field="publishedFrom" type="dateTime" label="发布起始" style={{ width: '100%' }} /></Col>
              <Col span={12}><Form.DatePicker field="publishedTo" type="dateTime" label="发布结束" style={{ width: '100%' }} /></Col>
            </Row>
          </Form.Section>
          <Row gutter={16}>
            <Col span={12}>
              <Form.RadioGroup field="status" label="状态">
                <Form.Radio value="enabled">启用</Form.Radio>
                <Form.Radio value="disabled">停用</Form.Radio>
              </Form.RadioGroup>
            </Col>
          </Row>
          <Form.TextArea field="remark" label="备注" rows={2} />
        </Form>
      </AppModal>

      <SideSheet
        title={runDetailQuery.data ? `同步详情 #${runDetailQuery.data.run.id}` : '同步详情'}
        visible={detailRunId !== undefined}
        onCancel={() => setDetailRunId(undefined)}
        width={880}
        closeOnEsc
      >
        {runDetailQuery.data ? (
          <>
            <Banner
              type="info"
              closeIcon={null}
              style={{ marginBottom: 12 }}
              description={`规则：${runDetailQuery.data.run.ruleName ?? '-'}；来源 ${runDetailQuery.data.run.sourceSiteName ?? '-'} → 目标 ${runDetailQuery.data.run.targetSiteName ?? '-'}`}
            />
            <div style={{ marginBottom: 12 }}><AsyncTaskProgress task={runDetailQuery.data.run} /></div>
            <ConfigurableTable
              bordered
              columns={itemColumns}
              dataSource={runDetailQuery.data.items}
              loading={runDetailQuery.isFetching}
              rowKey="id"
              pagination={false}
              scroll={{ x: 1000 }}
              onRefresh={() => void runDetailQuery.refetch()}
              refreshLoading={runDetailQuery.isFetching}
            />
          </>
        ) : null}
      </SideSheet>
    </div>
  );
}
