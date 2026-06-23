import { useRef } from 'react';
import type { ReactNode } from 'react';
import { Col, Form, Row, withField } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { AppModal } from '@/components/AppModal';
import ColorPickerInput from '@/components/ColorPickerInput';
import IconPicker from '@/components/IconPicker';

const FormColorPicker = withField(ColorPickerInput);
const FormIconPicker = withField(IconPicker);

export interface WorkflowTemplateFormValues extends Record<string, unknown> {
  name?: string;
  code?: string;
  description?: string;
  categoryName?: string;
  icon?: string;
  color?: string;
  sort?: number;
}

interface Props {
  visible: boolean;
  title: string;
  /** 表单初始值；配合 formKey 在每次打开时重置 */
  initValues?: WorkflowTemplateFormValues;
  /** 用于切换记录时重置表单内部状态，通常传入记录 id */
  formKey?: string | number;
  /** 是否展示「分类」「排序」字段（编辑模板用，另存为模板不需要） */
  showCategorySort?: boolean;
  okText?: string;
  /** 确认按钮图标，如另存为模板使用 Save 图标 */
  okIcon?: ReactNode;
  confirmLoading?: boolean;
  width?: number;
  onCancel: () => void;
  onSubmit: (values: WorkflowTemplateFormValues) => void | Promise<void>;
}

/**
 * 流程模板表单弹窗 — 供「流程模板·编辑」与「流程定义·另存为模板」共用。
 * 统一两列布局、颜色选择器及字段校验；提交逻辑由各页面通过 onSubmit 自行处理。
 */
export default function WorkflowTemplateFormModal({
  visible,
  title,
  initValues,
  formKey,
  showCategorySort = false,
  okText = '保存',
  okIcon,
  confirmLoading,
  width = 680,
  onCancel,
  onSubmit,
}: Readonly<Props>) {
  const formApi = useRef<FormApi | null>(null);

  return (
    <AppModal
      title={title}
      visible={visible}
      onCancel={onCancel}
      onOk={() => { void formApi.current?.submitForm(); }}
      confirmLoading={confirmLoading}
      okText={okText}
      okButtonProps={okIcon ? { icon: okIcon } : undefined}
      width={width}
    >
      <Form<WorkflowTemplateFormValues>
        key={formKey ?? 'workflow-template-form'}
        getFormApi={(api) => { formApi.current = api; }}
        onSubmit={onSubmit}
        labelPosition="left"
        labelWidth={90}
        initValues={initValues}
      >
        <Row gutter={16}>
          <Col span={12}>
            <Form.Input
              field="name"
              label="模板名称"
              placeholder="请输入模板名称"
              rules={[{ required: true, message: '请输入模板名称' }]}
            />
          </Col>
          <Col span={12}>
            <Form.Input field="code" label="模板编码" placeholder="选填，唯一标识" />
          </Col>
          {showCategorySort && (
            <>
              <Col span={12}>
                <Form.Input field="categoryName" label="分类" placeholder="选填" />
              </Col>
              <Col span={12}>
                <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
              </Col>
            </>
          )}
          <Col span={12}>
            <FormIconPicker field="icon" label="图标" />
          </Col>
          <Col span={12}>
            <FormColorPicker field="color" label="颜色" />
          </Col>
        </Row>
        <Form.TextArea field="description" label="描述" placeholder="选填" autosize rows={2} />
      </Form>
    </AppModal>
  );
}
