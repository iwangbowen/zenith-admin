import { useRef, useState } from 'react';
import { Button, Form, Tag, Toast, Modal, ArrayField, Typography, SideSheet } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { ExportButton } from '@/components/ExportButton';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsFormList, useSaveCmsForm, useDeleteCmsForm,
  useCmsFormSubmissions, useDeleteCmsFormSubmissions,
} from '@/hooks/queries/cms';
import {
  CMS_FORM_CAPTCHA_PROVIDERS, CMS_FORM_CAPTCHA_PROVIDER_LABELS,
  CMS_FORM_FIELD_TYPES, CMS_FORM_FIELD_TYPE_LABELS,
} from '@zenith/shared';
import type { CmsForm, CmsFormSubmission } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

const FIELD_TYPE_OPTIONS = CMS_FORM_FIELD_TYPES.map((t) => ({ value: t, label: CMS_FORM_FIELD_TYPE_LABELS[t] }));

/** 提交数据抽屉 */
function SubmissionsSheet({ form, onClose }: Readonly<{ form: CmsForm | null; onClose: () => void }>) {
  const { hasPermission } = usePermission();
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const listQuery = useCmsFormSubmissions(form?.id, page, pageSize);
  const deleteMutation = useDeleteCmsFormSubmissions();

  const fieldColumns: ColumnProps<CmsFormSubmission>[] = (form?.fields ?? []).map((f) => ({
    title: f.label,
    width: 150,
    render: (_: unknown, record: CmsFormSubmission) => (
      <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 140 }}>
        {String(record.data[f.name] ?? '')}
      </Typography.Text>
    ),
  }));

  const columns: ColumnProps<CmsFormSubmission>[] = [
    ...fieldColumns,
    { title: 'IP', dataIndex: 'ip', width: 120, render: (v: string | null) => v ?? '-' },
    { title: '提交时间', dataIndex: 'createdAt', width: 180 },
    createOperationColumn<CmsFormSubmission>({
      width: 90,
      desktopInlineKeys: ['delete'],
      actions: (record) => hasPermission('cms:form:manage') && form ? [{
        key: 'delete', label: '删除', danger: true,
        onClick: () => {
          Modal.confirm({
            title: '确定要删除该提交记录吗？',
            onOk: async () => {
              await deleteMutation.mutateAsync({ formId: form.id, ids: [record.id] });
              Toast.success('删除成功');
            },
          });
        },
      }] : [],
    }),
  ];

  return (
    <SideSheet
      title={form ? `「${form.name}」提交数据` : '提交数据'}
      visible={!!form}
      onCancel={onClose}
      width={720}
    >
      {form && hasPermission('cms:form:manage') ? (
        <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
          <ExportButton entity="cms.form-submissions" query={{ formId: form.id }} />
        </div>
      ) : null}
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无提交数据"
        scroll={{ x: Math.max(640, (form?.fields.length ?? 0) * 150 + 390) }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={{
          currentPage: page,
          pageSize,
          total: listQuery.data?.total ?? 0,
          onPageChange: setPage,
        }}
      />
    </SideSheet>
  );
}

