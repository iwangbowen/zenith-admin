import { useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Banner, Button, Descriptions, Space, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import PageLoading from '@/components/PageLoading';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ArrowLeft, Save, Send } from 'lucide-react';
import { REPORT_FILL_RECORD_STATUS_LABELS } from '@zenith/shared/report';
import type { ReportFillRecord, ReportFillTemplate } from '@zenith/shared/report';
import WorkflowFormRenderer from '@/pages/workflow/designer/components/WorkflowFormRenderer';
import { usePermission } from '@/hooks/usePermission';
import {
  useCreateReportFillRecord,
  useReportFillRecordDetail,
  useReportFillTemplateLookup,
  useSubmitReportFillRecord,
  useUpdateReportFillRecord,
} from '@/hooks/queries/report-fill';
import { formatDateTime } from '@/utils/date';
import { canRunFillRecordAction, isRevisionConflict, submitFillEntryValues } from './report-p2-utils';
import './FillEntryPage.css';

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : '操作失败，请稍后重试';
}

export default function FillEntryPage() {
  const navigate = useNavigate();
  const { code = '' } = useParams<{ code: string }>();
  const [searchParams] = useSearchParams();
  const recordIdText = searchParams.get('recordId');
  const recordId = recordIdText && /^\d+$/.test(recordIdText) ? Number(recordIdText) : undefined;
  const malformedRecordId = Boolean(recordIdText && !recordId);
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [operationError, setOperationError] = useState('');
  const [savedRecord, setSavedRecord] = useState<ReportFillRecord>();

  const lookupQuery = useReportFillTemplateLookup(!recordId);
  const detailQuery = useReportFillRecordDetail(recordId);
  const createMutation = useCreateReportFillRecord();
  const updateMutation = useUpdateReportFillRecord();
  const submitMutation = useSubmitReportFillRecord();

  const template = useMemo(
    () => (lookupQuery.data ?? []).find((item) => item.code === code),
    [code, lookupQuery.data],
  );
  const record = savedRecord ?? detailQuery.data;
  const recordTemplate = record
    ? (lookupQuery.data ?? []).find((item) => item.id === record.templateId)
    : undefined;
  const codeMismatch = Boolean(recordTemplate && recordTemplate.code !== code);
  const schema = record?.templateSchemaSnapshot ?? template?.publishedSchema;
  const editable = record ? canRunFillRecordAction(record, 'edit') : Boolean(template);
  const canSave = editable && hasPermission(
    record ? 'report:fill:record:update' : 'report:fill:record:create',
  );
  const canSubmit = editable
    && hasPermission('report:fill:record:submit')
    && (!record || canRunFillRecordAction(record, 'submit'));
  const pending = createMutation.isPending || updateMutation.isPending || submitMutation.isPending;

  async function collectValues() {
    setOperationError('');
    const values = await formApi.current?.validate();
    if (!values || typeof values !== 'object' || Array.isArray(values)) {
      throw new Error('表单内容无效，请检查必填项');
    }
    return values as Record<string, unknown>;
  }

  async function persistDraft(values: Record<string, unknown>) {
    if (record) {
      return updateMutation.mutateAsync({
        params: { id: record.id },
        body: { expectedRevision: record.revision, data: values },
      });
    }
    if (!template) throw new Error('模板不存在、未发布或已下线');
    return createMutation.mutateAsync({ body: { templateId: template.id, data: values } });
  }

  async function handleSave() {
    try {
      const next = await persistDraft(await collectValues());
      setSavedRecord(next);
      Toast.success('草稿已保存');
    } catch (error) {
      setOperationError(isRevisionConflict(error)
        ? '保存冲突：记录已在其他窗口被更新，请返回列表后重新打开。'
        : getErrorMessage(error));
    }
  }

  async function handleSubmit() {
    try {
      const submitted = await submitFillEntryValues(
        await collectValues(),
        persistDraft,
        (id, expectedRevision) => submitMutation.mutateAsync({
          params: { id },
          body: { expectedRevision },
        }),
      );
      setSavedRecord(submitted);
    } catch (error) {
      setOperationError(isRevisionConflict(error)
        ? '提交冲突：记录状态已变化，请返回列表刷新后重试。'
        : getErrorMessage(error));
    }
  }

  if (malformedRecordId || !code.trim() || codeMismatch) {
    return (
      <div className="page-container fill-entry-page">
        <Banner
          type="danger"
          closeIcon={null}
          title="无法打开填报"
          description={codeMismatch ? '记录与当前模板地址不匹配。' : '填报地址参数无效。'}
        />
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/report/fill-records')}>返回填报记录</Button>
      </div>
    );
  }

  if (lookupQuery.isLoading || (recordId && detailQuery.isLoading)) {
    return <PageLoading inline />;
  }

  const queryError = recordId ? detailQuery.error : lookupQuery.error;
  if (queryError || (!recordId && !template) || (recordId && !record)) {
    return (
      <div className="page-container fill-entry-page">
        <Banner
          type="danger"
          closeIcon={null}
          title="填报不可用"
          description={queryError?.message || '模板不存在、未发布、已下线，或记录不属于当前用户。'}
        />
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/report/fill-records')}>返回填报记录</Button>
      </div>
    );
  }

  const activeTemplate: ReportFillTemplate | undefined = template ?? recordTemplate;
  const title = activeTemplate?.name ?? record?.templateName ?? `模板 #${record?.templateId}`;
  const submitted = savedRecord && !canRunFillRecordAction(savedRecord, 'edit');

  return (
    <div className="page-container fill-entry-page">
      <div className="fill-entry-header">
        <div>
          <Button
            theme="borderless"
            icon={<ArrowLeft size={15} />}
            onClick={() => navigate('/report/fill-records')}
          >
            返回记录
          </Button>
          <Typography.Title heading={3}>{title}</Typography.Title>
          <Typography.Text type="tertiary">
            {record ? `记录 #${record.id} · 使用已冻结的第 ${record.templateRevision} 版表单` : `模板编码：${code}`}
          </Typography.Text>
        </div>
        {!submitted && (
          <Space>
            {canSave && (
              <Button
                icon={<Save size={14} />}
                loading={pending}
                disabled={pending}
                onClick={() => void handleSave()}
              >
                保存草稿
              </Button>
            )}
            {canSubmit && (
              <Button
                type="primary"
                icon={<Send size={14} />}
                loading={pending}
                disabled={pending}
                onClick={() => void handleSubmit()}
              >
                提交填报
              </Button>
            )}
          </Space>
        )}
      </div>

      {operationError && (
        <Banner
          type="danger"
          closeIcon={null}
          title="操作失败"
          description={operationError}
        />
      )}
      {submitted && (
        <div>
          <Banner
            type="success"
            closeIcon={null}
            title={savedRecord.status === 'in_review' ? '提交成功，已进入审批流程' : '提交成功'}
            description="服务端已完成表单校验。你可以返回记录列表查看后续状态与同步进度。"
          />
          <Button onClick={() => navigate('/report/fill-records')}>查看填报记录</Button>
        </div>
      )}
      {!editable && record && !submitted && (
        <Banner
          type="info"
          closeIcon={null}
          title="只读记录"
          description="当前状态不允许修改。已提交或审核中的记录需先撤回，已通过和已取消记录不可编辑。"
        />
      )}

      {record && (
        <Descriptions
          row
          data={[
            {
              key: '状态',
              value: <Tag color={record.status === 'approved' ? 'green' : record.status === 'rejected' ? 'red' : 'blue'}>
                {REPORT_FILL_RECORD_STATUS_LABELS[record.status]}
              </Tag>,
            },
            { key: '创建时间', value: formatDateTime(record.createdAt) },
            { key: '更新时间', value: formatDateTime(record.updatedAt) },
            { key: '审核意见', value: record.reviewComment || '—' },
          ]}
        />
      )}

      <div className="fill-entry-form">
        <WorkflowFormRenderer
          key={`${record?.id ?? template?.id}-${record?.revision ?? template?.revision}`}
          fields={schema?.fields ?? []}
          initValues={record?.data ?? {}}
          getFormApi={(api) => { formApi.current = api; }}
          readOnly={!editable || Boolean(submitted)}
          labelPosition={schema?.settings?.labelPosition}
          labelAlign={schema?.settings?.labelAlign}
          labelWidth={schema?.settings?.labelWidth}
        />
      </div>
    </div>
  );
}
