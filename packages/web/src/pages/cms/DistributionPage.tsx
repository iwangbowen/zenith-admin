import { useMemo, useState } from 'react';
import dayjs from 'dayjs';
import { Banner, Button, Col, DatePicker, Form, Row, SideSheet, TabPane, Tabs, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { CMS_CONTENT_TYPES, CMS_CONTENT_TYPE_LABELS, CMS_DISTRIBUTION_CONFLICT_STRATEGIES, CMS_DISTRIBUTION_CONFLICT_STRATEGY_LABELS, CMS_DISTRIBUTION_MODES, CMS_DISTRIBUTION_MODE_LABELS, CMS_DISTRIBUTION_RUN_OUTCOME_LABELS, CMS_DISTRIBUTION_TASK_STATUSES, CMS_DISTRIBUTION_TASK_STATUS_LABELS } from '@zenith/shared/cms';
import type { CmsChannel, CmsDistributionRule, CmsDistributionRun } from '@zenith/shared/cms';
import { enumValueOf, USER_STATUSES } from '@zenith/shared/core';
import ConfigurableTable from '@/components/ConfigurableTable';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import ExportButton from '@/components/ExportButton';
import { SearchToolbar } from '@/components/SearchToolbar';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { createdAtColumn, dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { formatDateTimeForApi, formatDateTimeRangeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import { useDictItems } from '@/hooks/useDictItems';
import { useAllCmsSites, useCmsChannelTree } from '@/hooks/queries/cms';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { useAsyncTaskAction } from '@/hooks/queries/async-tasks';
import {
  cmsDistributionKeys,
  useCmsDistributionRuleList,
  useCmsDistributionRunDetail,
  useCmsDistributionRunList,
  useDeleteCmsDistributionRules,
  useRunCmsDistributionRule,
  useSaveCmsDistributionRule,
} from '@/hooks/queries/cms-stage5';
import { useQueryClient } from '@tanstack/react-query';
import { CreateButton, ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

import { useUrlTabState } from '@/hooks/useUrlTabState';
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
  const [activeTab, setActiveTab] = useUrlTabState(['rules', 'runs'] as const, 'rules');
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const rulePagination = usePagination();
  const runPagination = usePagination();
  const { items: commonStatuses } = useDictItems('common_status');
  const { data: sites } = useAllCmsSites();
  const [ruleDraft, setRuleDraft] = useState<RuleSearch>(EMPTY_RULE_SEARCH);
  const [ruleSubmitted, setRuleSubmitted] = useState<RuleSearch>(EMPTY_RULE_SEARCH);
  const [runDraft, setRunDraft] = useState<RunSearch>(EMPTY_RUN_SEARCH);
  const [runSubmitted, setRunSubmitted] = useState<RunSearch>(EMPTY_RUN_SEARCH);
  const [formSourceSiteId, setFormSourceSiteId] = useState<number>();
  const [formTargetSiteId, setFormTargetSiteId] = useState<number>();
  const [formMode, setFormMode] = useState<string>('copy');
  const [formCron, setFormCron] = useState('');
  const [detailRunId, setDetailRunId] = useState<number>();

  const ruleQuery = useCmsDistributionRuleList({
    page: rulePagination.page,
    pageSize: rulePagination.pageSize,
    keyword: ruleSubmitted.keyword || undefined,
    sourceSiteId: ruleSubmitted.sourceSiteId,
    targetSiteId: ruleSubmitted.targetSiteId,
    mode: enumValueOf(CMS_DISTRIBUTION_MODES, ruleSubmitted.mode),
    status: enumValueOf(USER_STATUSES, ruleSubmitted.status),
  });
  const runQuery = useCmsDistributionRunList({
    page: runPagination.page,
    pageSize: runPagination.pageSize,
    ruleId: runSubmitted.ruleId,
    siteId: runSubmitted.siteId,
    status: enumValueOf(CMS_DISTRIBUTION_TASK_STATUSES, runSubmitted.status),
    ...formatDateTimeRangeForApi(runSubmitted.range),
  });
  const runDetailQuery = useCmsDistributionRunDetail(detailRunId, detailRunId !== undefined);
  const saveMutation = useSaveCmsDistributionRule();
  const ruleModal = useEditModal<CmsDistributionRule, Record<string, unknown>, Record<string, unknown>>({
    entityName: '分发规则',
    save: saveMutation,
    defaults: { mode: 'copy', conflictStrategy: 'skip', contentTypes: [], status: 'enabled' },
    labelWidth: 100,
    toValues: (rule) => ({
      name: rule.name,
      sourceSiteId: rule.sourceSiteId,
      sourceChannelId: rule.sourceChannelId ?? undefined,
      targetSiteId: rule.targetSiteId,
      targetChannelId: rule.targetChannelId,
      mode: rule.mode,
      conflictStrategy: rule.conflictStrategy,
      contentTypes: rule.filters.contentTypes,
      keyword: rule.filters.keyword ?? '',
      publishedFrom: rule.filters.publishedFrom ? dayjs(rule.filters.publishedFrom).toDate() : undefined,
      publishedTo: rule.filters.publishedTo ? dayjs(rule.filters.publishedTo).toDate() : undefined,
      scheduleCron: rule.scheduleCron ?? '',
      status: rule.status,
      remark: rule.remark ?? '',
    }),
    beforeSave: (values) => ({
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
        publishedFrom: values.publishedFrom instanceof Date ? formatDateTimeForApi(values.publishedFrom) : null,
        publishedTo: values.publishedTo instanceof Date ? formatDateTimeForApi(values.publishedTo) : null,
      },
      scheduleCron: values.mode === 'scheduled' ? String(values.scheduleCron ?? '').trim() : null,
      status: values.status,
      remark: String(values.remark ?? '').trim() || null,
    }),
    successMessage: ({ isEdit }) => isEdit ? '分发规则已更新' : '分发规则已创建',
  });
  const deleteMutation = useDeleteCmsDistributionRules();
  const runMutation = useRunCmsDistributionRule();
  const cancelRunMutation = useAsyncTaskAction('cancel');
  const resumeRunMutation = useAsyncTaskAction('resume');
  const restartRunMutation = useAsyncTaskAction('restart');
  const sourceChannelsQuery = useCmsChannelTree(formSourceSiteId);
  const targetChannelsQuery = useCmsChannelTree(formTargetSiteId);
  const sourceChannels = useMemo(() => flattenChannels(sourceChannelsQuery.data ?? []), [sourceChannelsQuery.data]);
  const targetChannels = useMemo(() => flattenChannels(targetChannelsQuery.data ?? []), [targetChannelsQuery.data]);

  const openCreate = () => {
    setFormSourceSiteId(undefined);
    setFormTargetSiteId(undefined);
    setFormMode('copy');
    setFormCron('');
    ruleModal.openCreate();
  };

  const openEdit = (rule: CmsDistributionRule) => {
    setFormSourceSiteId(rule.sourceSiteId);
    setFormTargetSiteId(rule.targetSiteId);
    setFormMode(rule.mode);
    setFormCron(rule.scheduleCron ?? '');
    ruleModal.openEdit(rule);
  };

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

  async function runRule(rule: CmsDistributionRule) {
    await runMutation.mutateAsync({ params: { id: rule.id } });
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
    await mutation.mutateAsync({ params: { id: run.id } });
    Toast.success(action === 'cancel' ? '已请求取消任务' : action === 'resume' ? '任务已恢复' : '任务已重新开始');
    void queryClient.invalidateQueries({ queryKey: cmsDistributionKeys.runs });
  }

  const ruleColumns: ColumnProps<CmsDistributionRule>[] = [
    { title: '规则名称', dataIndex: 'name', minWidth: 190, render: renderEllipsis },
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
    dateTimeColumn('最近同步', 'lastRunAt'),
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
      width: 180,
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
            confirmDelete({
              title: `删除分发规则「${rule.name}」？`,
              content: '已物化内容会保留并解除规则关联；进行中的旧任务会因 revision/rule fence 安全取消。',
              onOk: async () => {
                await deleteMutation.mutateAsync([rule.id]);
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
    { title: '任务', dataIndex: 'title', minWidth: 240, render: renderEllipsis },
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
      width: 120,
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
    dateTimeColumn('更新时间', 'updatedAt'),
  ];

  const siteOptions = (sites ?? []).map((site) => ({ value: site.id, label: site.name }));
  const ruleOptions = (ruleQuery.data?.list ?? []).map((rule) => ({ value: rule.id, label: rule.name }));
  return (
    <div className="page-container page-tabs-page">
      <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
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
                <KeywordInput placeholder="搜索规则名称" value={ruleDraft.keyword} onChange={(keyword) => setRuleDraft((value) => ({ ...value, keyword }))} onSearch={searchRules} />
                <FilterSelect
                  placeholder="全部来源站点"
                  items={siteOptions}
                  value={ruleDraft.sourceSiteId}
                  onChange={(sourceSiteId) => setRuleDraft((value) => ({ ...value, sourceSiteId: sourceSiteId as number | undefined }))}
                  width={150}
                />
                <FilterSelect
                  placeholder="全部模式"
                  items={CMS_DISTRIBUTION_MODES.map((mode) => ({ value: mode, label: CMS_DISTRIBUTION_MODE_LABELS[mode] }))}
                  value={ruleDraft.mode}
                  onChange={(mode) => setRuleDraft((value) => ({ ...value, mode: mode as string | undefined }))}
                />
                <SearchButton onClick={searchRules} />
                <ResetButton onClick={resetRules} />
              </>
            )}
            filters={(
              <>
                <FilterSelect
                  placeholder="全部目标站点"
                  items={siteOptions}
                  value={ruleDraft.targetSiteId}
                  onChange={(targetSiteId) => setRuleDraft((value) => ({ ...value, targetSiteId: targetSiteId as number | undefined }))}
                  width={150}
                />
                <FilterSelect
                  placeholder="全部规则状态"
                  items={commonStatuses}
                  value={ruleDraft.status}
                  onChange={(status) => setRuleDraft((value) => ({ ...value, status: status as string | undefined }))}
                  width={140}
                />
              </>
            )}
            actions={hasPermission('cms:distribution:create') ? (
              <CreateButton onClick={openCreate} />
            ) : null}
            mobilePrimary={(
              <>
                <KeywordInput placeholder="搜索规则" value={ruleDraft.keyword} onChange={(keyword) => setRuleDraft((value) => ({ ...value, keyword }))} />
                <SearchButton onClick={searchRules} />
                {hasPermission('cms:distribution:create') ? <CreateButton onClick={openCreate} /> : null}
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
            pagination={rulePagination.buildPagination(ruleQuery.data?.total ?? 0)}
            onRefresh={() => void ruleQuery.refetch()}
            refreshLoading={ruleQuery.isFetching}
          />
        </TabPane>

        <TabPane tab="同步结果" itemKey="runs">
          <SearchToolbar
            primary={(
              <FilterSelect
                placeholder="全部分发规则"
                items={ruleOptions}
                value={runDraft.ruleId}
                onChange={(ruleId) => setRunDraft((value) => ({ ...value, ruleId: ruleId as number | undefined }))}
                width={180}
                filter
              />
            )}
            filters={(
              <>
                <FilterSelect
                  placeholder="全部站点"
                  items={siteOptions}
                  value={runDraft.siteId}
                  onChange={(siteId) => setRunDraft((value) => ({ ...value, siteId: siteId as number | undefined }))}
                  width={150}
                />
                <DatePicker
                  type="dateTimeRange"
                  value={runDraft.range}
                  onChange={(range) => setRunDraft((value) => ({ ...value, range: (range as Date[] | null) ?? [] }))}
                  style={{ width: 330 }}
                />
                <FilterSelect
                  placeholder="全部任务状态"
                  items={CMS_DISTRIBUTION_TASK_STATUSES.map((status) => ({
                    value: status,
                    label: CMS_DISTRIBUTION_TASK_STATUS_LABELS[status],
                  }))}
                  value={runDraft.status}
                  onChange={(status) => setRunDraft((value) => ({ ...value, status: status as string | undefined }))}
                  width={140}
                />
              </>
            )}
            actions={(
              <>
                <SearchButton onClick={searchRuns} />
                <ResetButton onClick={resetRuns} />
                {hasPermission('cms:distribution:export') ? (
                  <ExportButton
                    entity="cms.distribution-runs"
                    permission="cms:distribution:export"
                    query={{
                      ruleId: runSubmitted.ruleId,
                      siteId: runSubmitted.siteId,
                      status: runSubmitted.status,
                      ...formatDateTimeRangeForApi(runSubmitted.range),
                    }}
                  />
                ) : null}
              </>
            )}
            mobilePrimary={(
              <>
                <FilterSelect
                  placeholder="全部分发规则"
                  items={ruleOptions}
                  value={runDraft.ruleId}
                  onChange={(ruleId) => setRunDraft((value) => ({ ...value, ruleId: ruleId as number | undefined }))}
                  width={180}
                />
                <SearchButton onClick={searchRuns} />
              </>
            )}
            mobileActions={hasPermission('cms:distribution:export') ? (
              <ExportButton entity="cms.distribution-runs" permission="cms:distribution:export" query={{
                ruleId: runSubmitted.ruleId,
                siteId: runSubmitted.siteId,
                status: runSubmitted.status,
                ...formatDateTimeRangeForApi(runSubmitted.range),
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
            pagination={runPagination.buildPagination(runQuery.data?.total ?? 0)}
            onRefresh={() => void runQuery.refetch()}
            refreshLoading={runQuery.isFetching}
          />
        </TabPane>
      </Tabs>

      <SideSheet
        title={ruleModal.modalProps.title}
        visible={ruleModal.visible}
        onCancel={ruleModal.close}
        closeOnEsc
        width={780}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={ruleModal.close}>取消</Button>
            <Button
              type="primary"
              theme="solid"
              loading={ruleModal.modalProps.okButtonProps.loading}
              disabled={ruleModal.modalProps.okButtonProps.disabled}
              onClick={() => void ruleModal.modalProps.onOk()}
            >
              保存
            </Button>
          </div>
        )}
      >
        <Form
          key={ruleModal.formKey} {...ruleModal.formProps}
          onValueChange={(values) => {
            const sourceSiteId = Number(values.sourceSiteId) || undefined;
            const targetSiteId = Number(values.targetSiteId) || undefined;
            setFormSourceSiteId(sourceSiteId);
            setFormTargetSiteId(targetSiteId);
            setFormMode(String(values.mode ?? 'copy'));
            setFormCron(String(values.scheduleCron ?? ''));
          }}
        >
          <Form.Section text="基础信息">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="规则名称" rules={[{ required: true, message: '请输入规则名称' }]} />
              </Col>
              <Col span={12}>
                <Form.RadioGroup field="status" label="状态">
                  <Form.Radio value="enabled">启用</Form.Radio>
                  <Form.Radio value="disabled">停用</Form.Radio>
                </Form.RadioGroup>
              </Col>
            </Row>
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
            <Form.TextArea field="remark" label="备注" rows={2} />
          </Form.Section>

          <Form.Section text="同步策略">
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
                addonAfter={(
                  <CronBuilderPopover
                    value={formCron}
                    onApply={(expr) => {
                      ruleModal.formApi.current?.setValue('scheduleCron', expr);
                      setFormCron(expr);
                    }}
                  />
                )}
              />
            ) : null}
          </Form.Section>

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
        </Form>
      </SideSheet>

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
              onRefresh={() => void runDetailQuery.refetch()}
              refreshLoading={runDetailQuery.isFetching}
            />
          </>
        ) : null}
      </SideSheet>
    </div>
  );
}
