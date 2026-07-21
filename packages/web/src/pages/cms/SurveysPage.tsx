/** 问卷调查：CRUD + 题目编辑 + 结果统计（选项占比 / 文字题样本） */
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, Form, Input, TextArea, Tag, Toast, Modal, SideSheet, Spin, Progress, Typography, Select } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Search, RotateCcw, Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTimeForApi } from '@/utils/date';
import {
  useCmsSurveyList, useSaveCmsSurvey, useDeleteCmsSurvey, useCmsSurveyStats, useAllCmsSites, cmsSurveyKeys,
} from '@/hooks/queries/cms';
import { CMS_SURVEY_STATUS_LABELS, CMS_SURVEY_QUESTION_TYPE_LABELS } from '@zenith/shared';
import type { CmsSurvey, CmsSurveyStatus, CmsSurveyQuestionType } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

const STATUS_COLORS: Record<CmsSurveyStatus, 'grey' | 'green' | 'violet'> = {
  draft: 'grey',
  published: 'green',
  closed: 'violet',
};

/** 题目编辑态（options 用多行文本编辑，保存时转结构） */
interface QuestionDraft {
  id?: number;
  label: string;
  type: CmsSurveyQuestionType;
  required: boolean;
  optionsText: string;
}

function optionsToText(options: { label: string; value: string }[]): string {
  return options.map((o) => o.label).join('\n');
}

function textToOptions(text: string): { label: string; value: string }[] {
  return [...new Set(text.split('\n').map((s) => s.trim()).filter(Boolean))].map((label, i) => ({ label, value: `opt-${i + 1}-${label.slice(0, 20)}` }));
}

