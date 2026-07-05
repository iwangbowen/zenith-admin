/**
 * 更多设置面板 — 步骤 ④ 更多设置
 */
import { useRef } from 'react';
import dayjs from 'dayjs';
import { Divider, Form, Radio, Space, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { WorkflowSerialNoConfig, WorkflowNotifyChannels } from '@zenith/shared';
import {
  WORKFLOW_APPROVER_DEDUP_OPTIONS,
  WORKFLOW_SUMMARY_MAX_FIELDS,
  isWorkflowSummaryCapableField,
  resolveApproverDedupMode,
  renderWorkflowSerialNo,
  WORKFLOW_SERIAL_DATE_FORMAT_OPTIONS,
  WORKFLOW_SERIAL_RESET_PERIOD_OPTIONS,
  WORKFLOW_SERIAL_TOKENS,
  WORKFLOW_SERIAL_SAMPLE_VARS,
} from '@zenith/shared';
import type { AdvancedSettingsData } from './advanced-settings';
import { DEFAULT_SERIAL_NO } from './advanced-settings';

export type { AdvancedSettingsData } from './advanced-settings';

interface AdvancedSettingsProps {
  settings: AdvancedSettingsData;
  onChange: (settings: AdvancedSettingsData) => void;
  readOnly?: boolean;
  /** 当前流程可选表单字段（用于列表摘要字段选择） */
  formFields?: Array<{ key: string; label: string; type: string }>;
}

export default function AdvancedSettingsPanel({ settings, onChange, readOnly = false, formFields = [] }: Readonly<AdvancedSettingsProps>) {
  const serialNo: Required<WorkflowSerialNoConfig> = { ...DEFAULT_SERIAL_NO, ...settings.serialNo };
  const notify: WorkflowNotifyChannels = settings.notifyChannels ?? {};
  const formApiRef = useRef<FormApi | null>(null);
  const summaryFieldOptions = formFields
    .filter((f) => f.key && isWorkflowSummaryCapableField(f.type))
    .map((f) => ({ value: f.key, label: f.label || f.key }));

  const preview = renderWorkflowSerialNo(serialNo, {
    ordinal: 1,
    formatDate: (pattern) => dayjs().format(pattern),
    vars: WORKFLOW_SERIAL_SAMPLE_VARS,
    formData: {},
  });

  const insertToken = (token: string) => {
    if (readOnly) return;
    const current = (formApiRef.current?.getValue('serialNo.template') as string | undefined) ?? '';
    formApiRef.current?.setValue('serialNo.template', `${current}${token}`);
  };

  return (
    <div className="fd-basic-info">
      <div className="fd-basic-info__inner">
        <Form
          getFormApi={(api) => { formApiRef.current = api; }}
          initValues={{
            ...settings,
            serialNo: { ...DEFAULT_SERIAL_NO, ...settings.serialNo },
            notifyChannels: settings.notifyChannels ?? {},
            approverDedupMode: resolveApproverDedupMode(settings),
          } as unknown as Record<string, unknown>}
          labelPosition="left"
          labelWidth={180}
          disabled={readOnly}
          onValueChange={(values: Record<string, unknown>) => {
            onChange({ ...settings, ...values });
          }}
        >
          <Form.Switch field="allowWithdraw" label="允许撤回" />
          <Form.Switch field="allowResubmit" label="允许驳回后重新提交" />
          <Form.Switch field="notifyInitiator" label="流程结束后通知发起人" />
          <Form.RadioGroup
            field="approverDedupMode"
            label="自动去重"
            direction="vertical"
            extraText="同一审批人在流程中重复出现时的处理方式"
          >
            {WORKFLOW_APPROVER_DEDUP_OPTIONS.map((o) => (
              <Radio key={o.value} value={o.value}>{o.label}</Radio>
            ))}
          </Form.RadioGroup>
          <Form.Switch field="allowComment" label="允许流程中评论" />
          <Form.Select
            field="summaryFields"
            label="列表摘要字段"
            multiple
            filter
            showClear
            max={WORKFLOW_SUMMARY_MAX_FIELDS}
            placeholder={summaryFieldOptions.length > 0 ? `最多选择 ${WORKFLOW_SUMMARY_MAX_FIELDS} 个字段` : '当前流程无可用表单字段'}
            optionList={summaryFieldOptions}
            style={{ width: '100%' }}
            extraText="待办 / 我的申请列表在标题下直接展示所选字段的值（钉钉式卡片摘要），最多 3 个"
          />

          {/* 业务编号 / 流水号 */}
          <Form.Slot>
            <Divider margin="8px 0" />
          </Form.Slot>
          <Form.Switch field="serialNo.enabled" label="启用业务编号" />

          <div style={{ display: serialNo.enabled ? undefined : 'none' }}>
            <Form.RadioGroup field="serialNo.mode" label="配置模式" type="button">
              <Radio value="structured">结构化</Radio>
              <Radio value="template">自定义模板</Radio>
            </Form.RadioGroup>

            {/* 结构化模式：前缀 + 日期 + 分隔符 + 序号 + 后缀 */}
            <div style={{ display: serialNo.mode === 'template' ? 'none' : undefined }}>
              <Form.Input field="serialNo.prefix" label="前缀" placeholder="BX-" style={{ width: '100%' }} />
              <Form.Select
                field="serialNo.dateFormat"
                label="日期格式"
                style={{ width: '100%' }}
                optionList={WORKFLOW_SERIAL_DATE_FORMAT_OPTIONS}
              />
              <Form.Input
                field="serialNo.separator"
                label="分隔符"
                placeholder="日期与序号之间，如 -"
                style={{ width: '100%' }}
              />
              <Form.Input field="serialNo.suffix" label="后缀" placeholder="可选" style={{ width: '100%' }} />
            </div>

            {/* 自定义模板模式：占位符自由组合 */}
            <div style={{ display: serialNo.mode === 'template' ? undefined : 'none' }}>
              <Form.TextArea
                field="serialNo.template"
                label="编号模板"
                placeholder="如 BX-{YYYYMMDD}-{SEQ:4}"
                autosize={{ minRows: 2, maxRows: 4 }}
                style={{ width: '100%', fontFamily: 'monospace' }}
              />
              <Form.Slot label="可用占位符">
                <Space wrap spacing={4}>
                  {WORKFLOW_SERIAL_TOKENS.map((t) => (
                    <Tooltip key={t.token} content={`${t.label} · 示例 ${t.sample}`}>
                      <Tag
                        color="light-blue"
                        style={{ cursor: readOnly ? 'default' : 'pointer', fontFamily: 'monospace' }}
                        onClick={() => insertToken(t.token)}
                      >
                        {t.token}
                      </Tag>
                    </Tooltip>
                  ))}
                </Space>
              </Form.Slot>
              <Form.Slot>
                <Typography.Text type="tertiary" size="small">
                  点击占位符插入到模板末尾；还支持 {'{FORM.字段名}'} 引用表单字段值。动态变量在预览中以示例值显示。
                </Typography.Text>
              </Form.Slot>
            </div>

            {/* 序号通用配置（结构化与模板 {SEQ} 均生效） */}
            <Form.InputNumber field="serialNo.seqLength" label="序号位数" min={1} max={12} style={{ width: '100%' }} />
            <Form.InputNumber field="serialNo.seqStart" label="序号起始值" min={0} style={{ width: '100%' }} />
            <Form.InputNumber field="serialNo.seqStep" label="序号步长" min={1} style={{ width: '100%' }} />
            <Form.Select
              field="serialNo.resetPeriod"
              label="重置周期"
              style={{ width: '100%' }}
              optionList={WORKFLOW_SERIAL_RESET_PERIOD_OPTIONS}
            />
            <Form.Slot label="编号预览">
              <Typography.Text
                type="tertiary"
                style={{ lineHeight: '32px', fontFamily: 'monospace' }}
              >
                {preview || (serialNo.mode === 'template' ? '（请先编写模板）' : '（请设置前缀或日期格式）')}
              </Typography.Text>
            </Form.Slot>
          </div>

          {/* 多渠道通知 */}
          <Form.Slot>
            <Divider margin="8px 0" />
          </Form.Slot>
          <Form.Switch field="notifyChannels.email" label="邮件通知" />
          <Form.Switch field="notifyChannels.sms" label="短信通知" />
          <div style={{ display: notify.sms ? undefined : 'none' }}>
            <Form.InputNumber field="notifyChannels.smsTemplateId" label="短信模板 ID" min={1} style={{ width: '100%' }} placeholder="短信模板库中的模板 ID" />
          </div>
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
