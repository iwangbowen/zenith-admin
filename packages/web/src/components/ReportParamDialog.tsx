import { useMemo, useRef } from 'react';
import { DatePicker, Form, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ReportDatasetParam } from '@zenith/shared';
import AppModal from './AppModal';
import { buildReportParamInitialValues, normalizeReportParamValues } from './report-param-utils';

interface ReportParamDialogProps {
  visible: boolean;
  title: string;
  params: ReportDatasetParam[];
  initialValues?: Record<string, unknown>;
  loading?: boolean;
  confirmText?: string;
  onCancel: () => void;
  onSubmit: (values: Record<string, unknown>) => void | Promise<void>;
}

export function ReportParamDialog({
  visible,
  title,
  params,
  initialValues,
  loading,
  confirmText = '确定',
  onCancel,
  onSubmit,
}: Readonly<ReportParamDialogProps>) {
  const formApiRef = useRef<FormApi | null>(null);
  const initValues = useMemo(() => buildReportParamInitialValues(params, initialValues), [initialValues, params]);

  const handleOk = async () => {
    const values = await formApiRef.current?.validate().catch(() => null);
    if (!values) return;
    await onSubmit(normalizeReportParamValues(params, values as Record<string, unknown>));
  };

  return (
    <AppModal
      title={title}
      visible={visible}
      onCancel={onCancel}
      onOk={() => void handleOk()}
      okText={confirmText}
      okButtonProps={{ loading }}
      width={620}
      closeOnEsc
    >
      {params.length === 0 ? (
        <Typography.Text type="tertiary">该报表没有可输入参数，将直接继续。</Typography.Text>
      ) : (
        <Form key={`${title}-${params.map((param) => param.name).join(',')}`} initValues={initValues} getFormApi={(api) => { formApiRef.current = api; }} labelPosition="left" labelWidth={96}>
          {params.map((param) => {
            const label = param.label || param.name;
            const rules = param.required ? [{ required: true, message: `请填写${label}` }] : undefined;
            if (param.type === 'number') return <Form.InputNumber key={param.name} field={param.name} label={label} rules={rules} style={{ width: '100%' }} />;
            if (param.type === 'boolean') return <Form.Switch key={param.name} field={param.name} label={label} />;
            if (param.type === 'date') {
              return (
                <Form.Slot key={param.name} label={label}>
                  <DatePicker
                    type="date"
                    value={initValues[param.name] ? new Date(String(initValues[param.name])) : undefined}
                    style={{ width: '100%' }}
                    onChange={(value) => formApiRef.current?.setValue(param.name, value ? new Date(value as Date) : undefined)}
                  />
                </Form.Slot>
              );
            }
            return <Form.Input key={param.name} field={param.name} label={label} rules={rules} showClear />;
          })}
        </Form>
      )}
    </AppModal>
  );
}

export default ReportParamDialog;
