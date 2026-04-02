/**
 * 基础信息面板 — 步骤 ① 基础信息
 */
import { Form } from '@douyinfe/semi-ui';
import type { WorkflowDefinition } from '@zenith/shared';

interface BasicInfoPanelProps {
  definition: WorkflowDefinition | null;
  isNew: boolean;
  onFieldChange: (field: string, value: string) => void;
}

function getStatusLabel(status: string): string {
  if (status === 'published') return '已发布';
  if (status === 'draft') return '草稿';
  return '已禁用';
}

export default function BasicInfoPanel({ definition, isNew, onFieldChange }: Readonly<BasicInfoPanelProps>) {
  return (
    <div className="fd-basic-info">
      <div className="fd-basic-info__inner">
        <Form
          initValues={{
            name: definition?.name ?? '',
            description: definition?.description ?? '',
          }}
          labelPosition="top"
          onValueChange={(values: Record<string, unknown>) => {
            if (typeof values.name === 'string') onFieldChange('name', values.name);
            if (typeof values.description === 'string') onFieldChange('description', values.description);
          }}
        >
          <Form.Input
            field="name"
            label="流程名称"
            placeholder="请输入流程名称"
            rules={[{ required: true, message: '请输入流程名称' }]}
          />
          <Form.TextArea
            field="description"
            label="流程描述"
            placeholder="请输入流程描述"
            autosize={{ minRows: 3, maxRows: 6 }}
          />
          {!isNew && definition && (
            <>
              <Form.Input field="version" label="版本号" disabled initValue={String(definition.version)} />
              <Form.Input field="status" label="状态" disabled initValue={getStatusLabel(definition.status)} />
            </>
          )}
        </Form>
      </div>
    </div>
  );
}
