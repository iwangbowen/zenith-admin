import { useContext } from 'react';
import { Form, Typography } from '@douyinfe/semi-ui';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { rmbUpper } from '@/utils/rmb';
import { ValuesContext } from './contexts';
import { formatReadOnlyValue, readOnlyFieldLabel } from './read-only-text';

/** 查看态：简单值字段以纯文本呈现（金额附大写） */
export function ReadOnlyFieldValue({ field }: Readonly<{ field: WorkflowFormField }>) {
  const values = useContext(ValuesContext);
  const text = formatReadOnlyValue(field, values[field.key]);
  const upper = field.type === 'amount' && field.amountInWords && (field.currency ?? 'CNY') === 'CNY'
    ? rmbUpper(values[field.key] as number)
    : '';
  return (
    <Form.Slot label={{ text: readOnlyFieldLabel(field) }}>
      <Typography.Text style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
        {text || '—'}
      </Typography.Text>
      {upper && (
        <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 2 }}>
          大写：{upper}
        </Typography.Text>
      )}
    </Form.Slot>
  );
}
