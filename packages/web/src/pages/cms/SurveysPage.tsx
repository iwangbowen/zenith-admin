import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Progress,
  Select,
  SideSheet,
  Spin,
  TabPane,
  Tabs,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, RotateCcw, Search } from 'lucide-react';
import {
  CMS_INTERACTION_CAPTCHA_POLICY_LABELS,
  CMS_INTERACTION_KIND_LABELS,
  CMS_INTERACTION_PARTICIPANT_SCOPE_LABELS,
  CMS_INTERACTION_QUESTION_TYPE_LABELS,
  CMS_INTERACTION_REPEAT_POLICY_LABELS,
  CMS_INTERACTION_RESULT_VISIBILITY_LABELS,
  CMS_INTERACTION_STATUS_LABELS,
  type CmsInteraction,
  type CmsInteractionKind,
  type CmsInteractionQuestion,
  type CmsInteractionQuestionType,
  type CmsInteractionResponse,
  type CmsInteractionStatus,
} from '@zenith/shared';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import ExportButton from '@/components/ExportButton';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import {
  cmsInteractionKeys,
  useBatchCmsInteractionStatus,
  useAllCmsSites,
  useCmsInteractionDetail,
  useCmsInteractionList,
  useCmsInteractionResponseList,
  useCmsInteractionStats,
  useDeleteCmsInteraction,
  useSaveCmsInteraction,
  useSetCmsInteractionStatus,
} from '@/hooks/queries/cms';
import { formatDateTimeForApi } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

type InteractionFormValues = {
  kind: CmsInteractionKind;
  code: string;
  title: string;
  description?: string;
  status: CmsInteractionStatus;
  participantScope: 'anonymous' | 'member';
  repeatPolicy: 'once_per_member' | 'once_per_ip' | 'multiple';
  resultVisibility: 'always' | 'after_submit' | 'after_close' | 'hidden';
  captchaPolicy: 'inherit' | 'none' | 'math' | 'turnstile';
  turnstileSiteKey?: string;
  turnstileSecret?: string;
  thankYouMessage: string;
  startAt?: Date | string;
  endAt?: Date | string;
};

interface QuestionDraft {
  id?: number;
  label: string;
  type: CmsInteractionQuestionType;
  required: boolean;
  minChoices: number;
  maxChoices: number;
  options: CmsInteractionQuestion['options'];
  optionsText: string;
}

interface ListSearch {
  keyword: string;
  kind?: CmsInteractionKind;
  status?: CmsInteractionStatus;
}

const initialSearch: ListSearch = { keyword: '' };
const STATUS_COLORS: Record<CmsInteractionStatus, 'grey' | 'green' | 'orange'> = {
  draft: 'grey',
  published: 'green',
  closed: 'orange',
};

function questionToDraft(question: CmsInteractionQuestion): QuestionDraft {
  return {
    id: question.id,
    label: question.label,
    type: question.type,
    required: question.required,
    minChoices: question.minChoices,
    maxChoices: question.maxChoices,
    options: question.options,
    optionsText: question.options.map((option) => option.label).join('\n'),
  };
}

function buildOptions(question: QuestionDraft) {
  const labels = [...new Set(question.optionsText.split('\n').map((item) => item.trim()).filter(Boolean))];
  return labels.map((label, index) => {
    const existing = question.options[index];
    const stable = existing?.id ?? `opt-${index + 1}`;
    return { id: stable, label, value: existing?.value ?? stable };
  });
}

