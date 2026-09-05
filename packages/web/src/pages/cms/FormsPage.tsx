import { useState } from 'react';
import { ArrayField, Button, Col, Form, Row, SideSheet, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus, Trash2 } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { ExportButton } from '@/components/ExportButton';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsFormList, useSaveCmsForm, useDeleteCmsForms,
  useCmsFormSubmissions, useDeleteCmsFormSubmissions,
} from '@/hooks/queries/cms';
import { CMS_FORM_CAPTCHA_PROVIDERS, CMS_FORM_CAPTCHA_PROVIDER_LABELS, CMS_FORM_FIELD_TYPES, CMS_FORM_FIELD_TYPE_LABELS } from '@zenith/shared/cms';
import type { CmsForm, CmsFormSubmission } from '@zenith/shared/cms';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton } from '@/components/toolbar-controls';
import { confirmDelete } from '@/utils/confirm';
import { dateTimeColumn, renderEnabledStatusTag } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';

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
    { title: 'IP', dataIndex: 'ip', minWidth: 120, render: (v: string | null) => v ?? '-' },
    dateTimeColumn('提交时间', 'createdAt'),
    createOperationColumn<CmsFormSubmission>({
      width: 100,
      desktopInlineKeys: ['delete'],
      actions: (record) => hasPermission('cms:form:manage') && form ? [{
        key: 'delete', label: '删除', danger: true,
        onClick: () => {
          confirmDelete({
            title: '确定要删除该提交记录吗？',
            onOk: async () => {
              await deleteMutation.mutateAsync({ params: { id: form.id }, body: { ids: [record.id] } });
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
          <ExportButton entity="cms.form-submissions" permission="cms:form:manage" query={{ formId: form.id }} />
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
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [viewingForm, setViewingForm] = useState<CmsForm | null>(null);
  const [previewingForm, setPreviewingForm] = useState<CmsForm | null>(null);

  const listQuery = useCmsFormList({ page, pageSize, siteId: siteId ?? 0 }, siteId !== undefined);
  const saveMutation = useSaveCmsForm();
  const modal = useEditModal<CmsForm, Partial<CmsForm> & { clearTurnstileSecret?: boolean; fields?: Array<Record<string, unknown>> }, Record<string, unknown>>({
    entityName: '表单',
    save: saveMutation,
    defaults: { status: 'enabled', captchaProvider: 'inherit', fields: [{ name: 'name', label: '姓名', fieldType: 'text', required: true }] },
    toValues: (record) => ({
      name: record.name, code: record.code, successMessage: record.successMessage ?? '', notifyEmail: record.notifyEmail ?? '',
      captchaProvider: record.captchaProvider, turnstileSiteKey: record.turnstileSiteKey ?? '', turnstileSecret: '', clearTurnstileSecret: false,
      status: record.status, fields: record.fields.map((f) => ({ ...f, optionsText: (f.options ?? []).map((option) => `${option.label}=${option.value}`).join('\n') })),
    }),
    beforeSave: (values, { isEdit }) => {
      if (!isEdit && !siteId) abortSubmit('validation');
      const payload: Record<string, unknown> = { ...values, ...(!isEdit ? { siteId } : {}) };
      payload.turnstileSecret = values.clearTurnstileSecret === true ? null : (values.turnstileSecret ?? '');
      delete payload.clearTurnstileSecret;
      payload.fields = ((values.fields as Array<Record<string, unknown>> | undefined) ?? []).map((field) => {
        const options = String(field.optionsText ?? '').split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
          const [label, value = label] = line.split('=').map((part) => part.trim());
          return { label, value };
        });
        const { optionsText: _optionsText, ...rest } = field;
        return { ...rest, options: options.length > 0 ? options : null };
      });
      return payload;
    },
    labelWidth: 140,
  });
  const deleteMutation = useDeleteCmsForms();
  const canManage = hasPermission('cms:form:manage');

  const columns: ColumnProps<CmsForm>[] = [
    { title: '表单名称', dataIndex: 'name', minWidth: 160 },
    { title: '标识', dataIndex: 'code', width: 120, render: (v: string) => <Tag size="small">{v}</Tag> },
    {
      title: '字段',
      dataIndex: 'fields',
      width: 280,
      render: (fields: CmsForm['fields']) => fields.map((f) => <Tag key={f.name} size="small" style={{ marginRight: 4 }}>{f.label}</Tag>),
    },
    { title: '提交数', dataIndex: 'submissionCount', width: 90, align: 'right' },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: renderEnabledStatusTag,
    },
    createOperationColumn<CmsForm>({
      width: 260,
      desktopInlineKeys: ['data', 'edit', 'delete'],
      actions: (record) => [
        { key: 'data', label: '提交数据', onClick: () => setViewingForm(record) },
        { key: 'preview', label: '预览', onClick: () => setPreviewingForm(record) },
        ...(canManage ? [
          { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
          {
            key: 'delete', label: '删除', danger: true,
            onClick: () => {
              confirmDelete({
                title: '确定要删除该表单吗？',
                content: '表单的全部提交数据将一并删除',
                onOk: async () => {
                  await deleteMutation.mutateAsync([record.id]);
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
        {canManage ? <CreateButton onClick={modal.openCreate}>新增表单</CreateButton> : null}
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

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={860}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
            <Button type="tertiary" onClick={modal.close}>取消</Button>
            <Button
              type="primary"
              theme="solid"
              loading={modal.modalProps.okButtonProps.loading}
              disabled={modal.modalProps.okButtonProps.disabled}
              onClick={() => void modal.modalProps.onOk()}
            >
              保存
            </Button>
          </div>
        )}
      >
        <Form key={modal.formKey} {...modal.formProps}>
          <Form.Section text="基础信息">
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="name" label="表单名称" rules={[{ required: true, message: '请输入表单名称' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="code" label="表单标识" disabled={modal.isEdit} placeholder="如 contact（前台提交与栏目绑定用）" rules={[{ required: true, message: '请输入表单标识' }]} />
              </Col>
            </Row>
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="successMessage" label="成功提示" placeholder="提交成功后展示的文案" />
              </Col>
              <Col span={12}>
                <Form.RadioGroup field="status" label="状态">
                  <Form.Radio value="enabled">启用</Form.Radio>
                  <Form.Radio value="disabled">停用</Form.Radio>
                </Form.RadioGroup>
              </Col>
            </Row>
            <Form.Input field="notifyEmail" label="通知邮箱" placeholder="收到新提交时通知，多个邮箱用逗号分隔（留空不通知）" />
          </Form.Section>

          <Form.Section text="验证码防护">
            <Form.Select field="captchaProvider" label="验证码策略" style={{ width: '100%' }}
              optionList={CMS_FORM_CAPTCHA_PROVIDERS.map((value) => ({ value, label: CMS_FORM_CAPTCHA_PROVIDER_LABELS[value] }))} />
            <Row gutter={16}>
              <Col span={12}>
                <Form.Input field="turnstileSiteKey" label="Turnstile Site Key" maxLength={200} />
              </Col>
              <Col span={12}>
                <Form.Input field="turnstileSecret" type="password" label="Turnstile Secret" maxLength={500} placeholder="留空或保留掩码表示不修改" />
              </Col>
            </Row>
            {modal.isEdit ? <Form.Checkbox field="clearTurnstileSecret" noLabel>清除已配置的 Turnstile Secret</Form.Checkbox> : null}
          </Form.Section>

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
                      <div className="auto-grid" style={{ ['--auto-grid-min' as string]: '150px', ['--auto-grid-cols' as string]: 3, ['--auto-grid-gap' as string]: '8px' }}>
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
      </SideSheet>

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
                : field.fieldType === 'radio'
                ? <Form.RadioGroup key={field.name} field={field.name} label={field.label} options={field.options ?? []} />
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
