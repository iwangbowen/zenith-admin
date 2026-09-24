import { FormPasswordInput } from '@/components/PasswordInput';
import { useState } from 'react';
import { ArrayField, Button, Col, Form, Row, SideSheet, Tag, Typography } from '@douyinfe/semi-ui';
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
import { EMPTY_PLACEHOLDER, dateTimeColumn, overflowTagColumn, renderEllipsis, enabledStatusColumn } from '@/utils/table-columns';
import { abortSubmit } from '@/lib/abort-submit';
import { deleteAction, listTableProps } from '@/components/list-page';
import { FormStatusRadioGroup } from '@/components/FormStatusRadioGroup';
import { EditFormSheet } from '@/components/EditFormModal';

const FIELD_TYPE_OPTIONS = CMS_FORM_FIELD_TYPES.map((t) => ({ value: t, label: CMS_FORM_FIELD_TYPE_LABELS[t] }));

/** 提交数据抽屉 */
function SubmissionsSheet({ form, onClose }: Readonly<{ form: CmsForm | null; onClose: () => void }>) {
  const { hasPermission } = usePermission();
  const { page, pageSize, buildPagination } = usePagination(10);
  const listQuery = useCmsFormSubmissions(form?.id, page, pageSize);
  const deleteMutation = useDeleteCmsFormSubmissions();

  const fieldColumns: ColumnProps<CmsFormSubmission>[] = (form?.fields ?? []).map((f) => ({
    title: f.label,
    width: 150,
    render: (_: unknown, record: CmsFormSubmission) => renderEllipsis(String(record.data[f.name] ?? '')),
  }));

  const columns: ColumnProps<CmsFormSubmission>[] = [
    ...fieldColumns,
    { title: 'IP', dataIndex: 'ip', minWidth: 120, render: (v: string | null) => v || EMPTY_PLACEHOLDER },
    dateTimeColumn('提交时间', 'createdAt'),
    createOperationColumn<CmsFormSubmission>({
      width: 100,
      desktopInlineKeys: ['delete'],
      actions: (record) => form ? [
        deleteAction({
          hidden: !hasPermission('cms:form:manage'),
          title: '确定要删除该提交记录吗？',
          run: () => deleteMutation.mutateAsync({ params: { id: form.id }, body: { ids: [record.id] } }),
        }),
      ] : [],
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
      <ConfigurableTable<CmsFormSubmission>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无提交数据',
        })}
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
    overflowTagColumn<CmsForm>({
      title: '字段',
      dataIndex: 'fields',
      width: 280,
      contentWidth: 248,
      getItems: (fields) => ((fields as CmsForm['fields'] | undefined) ?? []).map((f) => ({
        key: f.name,
        label: f.label,
      })),
      tagSize: 'small',
      popoverWidth: 260,
    }),
    { title: '提交数', dataIndex: 'submissionCount', width: 90, align: 'right' },
    enabledStatusColumn(),
    createOperationColumn<CmsForm>({
      width: 260,
      desktopInlineKeys: ['data', 'edit', 'delete'],
      actions: (record) => [
        { key: 'data', label: '提交数据', onClick: () => setViewingForm(record) },
        { key: 'preview', label: '预览', onClick: () => setPreviewingForm(record) },
        ...(canManage ? [
          { key: 'edit', label: '编辑', onClick: () => modal.openEdit(record) },
          // eslint-disable-next-line no-restricted-syntax -- 嵌套组件 / 复合操作列，保留 createOperationColumn
          deleteAction({
            title: '确定要删除该表单吗？',
            content: '表单的全部提交数据将一并删除',
            run: () => deleteMutation.mutateAsync([record.id]),
          }),
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

      <ConfigurableTable<CmsForm>
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无表单；将表单标识填入单页栏目 settings.formCode 即可在前台展示' })}
      />

      <EditFormSheet modal={modal} width={860}>
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
              <FormStatusRadioGroup />
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
              <FormPasswordInput field="turnstileSecret" label="Turnstile Secret" maxLength={500} placeholder="留空或保留掩码表示不修改" />
            </Col>
          </Row>
          {modal.isEdit ? <Form.Checkbox field="clearTurnstileSecret" noLabel>清除已配置的 Turnstile Secret</Form.Checkbox> : null}
        </Form.Section>

        <Form.Section text="表单字段">
          <ArrayField field="fields">
            {({ add, arrayFields }) => (
              <>
                {arrayFields.map(({ field, key, remove }, index) => (
                  <div
                    key={key}
                    style={index === arrayFields.length - 1
                      ? { position: 'relative', paddingBottom: 4 }
                      : { position: 'relative', borderBottom: '1px solid var(--semi-color-border)', paddingBottom: 16, marginBottom: 16 }}
                  >
                    <Button type="danger" theme="borderless" icon={<Trash2 size={14} />} onClick={() => remove()} aria-label="删除字段" style={{ position: 'absolute', top: 0, right: 0 }} />
                    <Row gutter={16} style={{ paddingRight: 40 }}>
                      <Col span={12}>
                        <Form.Input field={`${field}[name]`} label="字段标识" placeholder="英文，如 venue"
                          rules={[{ required: true, message: '必填' }, { pattern: /^[a-z][a-z0-9_]*$/, message: '小写字母开头' }]} />
                      </Col>
                      <Col span={12}>
                        <Form.Input field={`${field}[label]`} label="字段名称"
                          rules={[{ required: true, message: '必填' }]} />
                      </Col>
                      <Col span={12}>
                        <Form.Select field={`${field}[fieldType]`} label="字段类型" initValue="text" optionList={FIELD_TYPE_OPTIONS} />
                      </Col>
                      <Col span={12}>
                        <Form.Input field={`${field}[errorMessage]`} label="自定义错误提示" />
                      </Col>
                      <Col span={12}>
                        <Form.InputNumber field={`${field}[minLength]`} label="最小长度" min={0} max={2000} />
                      </Col>
                      <Col span={12}>
                        <Form.InputNumber field={`${field}[maxLength]`} label="最大长度" min={1} max={2000} />
                      </Col>
                      <Col span={12}>
                        <Form.InputNumber field={`${field}[min]`} label="数字最小值" />
                      </Col>
                      <Col span={12}>
                        <Form.InputNumber field={`${field}[max]`} label="数字最大值" />
                      </Col>
                      <Col span={24}>
                        <Form.Input field={`${field}[pattern]`} label="校验规则" placeholder="RE2 规则，如 ^[A-Z]{2}-\\d{4}$" />
                      </Col>
                      <Col span={24}>
                        <Form.TextArea field={`${field}[optionsText]`} label="选项说明" rows={2} placeholder="选项（select/radio），每行：显示名=值" />
                      </Col>
                    </Row>
                    <div style={{ display: 'flex', gap: 16, alignItems: 'center', margin: '4px 0' }}>
                      <Form.Checkbox field={`${field}[required]`} noLabel>必填</Form.Checkbox>
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
      </EditFormSheet>

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