export default function FormsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsForm | null>(null);
  const [viewingForm, setViewingForm] = useState<CmsForm | null>(null);
  const [previewingForm, setPreviewingForm] = useState<CmsForm | null>(null);

  const listQuery = useCmsFormList({ page, pageSize, siteId: siteId ?? 0 }, siteId !== undefined);
  const saveMutation = useSaveCmsForm();
  const deleteMutation = useDeleteCmsForm();
  const canManage = hasPermission('cms:form:manage');

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!editingRecord) values.siteId = siteId;
    values.turnstileSecret = values.clearTurnstileSecret === true ? null : (values.turnstileSecret ?? '');
    delete values.clearTurnstileSecret;
    values.fields = ((values.fields as Array<Record<string, unknown>> | undefined) ?? []).map((field) => {
      const options = String(field.optionsText ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
        const [label, value = label] = line.split('=').map((part) => part.trim());
        return { label, value };
      });
      const { optionsText: _optionsText, ...rest } = field;
      return { ...rest, options: options.length > 0 ? options : null };
    });
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsForm>[] = [
    { title: '表单名称', dataIndex: 'name', width: 160 },
    { title: '标识', dataIndex: 'code', width: 120, render: (v: string) => <Tag size="small">{v}</Tag> },
    {
      title: '字段',
      dataIndex: 'fields',
      width: 280,
      render: (fields: CmsForm['fields']) => fields.map((f) => <Tag key={f.name} size="small" style={{ marginRight: 4 }}>{f.label}</Tag>),
    },
    { title: '提交数', dataIndex: 'submissionCount', width: 90 },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsForm>({
      width: 210,
      desktopInlineKeys: ['data', 'edit', 'delete'],
      actions: (record) => [
        { key: 'data', label: '提交数据', onClick: () => setViewingForm(record) },
        { key: 'preview', label: '预览', onClick: () => setPreviewingForm(record) },
        ...(canManage ? [
          { key: 'edit', label: '编辑', onClick: () => { setEditingRecord(record); setModalVisible(true); } },
          {
            key: 'delete', label: '删除', danger: true,
            onClick: () => {
              Modal.confirm({
                title: '确定要删除该表单吗？',
                content: '表单的全部提交数据将一并删除',
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

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={200} />
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增表单</Button> : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无表单；将表单标识填入单页栏目 settings.formCode 即可在前台展示"
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />

      <AppModal
        title={editingRecord ? '编辑表单' : '新增表单'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={780}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord
            ? {
                name: editingRecord.name, code: editingRecord.code, successMessage: editingRecord.successMessage ?? '',
                notifyEmail: editingRecord.notifyEmail ?? '',
                captchaProvider: editingRecord.captchaProvider,
                turnstileSiteKey: editingRecord.turnstileSiteKey ?? '',
                turnstileSecret: editingRecord.turnstileSecret ?? '',
                clearTurnstileSecret: false,
                status: editingRecord.status,
                fields: editingRecord.fields.map((f) => ({
                  ...f,
                  optionsText: (f.options ?? []).map((option) => `${option.label}=${option.value}`).join('\n'),
                })),
              }
            : { status: 'enabled', captchaProvider: 'inherit', fields: [{ name: 'name', label: '姓名', fieldType: 'text', required: true }] }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="表单名称" rules={[{ required: true, message: '请输入表单名称' }]} />
          <Form.Input field="code" label="表单标识" disabled={!!editingRecord} placeholder="如 contact（前台提交与栏目绑定用）" rules={[{ required: true, message: '请输入表单标识' }]} />
          <Form.Input field="successMessage" label="成功提示" placeholder="提交成功后展示的文案" />
          <Form.Input field="notifyEmail" label="通知邮箱" placeholder="收到新提交时通知，多个邮箱用逗号分隔（留空不通知）" />
          <Form.Select field="captchaProvider" label="验证码策略" style={{ width: '100%' }}
            optionList={CMS_FORM_CAPTCHA_PROVIDERS.map((value) => ({ value, label: CMS_FORM_CAPTCHA_PROVIDER_LABELS[value] }))} />
          <Form.Input field="turnstileSiteKey" label="Turnstile Site Key" maxLength={200} />
          <Form.Input field="turnstileSecret" type="password" label="Turnstile Secret" maxLength={500} placeholder="留空或保留掩码表示不修改" />
          {editingRecord ? <Form.Checkbox field="clearTurnstileSecret" noLabel>清除已配置的 Turnstile Secret</Form.Checkbox> : null}
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Section text="表单字段">
            <ArrayField field="fields">
              {({ add, arrayFields }) => (
                <>
                  {arrayFields.map(({ field, key, remove }) => (
                    <div key={key} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 10, marginBottom: 8 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                        <Form.Input field={`${field}[name]`} noLabel placeholder="字段标识（英文）" style={{ width: 140 }}
                        rules={[{ required: true, message: '必填' }, { pattern: /^[a-z][a-z0-9_]*$/, message: '小写字母开头' }]} />
                        <Form.Input field={`${field}[label]`} noLabel placeholder="字段名称" style={{ width: 130 }}
                        rules={[{ required: true, message: '必填' }]} />
                        <Form.Select field={`${field}[fieldType]`} noLabel initValue="text" style={{ width: 110 }} optionList={FIELD_TYPE_OPTIONS} />
                        <Form.Checkbox field={`${field}[required]`} noLabel>必填</Form.Checkbox>
                        <Button type="danger" theme="borderless" icon={<Trash2 size={14} />} onClick={() => remove()} style={{ marginTop: 4 }} />
                      </div>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: 8 }}>
                        <Form.InputNumber field={`${field}[minLength]`} noLabel placeholder="最小长度" min={0} max={2000} />
                        <Form.InputNumber field={`${field}[maxLength]`} noLabel placeholder="最大长度" min={1} max={2000} />
                        <Form.Input field={`${field}[pattern]`} noLabel placeholder="RE2 规则，如 ^[A-Z]{2}-\\d{4}$" />
                        <Form.InputNumber field={`${field}[min]`} noLabel placeholder="数字最小值" />
                        <Form.InputNumber field={`${field}[max]`} noLabel placeholder="数字最大值" />
                        <Form.Input field={`${field}[errorMessage]`} noLabel placeholder="自定义错误提示" />
                        <Form.TextArea field={`${field}[optionsText]`} noLabel rows={2} placeholder={'选项（select/radio），每行：显示名=值'} />
                      </div>
                    </div>
                  ))}
                  <Button icon={<Plus size={14} />} onClick={() => add()}>添加字段</Button>
                  <Typography.Text type="secondary" size="small" style={{ display: 'block', marginTop: 8 }}>
                    自定义规则由服务端 RE2JS 线性时间引擎编译执行（最长 200 字符）；不支持反向引用等非 RE2 语法。
                  </Typography.Text>
                </>
              )}
            </ArrayField>
          </Form.Section>
        </Form>
      </AppModal>

      <SubmissionsSheet form={viewingForm} onClose={() => setViewingForm(null)} />
      <AppModal
        title={`前台表单预览 — ${previewingForm?.name ?? ''}`}
        visible={previewingForm !== null}
        onCancel={() => setPreviewingForm(null)}
        footer={null}
        width={560}
        closeOnEsc
      >
        {previewingForm ? (
          <Form labelPosition="top" disabled>
            {previewingForm.fields.map((field) => (
              field.fieldType === 'textarea'
                ? <Form.TextArea key={field.name} field={field.name} label={field.label} placeholder={field.errorMessage ?? undefined} />
                : field.fieldType === 'select'
                ? <Form.Select key={field.name} field={field.name} label={field.label} optionList={field.options ?? []} />
                : <Form.Input key={field.name} field={field.name} label={field.label} type={field.fieldType === 'email' ? 'email' : field.fieldType === 'number' ? 'number' : 'text'} />
            ))}
            <Typography.Text type="tertiary">
              验证码：{CMS_FORM_CAPTCHA_PROVIDER_LABELS[previewingForm.captchaProvider]}
            </Typography.Text>
          </Form>
        ) : null}
      </AppModal>
    </div>
  );
}