export default function SurveysPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [draftKeyword, setDraftKeyword] = useState('');
  const [submittedKeyword, setSubmittedKeyword] = useState('');
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsSurvey | null>(null);
  const [questions, setQuestions] = useState<QuestionDraft[]>([]);
  const [statsSurvey, setStatsSurvey] = useState<CmsSurvey | null>(null);

  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);
  const listQuery = useCmsSurveyList(
    { page, pageSize, siteId: siteId ?? 0, keyword: submittedKeyword || undefined },
    siteId !== undefined,
  );
  const saveMutation = useSaveCmsSurvey();
  const deleteMutation = useDeleteCmsSurvey();
  const statsQuery = useCmsSurveyStats(statsSurvey?.id, !!statsSurvey);
  const canManage = hasPermission('cms:survey:manage');

  function handleSearch() {
    setPage(1);
    setSubmittedKeyword(draftKeyword);
    void queryClient.invalidateQueries({ queryKey: cmsSurveyKeys.lists });
  }

  function handleReset() {
    setPage(1);
    setDraftKeyword('');
    setSubmittedKeyword('');
    void queryClient.invalidateQueries({ queryKey: cmsSurveyKeys.lists });
  }

  function openCreate() {
    setEditingRecord(null);
    setQuestions([{ label: '', type: 'single', required: true, optionsText: '满意\n一般\n不满意' }]);
    setModalVisible(true);
  }

  function openEdit(record: CmsSurvey) {
    setEditingRecord(record);
    setQuestions((record.questions ?? []).map((q) => ({
      id: q.id, label: q.label, type: q.type, required: q.required, optionsText: optionsToText(q.options),
    })));
    setModalVisible(true);
  }

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (questions.length === 0 || questions.some((q) => !q.label.trim())) {
      Toast.warning('请完善题目（至少一道，题目不能为空）');
      throw new Error('validation');
    }
    const payload: Record<string, unknown> = {
      ...values,
      questions: questions.map((q, i) => ({
        label: q.label.trim(),
        type: q.type,
        required: q.required,
        options: q.type === 'text' ? [] : textToOptions(q.optionsText),
        sort: i,
      })),
    };
    if (values.startAt instanceof Date) payload.startAt = formatDateTimeForApi(values.startAt);
    if (!values.startAt) payload.startAt = null;
    if (values.endAt instanceof Date) payload.endAt = formatDateTimeForApi(values.endAt);
    if (!values.endAt) payload.endAt = null;
    if (!editingRecord) payload.siteId = siteId;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsSurvey>[] = [
    { title: '标题', dataIndex: 'title', width: 240 },
    { title: '标识', dataIndex: 'code', width: 150, render: (v: string) => <code>{v}</code> },
    {
      title: '匿名', dataIndex: 'allowAnonymous', width: 80,
      render: (v: boolean) => (v ? <Tag size="small" color="green">允许</Tag> : <Tag size="small">仅会员</Tag>),
    },
    { title: '答卷数', dataIndex: 'answerCount', width: 90 },
    { title: '开始时间', dataIndex: 'startAt', width: 170, render: (v: string | null) => v ?? '-' },
    { title: '结束时间', dataIndex: 'endAt', width: 170, render: (v: string | null) => v ?? '-' },
    {
      title: '状态', dataIndex: 'status', width: 90, fixed: 'right',
      render: (v: CmsSurveyStatus) => <Tag size="small" color={STATUS_COLORS[v]}>{CMS_SURVEY_STATUS_LABELS[v]}</Tag>,
    },
    createOperationColumn<CmsSurvey>({
      width: 220,
      desktopInlineKeys: ['stats', 'edit'],
      actions: (record) => [
        { key: 'stats', label: '统计', onClick: () => setStatsSurvey(record) },
        ...(record.status === 'published' && currentSite ? [{
          key: 'visit',
          label: '访问',
          onClick: () => window.open(cmsPreviewUrl(currentSite.code, `survey/${record.code}/`), '_blank'),
        }] : []),
        ...(canManage ? [
          { key: 'edit', label: '编辑', onClick: () => openEdit(record) },
          {
            key: 'delete', label: '删除', danger: true,
            onClick: () => {
              Modal.confirm({
                title: `删除问卷「${record.title}」？`,
                content: `已收集的 ${record.answerCount} 份答卷将一并删除`,
                onOk: async () => {
                  await deleteMutation.mutateAsync(record.id);
                  Toast.success('删除成功');
                },
              });
            },
          },
        ] : []),
      ],
    }),
  ];

  const statsData = statsQuery.data;

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} />
        <Input prefix={<Search size={14} />} placeholder="搜索问卷标题..." value={draftKeyword} onChange={setDraftKeyword} showClear style={{ width: 220 }} onEnterPress={handleSearch} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {canManage && siteId ? <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增</Button> : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty={siteId ? '暂无问卷' : '请先选择站点'}
        scroll={{ x: 1180 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />

      <AppModal
        title={editingRecord ? '编辑问卷' : '新增问卷'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={760}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord
            ? {
                code: editingRecord.code, title: editingRecord.title, description: editingRecord.description ?? '',
                status: editingRecord.status, allowAnonymous: editingRecord.allowAnonymous,
                startAt: editingRecord.startAt ?? undefined, endAt: editingRecord.endAt ?? undefined,
              }
            : { status: 'draft', allowAnonymous: true }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="title" label="问卷标题" rules={[{ required: true, message: '请输入标题' }]} />
          <Form.Input field="code" label="访问标识" placeholder="前台地址 /survey/{标识}/" disabled={!!editingRecord}
            rules={[{ required: true, message: '请输入标识' }]} />
          <Form.TextArea field="description" label="说明" rows={2} placeholder="展示在问卷标题下方（可选）" />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="draft">草稿</Form.Radio>
            <Form.Radio value="published">发布中</Form.Radio>
            <Form.Radio value="closed">已结束</Form.Radio>
          </Form.RadioGroup>
          <Form.Switch field="allowAnonymous" label="允许匿名" extraText="关闭后仅登录会员可填写；匿名提交按 IP 24 小时限一次" />
          <Form.DatePicker field="startAt" label="开始时间" type="dateTime" density="compact" style={{ width: 240 }} placeholder="留空立即开始" />
          <Form.DatePicker field="endAt" label="结束时间" type="dateTime" density="compact" style={{ width: 240 }} placeholder="留空不限" />
        </Form>
        <div style={{ marginTop: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
            <Typography.Title heading={6} style={{ margin: 0, flex: 1 }}>题目（{questions.length}）</Typography.Title>
            <Button size="small" icon={<Plus size={13} />} onClick={() => setQuestions((qs) => [...qs, { label: '', type: 'single', required: true, optionsText: '' }])}>加题</Button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxHeight: 320, overflow: 'auto' }}>
            {questions.map((q, i) => (
              <div key={q.id ?? `new-${i}`} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ flexShrink: 0, fontSize: 13, color: 'var(--semi-color-text-2)' }}>{i + 1}.</span>
                  <Input placeholder="题目内容" value={q.label}
                    onChange={(v) => setQuestions((qs) => qs.map((x, xi) => xi === i ? { ...x, label: v } : x))} style={{ flex: 1 }} />
                  <Select value={q.type} style={{ width: 96 }}
                    optionList={Object.entries(CMS_SURVEY_QUESTION_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
                    onChange={(v) => setQuestions((qs) => qs.map((x, xi) => xi === i ? { ...x, type: v as CmsSurveyQuestionType } : x))} />
                  <Button size="small" theme="borderless" onClick={() => setQuestions((qs) => qs.map((x, xi) => xi === i ? { ...x, required: !x.required } : x))}>
                    {q.required ? '必答' : '选答'}
                  </Button>
                  <Button size="small" theme="borderless" type="danger" disabled={questions.length <= 1}
                    onClick={() => setQuestions((qs) => qs.filter((_, xi) => xi !== i))}>删除</Button>
                </div>
                {q.type !== 'text' ? (
                  <TextArea placeholder={'选项（每行一个，至少 2 个）'} rows={3} value={q.optionsText}
                    onChange={(v: string) => setQuestions((qs) => qs.map((x, xi) => xi === i ? { ...x, optionsText: v } : x))} />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </AppModal>

      {/* 结果统计 */}
      <SideSheet
        title={statsSurvey ? `结果统计：${statsSurvey.title}` : '结果统计'}
        visible={!!statsSurvey}
        onCancel={() => setStatsSurvey(null)}
        width={520}
      >
        <Spin spinning={statsQuery.isFetching}>
          {statsData ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <Typography.Text type="tertiary">共收集 {statsData.answerCount} 份答卷</Typography.Text>
              {statsData.questions.map((q, qi) => (
                <div key={q.id}>
                  <Typography.Title heading={6} style={{ marginBottom: 8 }}>
                    {qi + 1}. {q.label}
                    <Tag size="small" style={{ marginLeft: 8 }}>{CMS_SURVEY_QUESTION_TYPE_LABELS[q.type]}</Tag>
                  </Typography.Title>
                  {q.type === 'text' ? (
                    q.texts.length > 0 ? (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 220, overflow: 'auto' }}>
                        {q.texts.map((t, ti) => (
                          <div key={`${q.id}-${ti}`} style={{ fontSize: 13, padding: '6px 10px', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}>{t}</div>
                        ))}
                      </div>
                    ) : <Typography.Text type="tertiary" size="small">暂无回答</Typography.Text>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {q.options.map((o) => (
                        <div key={o.value}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 2 }}>
                            <span>{o.label}</span>
                            <span style={{ color: 'var(--semi-color-text-2)' }}>{o.count} 票 · {o.percent}%</span>
                          </div>
                          <Progress percent={o.percent} showInfo={false} stroke="var(--semi-color-primary)" />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--semi-color-text-2)', padding: 24, textAlign: 'center' }}>
              {statsQuery.isFetching ? '统计中…' : '暂无数据'}
            </div>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