function ResultsSheet({ interaction, onClose }: Readonly<{
  interaction: CmsInteraction | null;
  onClose: () => void;
}>) {
  const query = useCmsInteractionStats(interaction?.id, !!interaction);
  return (
    <SideSheet title={interaction ? `结果统计：${interaction.title}` : '结果统计'} visible={!!interaction} onCancel={onClose} width={540}>
      <Spin spinning={query.isFetching}>
        {query.data ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <Typography.Text type="tertiary">共收集 {query.data.responseCount} 份答卷</Typography.Text>
            {query.data.questions.map((question, index) => (
              <section key={question.id}>
                <Typography.Title heading={6}>
                  {index + 1}. {question.label}
                  <Tag size="small" style={{ marginLeft: 8 }}>{CMS_INTERACTION_QUESTION_TYPE_LABELS[question.type]}</Tag>
                </Typography.Title>
                {question.type === 'text' ? (
                  question.texts.length > 0
                    ? question.texts.map((text, textIndex) => (
                        <div key={`${question.id}-${textIndex}`} style={{ padding: 8, marginTop: 6, background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>{text}</div>
                      ))
                    : <Typography.Text type="tertiary">暂无文本回答</Typography.Text>
                ) : question.options.map((option) => (
                  <div key={option.id} style={{ marginTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                      <span>{option.label}</span>
                      <span>{option.count} · {option.percent}%</span>
                    </div>
                    <Progress percent={option.percent} showInfo={false} />
                  </div>
                ))}
              </section>
            ))}
          </div>
        ) : null}
      </Spin>
    </SideSheet>
  );
}

export default function SurveysPage() {
  const { hasPermission } = usePermission();
  const queryClient = useQueryClient();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [siteId, setSiteId] = useState<number | undefined>();
  const [draft, setDraft] = useState<ListSearch>(initialSearch);
  const [submitted, setSubmitted] = useState<ListSearch>(initialSearch);
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [modalVisible, setModalVisible] = useState(false);
  const [editing, setEditing] = useState<CmsInteraction | null>(null);
  const [kindDraft, setKindDraft] = useState<CmsInteractionKind>('survey');
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [resultsTarget, setResultsTarget] = useState<CmsInteraction | null>(null);
  const [responseDetail, setResponseDetail] = useState<CmsInteractionResponse | null>(null);
  const [responsePage, setResponsePage] = useState(1);
  const [responseTimeRange, setResponseTimeRange] = useState<[Date, Date] | undefined>();

  const listQuery = useCmsInteractionList({
    page,
    pageSize,
    siteId: siteId ?? 0,
    keyword: submitted.keyword || undefined,
    kind: submitted.kind,
    status: submitted.status,
  }, !!siteId);
  const sitesQuery = useAllCmsSites();
  const currentSite = sitesQuery.data?.find((site) => site.id === siteId);
  const detailQuery = useCmsInteractionDetail(editing?.id, modalVisible && !!editing);
  const editingDetail = detailQuery.data ?? editing;
  const saveMutation = useSaveCmsInteraction();
  const deleteMutation = useDeleteCmsInteraction();
  const statusMutation = useSetCmsInteractionStatus();
  const batchMutation = useBatchCmsInteractionStatus();
  const responseQuery = useCmsInteractionResponseList({
    page: responsePage,
    pageSize,
    siteId: siteId ?? 0,
    kind: submitted.kind,
    startTime: responseTimeRange ? formatDateTimeForApi(responseTimeRange[0]) : undefined,
    endTime: responseTimeRange ? formatDateTimeForApi(responseTimeRange[1]) : undefined,
  }, !!siteId);

  useEffect(() => {
    if (!modalVisible || !editingDetail) return;
    setKindDraft(editingDetail.kind);
    setQuestions((editingDetail.questions ?? []).map(questionToDraft));
  }, [editingDetail, modalVisible]);

  const canManage = hasPermission('cms:interaction:manage');
  const canBatch = hasPermission('cms:interaction:batch');
  const questionsLocked = (editingDetail?.responseCount ?? 0) > 0;

  const handleSearch = () => {
    setPage(1);
    setResponsePage(1);
    setSubmitted(draft);
    void queryClient.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
  };
  const handleReset = () => {
    setPage(1);
    setResponsePage(1);
    setDraft(initialSearch);
    setSubmitted(initialSearch);
    setResponseTimeRange(undefined);
    void queryClient.invalidateQueries({ queryKey: cmsInteractionKeys.lists });
  };

  const openCreate = () => {
    setEditing(null);
    setKindDraft('survey');
    setQuestions([{
      label: '',
      type: 'single',
      required: true,
      minChoices: 1,
      maxChoices: 1,
      options: [],
      optionsText: '选项一\n选项二',
    }]);
    setModalVisible(true);
  };

  const handleSave = async () => {
    if (!siteId) return;
    let values: InteractionFormValues;
    try {
      values = await formApi.current?.validate() as InteractionFormValues;
    } catch {
      throw new Error('validation');
    }
    if (!questionsLocked && (questions.length === 0 || questions.some((question) => !question.label.trim()))) {
      Toast.warning('请完善题目');
      throw new Error('validation');
    }
    const normalizedQuestions = questions.map((question, index) => ({
      id: question.id,
      label: question.label.trim(),
      type: question.type,
      required: question.required,
      options: question.type === 'text' ? [] : buildOptions(question),
      minChoices: question.type === 'text' ? 0 : question.minChoices,
      maxChoices: question.type === 'single' ? 1 : question.maxChoices,
      sort: index,
    }));
    if (kindDraft === 'poll' && (normalizedQuestions.length !== 1 || normalizedQuestions[0].type === 'text')) {
      Toast.warning('投票必须且只能包含一道选择题');
      throw new Error('validation');
    }
    if (values.captchaPolicy === 'turnstile') {
      if (!values.turnstileSiteKey?.trim()) {
        Toast.warning('请配置 Turnstile Site Key');
        throw new Error('validation');
      }
      if (!values.turnstileSecret?.trim() && !editingDetail?.turnstileSecretConfigured) {
        Toast.warning('请配置 Turnstile Secret Key');
        throw new Error('validation');
      }
    }
    const payload: Record<string, unknown> = {
      ...values,
      kind: kindDraft,
      description: values.description || null,
      startAt: values.startAt instanceof Date ? formatDateTimeForApi(values.startAt) : (values.startAt || null),
      endAt: values.endAt instanceof Date ? formatDateTimeForApi(values.endAt) : (values.endAt || null),
      ...(questionsLocked ? {} : { questions: normalizedQuestions }),
      ...(editing ? {} : { siteId }),
    };
    if (!values.turnstileSecret?.trim()) delete payload.turnstileSecret;
    await saveMutation.mutateAsync({ id: editing?.id, values: payload });
    Toast.success(editing ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditing(null);
  };

  const changeStatus = async (record: CmsInteraction, status: CmsInteractionStatus) => {
    await statusMutation.mutateAsync({ id: record.id, status });
    Toast.success(status === 'published' ? '已发布' : status === 'closed' ? '已关闭' : '已转为草稿');
  };

  const submitBatch = (status: 'published' | 'closed') => {
    Modal.confirm({
      title: status === 'published' ? '批量发布互动问卷？' : '批量关闭互动问卷？',
      content: '操作将提交到任务中心，可在全局任务托盘查看进度、取消或重试。',
      onOk: async () => {
        await batchMutation.mutateAsync({ ids: selectedIds, status });
        setSelectedIds([]);
        Toast.success('批量任务已提交');
      },
    });
  };

  const listColumns: ColumnProps<CmsInteraction>[] = [
    { title: '标题', dataIndex: 'title', width: 240, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'kind', width: 90,
      render: (value: CmsInteractionKind) => <Tag size="small">{CMS_INTERACTION_KIND_LABELS[value]}</Tag>,
    },
    { title: '标识', dataIndex: 'code', width: 150 },
    { title: '参与范围', dataIndex: 'participantScope', width: 120, render: (value: CmsInteraction['participantScope']) => CMS_INTERACTION_PARTICIPANT_SCOPE_LABELS[value] },
    { title: '重复策略', dataIndex: 'repeatPolicy', width: 140, render: (value: CmsInteraction['repeatPolicy']) => CMS_INTERACTION_REPEAT_POLICY_LABELS[value] },
    { title: '答卷数', dataIndex: 'responseCount', width: 90, align: 'right' },
    { title: '创建时间', dataIndex: 'createdAt', width: 180 },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (value: CmsInteractionStatus) => <Tag size="small" color={STATUS_COLORS[value]}>{CMS_INTERACTION_STATUS_LABELS[value]}</Tag>,
    },
    createOperationColumn<CmsInteraction>({
      width: 260,
      desktopInlineKeys: ['results', 'publish', 'close', 'edit'],
      actions: (record) => [
        { key: 'results', label: '结果', onClick: () => setResultsTarget(record) },
        {
          key: 'visit',
          label: '访问',
          hidden: record.status === 'draft' || !currentSite,
          onClick: () => {
            if (currentSite) window.open(cmsPreviewUrl(currentSite.code, `interaction/${record.code}/`), '_blank');
          },
        },
        {
          key: 'publish', label: '发布',
          hidden: !canManage || record.status === 'published',
          onClick: () => { void changeStatus(record, 'published'); },
        },
        {
          key: 'close', label: '关闭',
          hidden: !canManage || record.status !== 'published',
          onClick: () => { void changeStatus(record, 'closed'); },
        },
        {
          key: 'edit', label: '设计', hidden: !canManage,
          onClick: () => { setEditing(record); setModalVisible(true); },
        },
        {
          key: 'delete', label: '删除', danger: true,
          hidden: !canManage,
          onClick: () => {
            Modal.confirm({
              title: `删除「${record.title}」？`,
              content: `将级联删除 ${record.responseCount} 份答卷，无法恢复。`,
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          },
        },
      ],
    }),
  ];

  const responseColumns: ColumnProps<CmsInteractionResponse>[] = [
    { title: '互动问卷', dataIndex: 'interactionTitle', width: 240, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'kind', width: 90,
      render: (value: CmsInteractionKind | undefined) => value ? CMS_INTERACTION_KIND_LABELS[value] : '-',
    },
    { title: '参与者', dataIndex: 'memberDisplay', width: 140 },
    { title: '提交时间', dataIndex: 'createdAt', width: 180 },
    createOperationColumn<CmsInteractionResponse>({
      width: 90,
      desktopInlineKeys: ['view'],
      actions: (record) => [{ key: 'view', label: '查看', onClick: () => setResponseDetail(record) }],
    }),
  ];

  const listSearch = (
    <>
      <CmsSiteSelect value={siteId} onChange={(value) => { setSiteId(value); setPage(1); setResponsePage(1); }} />
      <Input prefix={<Search size={14} />} placeholder="标题/标识" showClear value={draft.keyword}
        onChange={(value) => setDraft((current) => ({ ...current, keyword: value }))} onEnterPress={handleSearch} style={{ width: 200 }} />
      <Select placeholder="全部类型" showClear value={draft.kind} style={{ width: 130 }}
        optionList={Object.entries(CMS_INTERACTION_KIND_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(value) => setDraft((current) => ({ ...current, kind: value as CmsInteractionKind | undefined }))} />
      <Select placeholder="全部状态" showClear value={draft.status} style={{ width: 130 }}
        optionList={Object.entries(CMS_INTERACTION_STATUS_LABELS).map(([value, label]) => ({ value, label }))}
        onChange={(value) => setDraft((current) => ({ ...current, status: value as CmsInteractionStatus | undefined }))} />
      <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
      <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
    </>
  );

  const responseExportQuery = {
    siteId,
    kind: submitted.kind,
    startTime: responseTimeRange ? formatDateTimeForApi(responseTimeRange[0]) : undefined,
    endTime: responseTimeRange ? formatDateTimeForApi(responseTimeRange[1]) : undefined,
  };

  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" lazyRender keepDOM={false}>
        <TabPane tab="互动管理" itemKey="interactions">
          <SearchToolbar
            primary={listSearch}
            actions={canManage && siteId ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null}
            mobilePrimary={(
              <>
                <CmsSiteSelect value={siteId} onChange={setSiteId} />
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
                {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null}
              </>
            )}
            mobileFilters={listSearch}
            filterTitle="互动问卷筛选"
            onFilterApply={handleSearch}
            onFilterReset={handleReset}
          />
          {selectedIds.length > 0 && canBatch ? (
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              <Button onClick={() => submitBatch('published')}>批量发布（{selectedIds.length}）</Button>
              <Button type="warning" onClick={() => submitBatch('closed')}>批量关闭</Button>
            </div>
          ) : null}
          <ConfigurableTable
            bordered
            columns={listColumns}
            dataSource={listQuery.data?.list ?? []}
            loading={listQuery.isFetching}
            rowKey="id"
            empty={siteId ? '暂无互动问卷' : '请先选择站点'}
            scroll={{ x: 1400 }}
            rowSelection={{ selectedRowKeys: selectedIds, onChange: (keys) => setSelectedIds(keys as number[]) }}
            onRefresh={() => void listQuery.refetch()}
            refreshLoading={listQuery.isFetching}
            pagination={buildPagination(listQuery.data?.total ?? 0)}
          />
        </TabPane>
        <TabPane tab="答卷明细" itemKey="responses">
          <SearchToolbar
            primary={(
              <>
                <CmsSiteSelect value={siteId} onChange={setSiteId} />
                <Select placeholder="全部类型" showClear value={draft.kind} style={{ width: 140 }}
                  optionList={Object.entries(CMS_INTERACTION_KIND_LABELS).map(([value, label]) => ({ value, label }))}
                  onChange={(value) => setDraft((current) => ({ ...current, kind: value as CmsInteractionKind | undefined }))} />
                <DatePicker type="dateTimeRange" value={responseTimeRange} style={{ width: 330 }}
                  placeholder={['提交开始时间', '提交结束时间']}
                  onChange={(value) => setResponseTimeRange(value as [Date, Date] | undefined)} />
                <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
                <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
              </>
            )}
            actions={siteId && hasPermission('cms:interaction:export')
              ? <ExportButton entity="cms.interaction-responses" query={responseExportQuery} />
              : null}
          />
          <ConfigurableTable
            bordered
            columns={responseColumns}
            dataSource={responseQuery.data?.list ?? []}
            loading={responseQuery.isFetching}
            rowKey="id"
            empty={siteId ? '暂无答卷' : '请先选择站点'}
            onRefresh={() => void responseQuery.refetch()}
            refreshLoading={responseQuery.isFetching}
            pagination={{
              total: responseQuery.data?.total ?? 0,
              pageSize,
              currentPage: responsePage,
              onPageChange: setResponsePage,
            }}
          />
        </TabPane>
      </Tabs>

      <AppModal
        title={editing ? `设计：${editing.title}` : '新增互动问卷'}
        visible={modalVisible}
        onCancel={() => { setModalVisible(false); setEditing(null); }}
        onOk={handleSave}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={800}
        closeOnEsc
      >
        <Spin spinning={!!editing && detailQuery.isFetching}>
          <Form<InteractionFormValues>
            key={editingDetail?.id ?? 'new'}
            getFormApi={(api) => { formApi.current = api; }}
            labelPosition="left"
            labelWidth={110}
            allowEmpty
            initValues={editingDetail ? {
              kind: editingDetail.kind,
              code: editingDetail.code,
              title: editingDetail.title,
              description: editingDetail.description ?? '',
              status: editingDetail.status,
              participantScope: editingDetail.participantScope,
              repeatPolicy: editingDetail.repeatPolicy,
              resultVisibility: editingDetail.resultVisibility,
              captchaPolicy: editingDetail.captchaPolicy,
              turnstileSiteKey: editingDetail.turnstileSiteKey ?? '',
              turnstileSecret: '',
              thankYouMessage: editingDetail.thankYouMessage,
              startAt: editingDetail.startAt ?? undefined,
              endAt: editingDetail.endAt ?? undefined,
            } : {
              kind: 'survey',
              code: '',
              title: '',
              description: '',
              status: 'draft',
              participantScope: 'anonymous',
              repeatPolicy: 'once_per_ip',
              resultVisibility: 'after_submit',
              captchaPolicy: 'inherit',
              turnstileSiteKey: '',
              turnstileSecret: '',
              thankYouMessage: '感谢您的参与！',
              startAt: undefined,
              endAt: undefined,
            }}
          >
            <Form.Select field="kind" label="互动类型" disabled={!!editing} style={{ width: '100%' }}
              optionList={Object.entries(CMS_INTERACTION_KIND_LABELS).map(([value, label]) => ({ value, label }))}
              onChange={(value) => setKindDraft(value as CmsInteractionKind)} />
            <Form.Input field="title" label="标题" rules={[{ required: true, message: '请输入标题' }]} />
            <Form.Input field="code" label="访问标识" disabled={!!editing} rules={[{ required: true, message: '请输入标识' }]}
              extraText="前台地址 /interaction/{标识}/；正文用 [互动:标识] 嵌入" />
            <Form.TextArea field="description" label="说明" rows={2} />
            <Form.Select field="participantScope" label="参与范围" style={{ width: '100%' }}
              optionList={Object.entries(CMS_INTERACTION_PARTICIPANT_SCOPE_LABELS).map(([value, label]) => ({ value, label }))} />
            <Form.Select field="repeatPolicy" label="重复提交" style={{ width: '100%' }}
              optionList={Object.entries(CMS_INTERACTION_REPEAT_POLICY_LABELS).map(([value, label]) => ({ value, label }))} />
            <Form.Select field="resultVisibility" label="结果可见性" style={{ width: '100%' }}
              optionList={Object.entries(CMS_INTERACTION_RESULT_VISIBILITY_LABELS).map(([value, label]) => ({ value, label }))} />
            <Form.Select field="captchaPolicy" label="验证码策略" style={{ width: '100%' }}
              optionList={Object.entries(CMS_INTERACTION_CAPTCHA_POLICY_LABELS).map(([value, label]) => ({ value, label }))} />
            <Form.Input field="turnstileSiteKey" label="Turnstile Site Key"
              extraText="仅验证码策略为 Cloudflare Turnstile 时生效" />
            <Form.Input field="turnstileSecret" label="Turnstile Secret Key" mode="password"
              placeholder={editingDetail?.turnstileSecretConfigured ? '已配置，留空保持不变' : '仅服务端保存，不会回显'} />
            <Form.Input field="thankYouMessage" label="感谢语" rules={[{ required: true, message: '请输入感谢语' }]} />
            <Form.DatePicker field="startAt" label="开始时间" type="dateTime" style={{ width: '100%' }} />
            <Form.DatePicker field="endAt" label="结束时间" type="dateTime" style={{ width: '100%' }} />
            <Form.RadioGroup field="status" label="状态">
              <Form.Radio value="draft">草稿</Form.Radio>
              <Form.Radio value="published">进行中</Form.Radio>
              <Form.Radio value="closed">已关闭</Form.Radio>
            </Form.RadioGroup>
          </Form>
          <div style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <Typography.Title heading={6}>题目设计（{questions.length}）</Typography.Title>
              {!questionsLocked && kindDraft === 'survey' ? (
                <Button size="small" icon={<Plus size={13} />} onClick={() => setQuestions((current) => [...current, {
                  label: '', type: 'single', required: true, minChoices: 1, maxChoices: 1, options: [], optionsText: '',
                }])}>加题</Button>
              ) : null}
            </div>
            {questionsLocked ? (
              <Typography.Text type="warning">已收集答卷，题目结构已锁定；仍可调整时间、状态与展示策略。</Typography.Text>
            ) : null}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 360, overflow: 'auto', marginTop: 8 }}>
              {questions.map((question, index) => (
                <div key={question.id ?? `new-${index}`} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 12 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    <Input value={question.label} placeholder="题目" disabled={questionsLocked}
                      onChange={(value) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, label: value } : item))} />
                    <Select value={question.type} disabled={questionsLocked} style={{ width: 110 }}
                      optionList={Object.entries(CMS_INTERACTION_QUESTION_TYPE_LABELS)
                        .filter(([value]) => kindDraft !== 'poll' || value !== 'text')
                        .map(([value, label]) => ({ value, label }))}
                      onChange={(value) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? {
                        ...item,
                        type: value as CmsInteractionQuestionType,
                        maxChoices: value === 'single' ? 1 : item.maxChoices,
                      } : item))} />
                    <Button theme="borderless" size="small" disabled={questionsLocked}
                      onClick={() => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, required: !item.required } : item))}>
                      {question.required ? '必答' : '选答'}
                    </Button>
                    <Button theme="borderless" type="danger" size="small" disabled={questionsLocked || questions.length <= 1 || kindDraft === 'poll'}
                      onClick={() => setQuestions((current) => current.filter((_, itemIndex) => itemIndex !== index))}>删除</Button>
                  </div>
                  {question.type !== 'text' ? (
                    <>
                      <TextArea value={question.optionsText} rows={3} disabled={questionsLocked} placeholder="每行一个选项"
                        onChange={(value) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, optionsText: value } : item))} />
                      {question.type === 'multiple' ? (
                        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
                          <Input type="number" value={String(question.minChoices)} disabled={questionsLocked} prefix="最少"
                            onChange={(value) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, minChoices: Number(value) || 0 } : item))} />
                          <Input type="number" value={String(question.maxChoices)} disabled={questionsLocked} prefix="最多"
                            onChange={(value) => setQuestions((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, maxChoices: Number(value) || 1 } : item))} />
                        </div>
                      ) : null}
                    </>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </Spin>
      </AppModal>

      <ResultsSheet interaction={resultsTarget} onClose={() => setResultsTarget(null)} />
      <SideSheet title="答卷详情" visible={!!responseDetail} onCancel={() => setResponseDetail(null)} width={520}>
        {responseDetail ? (
          <dl style={{ display: 'grid', gridTemplateColumns: '100px 1fr', gap: 12 }}>
            <dt>互动问卷</dt><dd>{responseDetail.interactionTitle}</dd>
            <dt>参与者</dt><dd>{responseDetail.memberDisplay}</dd>
            <dt>提交时间</dt><dd>{responseDetail.createdAt}</dd>
            <dt>答案</dt><dd><pre style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{JSON.stringify(responseDetail.answers, null, 2)}</pre></dd>
          </dl>
        ) : null}
      </SideSheet>
    </div>
  );
}
