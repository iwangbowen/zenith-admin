/**
 * 更多设置面板 — 步骤 ④ 更多设置
 */
import { useRef } from 'react';
import dayjs from 'dayjs';
import { Button, Divider, Form, Radio, Select, Space, Tag, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ExternalLink, Plus } from 'lucide-react';
import type { WorkflowSerialNoConfig, WorkflowNotifyChannels } from '@zenith/shared/workflow';
import { WORKFLOW_APPROVER_DEDUP_OPTIONS, WORKFLOW_SUMMARY_MAX_FIELDS, isWorkflowSummaryCapableField, resolveApproverDedupMode, renderWorkflowSerialNo, WORKFLOW_SERIAL_DATE_FORMAT_OPTIONS, WORKFLOW_SERIAL_RESET_PERIOD_OPTIONS, WORKFLOW_SERIAL_TOKENS, WORKFLOW_SERIAL_SAMPLE_VARS } from '@zenith/shared/workflow';
import { useWorkflowPrintTemplateOptions } from '@/hooks/queries/report-print';
import { usePermission } from '@/hooks/usePermission';
import type { AdvancedSettingsData } from './advanced-settings';
import { DEFAULT_SERIAL_NO } from './advanced-settings';

export type { AdvancedSettingsData } from './advanced-settings';

interface AdvancedSettingsProps {
  settings: AdvancedSettingsData;
  onChange: (settings: AdvancedSettingsData) => void;
  readOnly?: boolean;
  /** 当前流程可选表单字段（用于列表摘要字段选择） */
  formFields?: Array<{ key: string; label: string; type: string }>;
  /** 审批单打印模板绑定（流程定义列，不在 settings 内）；未保存的新流程为 undefined */
  print?: {
    definitionId: number | null;
    templateId: number | null;
    onTemplateChange: (templateId: number | null) => void;
    /** 按当前表单自动生成一份实体模板并打开打印设计器 */
    onCreateTemplate: () => void;
    creating?: boolean;
  };
}

export default function AdvancedSettingsPanel({ settings, onChange, readOnly = false, formFields = [], print }: Readonly<AdvancedSettingsProps>) {
  const serialNo: Required<WorkflowSerialNoConfig> = { ...DEFAULT_SERIAL_NO, ...settings.serialNo };
  const notify: WorkflowNotifyChannels = settings.notifyChannels ?? {};
  const formApiRef = useRef<FormApi | null>(null);
  const { hasPermission } = usePermission();
  const summaryFieldOptions = formFields
    .filter((f) => f.key && isWorkflowSummaryCapableField(f.type))
    .map((f) => ({ value: f.key, label: f.label || f.key }));
  const printTemplatesQuery = useWorkflowPrintTemplateOptions(print?.definitionId, !!print);
  const printTemplateOptions = (printTemplatesQuery.data?.list ?? []).map((t) => ({
    value: t.id,
    label: t.entityRefId ? t.name : `${t.name}（通用）`,
  }));
  const canManagePrintTemplates = hasPermission('report:print:create') && hasPermission('report:print:update');

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
            print: settings.print ?? {},
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

          {/* 审批单打印 */}
          {print && (
            <>
              <Form.Slot>
                <Divider margin="8px 0" />
              </Form.Slot>
              <Form.Slot label="打印模板">
                <Space style={{ width: '100%' }} align="start">
                  <Select
                    value={print.templateId ?? undefined}
                    onChange={(value) => print.onTemplateChange(value ? Number(value) : null)}
                    optionList={printTemplateOptions}
                    loading={printTemplatesQuery.isPending}
                    placeholder="不绑定：按表单自动生成版式"
                    showClear
                    filter
                    disabled={readOnly}
                    style={{ width: 280 }}
                  />
                  {canManagePrintTemplates && (
                    <Tooltip content={print.definitionId ? '按当前表单生成一份审批单模板并打开打印设计器调整版式' : '请先保存流程'}>
                      <Button
                        icon={<Plus size={14} />}
                        disabled={readOnly || !print.definitionId}
                        loading={print.creating}
                        onClick={print.onCreateTemplate}
                      >
                        新建模板
                      </Button>
                    </Tooltip>
                  )}
                  {print.templateId && canManagePrintTemplates && (
                    <Button
                      theme="borderless"
                      icon={<ExternalLink size={14} />}
                      onClick={() => window.open(`/report/print/${print.templateId}/design`, '_blank', 'noopener')}
                    >
                      打开设计器
                    </Button>
                  )}
                </Space>
              </Form.Slot>
              <Form.Slot>
                <Typography.Text type="tertiary" size="small">
                  模板来自「报表中心 → 打印报表」中实体类型为审批单的模板；不绑定时按表单快照自动排版（栅格 / 分组 / 明细 / 签名 / 审批记录）。
                </Typography.Text>
              </Form.Slot>
              <Form.Switch field="print.onlyWhenApproved" label="仅通过后可打印" extraText="用章 / 合同类流程建议开启，避免打印未生效的单据" />
              <Form.Switch field="print.watermark" label="打印水印" />
              <div style={{ display: settings.print?.watermark ? undefined : 'none' }}>
                <Form.Input
                  field="print.watermarkText"
                  label="水印文本"
                  placeholder="{printer} {time}"
                  maxLength={64}
                  showClear
                  style={{ width: '100%' }}
                  extraText="占位符：{printer} 打印人、{time} 打印时间、{serialNo} 业务编号；留空为「打印人 时间」"
                />
              </div>
            </>
          )}
        </Form>
      </div>
    </div>
  );
}
