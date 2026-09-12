/**
 * 自定义业务表单示例页面
 *
 * 演示「自定义业务表单」契约：同一组件按 props.mode 区分发起填写 / 只读查看。
 * 通过 props.getFormApi 向宿主注册 validate / getValues，供发起工作台提交时取值。
 *
 * 用户在实际业务中可参照本文件，在 src/pages 下实现自己的业务表单页面，
 * 并在流程设计器「表单 → 自定义业务表单」中填写其组件路径。
 */
import { useEffect, useRef } from 'react';
import { Form, Descriptions, Typography, Banner } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ClipboardList } from 'lucide-react';
import type { WorkflowBusinessFormProps } from '@/components/workflow/BusinessFormHost';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

export default function DemoBusinessForm({
  mode,
  value,
  readOnly,
  getFormApi,
}: Readonly<WorkflowBusinessFormProps>) {
  // useEditModal 例外：工作流运行时业务表单（由流程发起 / 审批页承载提交，本组件只渲染字段）
  const formApiRef = useRef<FormApi | null>(null);

  useEffect(() => {
    // 创建 / 审批模式向宿主注册命令式 API
    if (mode === 'view') return;
    getFormApi?.({
      validate: async () => (await formApiRef.current?.validate()) as Record<string, unknown>,
      getValues: () => (formApiRef.current?.getValues() as Record<string, unknown>) ?? {},
    });
  }, [mode, getFormApi]);

  // 只读查看：业务方自定义的展示样式（与填写样式不同）
  if (mode === 'view' || readOnly) {
    return (
      <div>
        <Typography.Title heading={6} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
          <ClipboardList size={16} /> 业务申请详情
        </Typography.Title>
        <Descriptions
          row
          data={[
            { key: '金额', value: value.amount != null ? `¥ ${String(value.amount)}` : EMPTY_PLACEHOLDER },
            { key: '事由', value: (value.reason as string) || EMPTY_PLACEHOLDER },
            { key: '备注', value: (value.remark as string) || EMPTY_PLACEHOLDER },
          ]}
        />
      </div>
    );
  }

  // 发起填写：业务方自定义的录入表单
  return (
    <div>
      <Banner
        type="info"
        bordered
        closeIcon={null}
        description="这是「自定义业务表单」示例页面，由业务方在 src/pages 下实现，发起与查看复用同一组件并按 mode 切换样式。"
        style={{ marginBottom: 12 }}
      />
      <Form
        initValues={value}
        getFormApi={(api) => { formApiRef.current = api; }}
        labelPosition="top"
      >
        <Form.InputNumber
          field="amount"
          label="金额"
          prefix="¥"
          style={{ width: '100%' }}
          min={0}
          rules={[{ required: true, message: '请输入金额' }]}
        />
        <Form.Input
          field="reason"
          label="事由"
          rules={[{ required: true, message: '请输入事由' }]}
        />
        <Form.TextArea field="remark" label="备注" autosize rows={2} />
      </Form>
    </div>
  );
}
