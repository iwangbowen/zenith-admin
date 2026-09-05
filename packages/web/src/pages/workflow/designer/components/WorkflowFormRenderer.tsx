/**
 * 工作流表单渲染器 — 设计器预览和运行时（发起/审批）共用
 * 支持联动：公式实时计算、dateRange→天数、select 级联
 *
 * 实现拆分在 ./form-renderer/：字段分派 FieldRenderer、布局容器 layout-fields、
 * 自定义控件 field-controls 等、校验规则 field-rules、联动 use-form-linkage。
 */
import { useMemo, useRef } from 'react';
import type { CSSProperties } from 'react';
import { Form, Row, Col } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { WorkflowFormField } from '@zenith/shared/workflow';
import { isWorkflowFieldVisible as isFieldVisible } from '@zenith/shared/workflow';
import { ReadOnlyTextContext, ValuesContext } from './form-renderer/contexts';
import { colSpanOf, flattenFields } from './form-renderer/field-utils';
import { FieldRenderer } from './form-renderer/FieldRenderer';
import { useFormLinkage } from './form-renderer/use-form-linkage';

interface RendererProps {
  fields: WorkflowFormField[];
  initValues?: Record<string, unknown>;
  getFormApi?: (api: FormApi) => void;
  onValueChange?: (values: Record<string, unknown>) => void;
  readOnly?: boolean;
  /**
   * 查看态文本化：readOnly 时把简单值字段渲染为纯文本（而非 disabled 输入框）。
   * 用于详情/审批等「查看已提交数据」场景；设计器的结构预览不要开启（预览需要控件形态）。
   */
  readOnlyAsText?: boolean;
  style?: CSSProperties;
  labelPosition?: 'top' | 'left' | 'inset';
  labelAlign?: 'left' | 'right';
  labelWidth?: number;
}

export default function WorkflowFormRenderer({
  fields, initValues, getFormApi, onValueChange, readOnly, readOnlyAsText, style, labelPosition = 'top', labelAlign, labelWidth,
}: Readonly<RendererProps>) {
  const formApiRef = useRef<FormApi | null>(null);

  const all = useMemo(() => flattenFields(fields), [fields]);
  const { enrichedInitValues, valuesState, handleValueChange } = useFormLinkage({
    all, initValues, readOnly, formApiRef, onValueChange,
  });

  return (
    <ValuesContext.Provider value={valuesState}>
      <ReadOnlyTextContext.Provider value={!!readOnlyAsText}>
        <Form
          labelPosition={labelPosition}
          labelAlign={labelAlign}
          labelWidth={labelPosition === 'left' || labelPosition === 'inset' ? (labelWidth ?? 96) : undefined}
          allowEmpty
          style={style}
          initValues={enrichedInitValues}
          getFormApi={(api) => { formApiRef.current = api; getFormApi?.(api); }}
          onValueChange={handleValueChange}
        >
          <Row gutter={16}>
            {fields.map(field => (
              isFieldVisible(field, valuesState) ? (
                <Col span={colSpanOf(field)} key={field.key}>
                  <FieldRenderer field={field} readOnly={readOnly} />
                </Col>
              ) : null
            ))}
          </Row>
        </Form>
      </ReadOnlyTextContext.Provider>
    </ValuesContext.Provider>
  );
}