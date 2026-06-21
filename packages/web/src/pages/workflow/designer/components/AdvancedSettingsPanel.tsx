/**
 * 更多设置面板 — 步骤 ④ 更多设置
 */
import dayjs from 'dayjs';
import { Divider, Form, Input, InputNumber, Select, Switch, Typography } from '@douyinfe/semi-ui';
import type { WorkflowSerialNoConfig, WorkflowNotifyChannels } from '@zenith/shared';
import type { AdvancedSettingsData } from './advanced-settings';
import { DEFAULT_SERIAL_NO } from './advanced-settings';

export type { AdvancedSettingsData } from './advanced-settings';

interface AdvancedSettingsProps {
  settings: AdvancedSettingsData;
  onChange: (settings: AdvancedSettingsData) => void;
}

export default function AdvancedSettingsPanel({ settings, onChange }: Readonly<AdvancedSettingsProps>) {
  const serialNo: Required<WorkflowSerialNoConfig> = { ...DEFAULT_SERIAL_NO, ...settings.serialNo };

  const updateSerialNo = (patch: Partial<WorkflowSerialNoConfig>) => {
    onChange({ ...settings, serialNo: { ...serialNo, ...patch } });
  };

  const notify: WorkflowNotifyChannels = settings.notifyChannels ?? {};
  const updateNotify = (patch: Partial<WorkflowNotifyChannels>) => {
    onChange({ ...settings, notifyChannels: { ...notify, ...patch } });
  };

  const datePart = serialNo.dateFormat !== 'none' ? dayjs().format(serialNo.dateFormat) : '';
  const seqPart = '1'.padStart(serialNo.seqLength, '0');
  const preview = `${serialNo.prefix}${datePart}${seqPart}`;

  return (
    <div className="fd-basic-info">
      <div className="fd-basic-info__inner">
        <Form
          initValues={settings as unknown as Record<string, unknown>}
          labelPosition="left"
          labelWidth={180}
          onValueChange={(values: Record<string, unknown>) => {
            onChange({ ...settings, ...values });
          }}
        >
          <Form.Switch field="allowWithdraw" label="允许撤回" />
          <Form.Switch field="allowResubmit" label="允许驳回后重新提交" />
          <Form.Switch field="notifyInitiator" label="流程结束后通知发起人" />
          <Form.Switch field="autoApproveIfSameUser" label="相同审批人自动通过" />
          <Form.Switch field="allowComment" label="允许流程中评论" />

          {/* 业务编号 / 流水号 */}
          <Form.Slot>
            <Divider margin="8px 0" />
          </Form.Slot>
          <Form.Slot label="启用业务编号">
            <Switch
              checked={serialNo.enabled}
              onChange={(checked) => updateSerialNo({ enabled: checked })}
            />
          </Form.Slot>

          {serialNo.enabled && (
            <>
              <Form.Slot label="前缀">
                <Input
                  value={serialNo.prefix}
                  placeholder="BX-"
                  style={{ width: '100%' }}
                  onChange={(v) => updateSerialNo({ prefix: v })}
                />
              </Form.Slot>
              <Form.Slot label="日期格式">
                <Select
                  value={serialNo.dateFormat}
                  style={{ width: '100%' }}
                  onChange={(v) => updateSerialNo({ dateFormat: v as WorkflowSerialNoConfig['dateFormat'] })}
                >
                  <Select.Option value="none">无</Select.Option>
                  <Select.Option value="YYYYMMDD">年月日（YYYYMMDD）</Select.Option>
                  <Select.Option value="YYYYMM">年月（YYYYMM）</Select.Option>
                  <Select.Option value="YYYY">年（YYYY）</Select.Option>
                </Select>
              </Form.Slot>
              <Form.Slot label="序号位数">
                <InputNumber
                  value={serialNo.seqLength}
                  min={1}
                  max={12}
                  style={{ width: '100%' }}
                  onChange={(v) => updateSerialNo({ seqLength: typeof v === 'number' ? v : serialNo.seqLength })}
                />
              </Form.Slot>
              <Form.Slot label="重置周期">
                <Select
                  value={serialNo.resetPeriod}
                  style={{ width: '100%' }}
                  onChange={(v) => updateSerialNo({ resetPeriod: v as WorkflowSerialNoConfig['resetPeriod'] })}
                >
                  <Select.Option value="never">不重置</Select.Option>
                  <Select.Option value="daily">每天</Select.Option>
                  <Select.Option value="monthly">每月</Select.Option>
                  <Select.Option value="yearly">每年</Select.Option>
                </Select>
              </Form.Slot>
              <Form.Slot label="编号预览">
                <Typography.Text
                  type="tertiary"
                  style={{ lineHeight: '32px', fontFamily: 'monospace' }}
                >
                  {preview || '（请设置前缀或日期格式）'}
                </Typography.Text>
              </Form.Slot>
            </>
          )}

          {/* 多渠道通知 */}
          <Form.Slot>
            <Divider margin="8px 0" />
          </Form.Slot>
          <Form.Slot label="邮件通知">
            <Switch checked={!!notify.email} onChange={(checked) => updateNotify({ email: checked })} />
          </Form.Slot>
          <Form.Slot label="短信通知">
            <Switch checked={!!notify.sms} onChange={(checked) => updateNotify({ sms: checked })} />
          </Form.Slot>
          {notify.sms && (
            <Form.Slot label="短信模板 ID">
              <InputNumber
                value={notify.smsTemplateId}
                min={1}
                style={{ width: '100%' }}
                placeholder="短信模板库中的模板 ID"
                onChange={(v) => updateNotify({ smsTemplateId: typeof v === 'number' ? v : undefined })}
              />
            </Form.Slot>
          )}
          <Form.Slot>
            <Typography.Text type="tertiary" size="small">
              站内信始终发送；开启后额外向处理人/发起人发送邮件 / 短信（需先在系统中配置邮件服务 / 短信服务商）。
            </Typography.Text>
          </Form.Slot>
        </Form>
      </div>
    </div>
  );
}
