/**
 * 表单预览组件 — 在 Modal 中渲染真实表单控件预览
 */
import { Modal, Form, Select, DatePicker, InputNumber, Upload, Button, Tag, Typography, Row, Col, Divider } from '@douyinfe/semi-ui';
import { Plus } from 'lucide-react';
import type { WorkflowFormField } from '@zenith/shared';
import { CURRENCY_OPTIONS } from '../form-types';

interface FormPreviewProps {
  visible: boolean;
  fields: WorkflowFormField[];
  onClose: () => void;
}

export default function FormPreview({ visible, fields, onClose }: Readonly<FormPreviewProps>) {
  return (
    <Modal
      title="表单预览"
      visible={visible}
      onCancel={onClose}
      footer={
        <Button type="primary" onClick={onClose}>关闭</Button>
      }
      width={560}
      bodyStyle={{ maxHeight: '65vh', overflowY: 'auto' }}
    >
      {fields.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--semi-color-text-2)', padding: '40px 0' }}>
          暂无表单字段
        </div>
      ) : (
        <Form labelPosition="top" style={{ padding: '0 8px' }}>
          {fields.map(field => (
            <PreviewField key={field.key} field={field} />
          ))}
        </Form>
      )}
    </Modal>
  );
}

function PreviewField({ field }: Readonly<{ field: WorkflowFormField }>) {
  const rules = field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined;

  switch (field.type) {
    case 'text':
      return (
        <Form.Input
          field={field.key}
          label={field.label}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          rules={rules}
        />
      );

    case 'textarea':
      return (
        <Form.TextArea
          field={field.key}
          label={field.label}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          autosize={{ minRows: 2, maxRows: 6 }}
          rules={rules}
        />
      );

    case 'number':
      return (
        <Form.InputNumber
          field={field.key}
          label={field.label}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          precision={field.precision}
          style={{ width: '100%' }}
          rules={rules}
        />
      );

    case 'amount': {
      const currencyLabel = CURRENCY_OPTIONS.find(c => c.value === (field.currency ?? 'CNY'))?.label ?? 'CNY';
      return (
        <Form.InputNumber
          field={field.key}
          label={`${field.label}（${currencyLabel}）`}
          placeholder={field.placeholder ?? `请输入${field.label}`}
          precision={field.precision ?? 2}
          style={{ width: '100%' }}
          prefix="¥"
          rules={rules}
        />
      );
    }

    case 'date':
      return (
        <Form.DatePicker
          field={field.key}
          label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          style={{ width: '100%' }}
          format={field.dateFormat ?? 'yyyy-MM-dd'}
          rules={rules}
        />
      );

    case 'dateRange':
      return (
        <Form.DatePicker
          field={field.key}
          label={field.label}
          type="dateRange"
          style={{ width: '100%' }}
          format={field.dateFormat ?? 'yyyy-MM-dd'}
          rules={rules}
        />
      );

    case 'select':
      return (
        <Form.Select
          field={field.key}
          label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          style={{ width: '100%' }}
          rules={rules}
        >
          {(field.options ?? []).map(opt => (
            <Select.Option key={opt} value={opt}>{opt}</Select.Option>
          ))}
        </Form.Select>
      );

    case 'multiSelect':
      return (
        <Form.Select
          field={field.key}
          label={field.label}
          placeholder={field.placeholder ?? `请选择${field.label}`}
          multiple
          style={{ width: '100%' }}
          rules={rules}
        >
          {(field.options ?? []).map(opt => (
            <Select.Option key={opt} value={opt}>{opt}</Select.Option>
          ))}
        </Form.Select>
      );

    case 'attachment':
    case 'image':
      return (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 4 }}>
            {field.label}{field.required && <span style={{ color: 'var(--semi-color-danger)' }}> *</span>}
          </Typography.Text>
          <Upload action="" listType={field.type === 'image' ? 'picture' : 'list'} limit={field.maxCount ?? 5}>
            <Button icon={<Plus size={14} />} theme="light">
              {field.type === 'image' ? '上传图片' : '上传文件'}
            </Button>
          </Upload>
          {field.maxCount && (
            <Typography.Text type="tertiary" size="small">
              最多上传 {field.maxCount} 个文件
            </Typography.Text>
          )}
        </div>
      );

    case 'contact':
      return (
        <Form.Select
          field={field.key}
          label={field.label}
          placeholder="请选择联系人"
          style={{ width: '100%' }}
          rules={rules}
          disabled
        >
          <Select.Option value="demo">（联系人选择器）</Select.Option>
        </Form.Select>
      );

    case 'department':
      return (
        <Form.Select
          field={field.key}
          label={field.label}
          placeholder="请选择部门"
          style={{ width: '100%' }}
          rules={rules}
          disabled
        >
          <Select.Option value="demo">（部门选择器）</Select.Option>
        </Form.Select>
      );

    case 'description':
      return (
        <div style={{ marginBottom: 16, padding: '12px', background: 'var(--semi-color-fill-0)', borderRadius: 6 }}>
          <Typography.Text type="secondary">
            {field.description || '说明文字'}
          </Typography.Text>
        </div>
      );

    case 'serialNumber':
      return (
        <Form.Input
          field={field.key}
          label={field.label}
          disabled
          initValue={`${field.serialPrefix ?? ''}20260101001`}
        />
      );

    case 'detail': {
      const children = field.children ?? [];
      return (
        <div style={{ marginBottom: 16 }}>
          <Typography.Text strong style={{ display: 'block', marginBottom: 8 }}>
            {field.label}{field.required && <span style={{ color: 'var(--semi-color-danger)' }}> *</span>}
          </Typography.Text>
          <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 6, padding: 12, background: 'var(--semi-color-fill-0)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 }}>
              {children.map(child => (
                <Tag key={child.key} color="blue" size="large">{child.label}</Tag>
              ))}
            </div>
            <Button size="small" theme="light" icon={<Plus size={12} />}>添加明细行</Button>
          </div>
        </div>
      );
    }

    case 'row':
      return (
        <Row gutter={16}>
          {(field.columns || []).map((col, ci) => (
            // eslint-disable-next-line react/no-array-index-key
            <Col span={col.span} key={ci}>
              {(col.fields || []).map(childField => (
                <PreviewField key={childField.key} field={childField} />
              ))}
            </Col>
          ))}
        </Row>
      );

    case 'divider':
      return <Divider style={{ margin: '16px 0' }} />;

    case 'group':
      return (
        <div style={{ marginBottom: 24 }}>
          <div style={{
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--semi-color-text-0)',
            borderBottom: '1px solid var(--semi-color-border)',
            paddingBottom: 8,
            marginBottom: 16,
          }}>
            {field.title || field.label}
          </div>
          {(field.children || []).map(childField => (
            <PreviewField key={childField.key} field={childField} />
          ))}
        </div>
      );

    default:
      return (
        <Form.Input
          field={field.key}
          label={field.label}
          placeholder={field.placeholder}
          rules={rules}
        />
      );
  }
}
