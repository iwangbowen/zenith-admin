/**
 * 更多设置面板 — 步骤 ④ 更多设置
 */
import { Form, Select } from '@douyinfe/semi-ui';
import type { AdvancedSettingsData } from './advanced-settings';

export type { AdvancedSettingsData } from './advanced-settings';

interface AdvancedSettingsProps {
  settings: AdvancedSettingsData;
  onChange: (settings: AdvancedSettingsData) => void;
}

export default function AdvancedSettingsPanel({ settings, onChange }: Readonly<AdvancedSettingsProps>) {
  return (
    <div className="fd-basic-info">
      <div className="fd-basic-info__inner">
        <Form
          initValues={settings as unknown as Record<string, unknown>}
          labelPosition="left"
          labelWidth={180}
          onValueChange={(values: Record<string, unknown>) => {
            onChange({ ...settings, ...values } as AdvancedSettingsData);
          }}
        >
          <Form.Switch field="allowWithdraw" label="允许撤回" />
          <Form.Switch field="allowResubmit" label="允许驳回后重新提交" />
          <Form.Switch field="notifyInitiator" label="流程结束后通知发起人" />
          <Form.Switch field="autoApproveIfSameUser" label="相同审批人自动通过" />
          <Form.Select field="timeoutAction" label="超时处理" style={{ width: '100%' }} placeholder="请选择超时处理方式">
            <Select.Option value="none">不处理</Select.Option>
            <Select.Option value="auto-approve">自动同意</Select.Option>
            <Select.Option value="auto-reject">自动驳回</Select.Option>
            <Select.Option value="notify">仅提醒</Select.Option>
          </Form.Select>
        </Form>
      </div>
    </div>
  );
}
