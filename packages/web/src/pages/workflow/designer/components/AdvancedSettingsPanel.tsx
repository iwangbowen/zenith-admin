/**
 * 更多设置面板 — 步骤 ④ 更多设置
 */
import { useRef } from 'react';
import { Button, Divider, Form, Radio, Select, Space, Tooltip, Typography } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ExternalLink, Plus } from 'lucide-react';
import type { WorkflowDesignPolicy, WorkflowFormField, WorkflowNotifyChannels } from '@zenith/shared/workflow';
import { WORKFLOW_APPROVER_DEDUP_OPTIONS, WORKFLOW_SUMMARY_MAX_FIELDS, isWorkflowSummaryCapableField, resolveApproverDedupMode } from '@zenith/shared/workflow';
import { useWorkflowPrintTemplateOptions } from '@/hooks/queries/report-print';
import { usePermission } from '@/hooks/usePermission';
import type { AdvancedSettingsData } from './advanced-settings';
import { WorkflowNumberingSettings } from './WorkflowNumberingSettings';

export type { AdvancedSettingsData } from './advanced-settings';

interface AdvancedSettingsProps {
  settings: AdvancedSettingsData;
  onChange: (settings: AdvancedSettingsData) => void;
  readOnly?: boolean;
  lockedSettings?: Readonly<WorkflowDesignPolicy['lockedSettings']>;
  /** 当前流程可选表单字段（用于列表摘要字段选择） */
  formFields?: Array<{ key: string; label: string; type: string }>;
  numberingFields?: WorkflowFormField[];
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

export default function AdvancedSettingsPanel({ settings, onChange, readOnly = false, lockedSettings = [], formFields = [], numberingFields = [], print }: Readonly<AdvancedSettingsProps>) {
  const notify: WorkflowNotifyChannels = settings.notifyChannels ?? {};
  // useEditModal 例外：工作流设计器面板（高级设置随设计器整体保存，值经 onChange 回写）
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

  return (
    <div className="fd-basic-info">
      <div className="fd-basic-info__inner">
        {lockedSettings.length > 0 && <Typography.Paragraph type="tertiary" size="small">灰色配置由业务策略固定，不支持在设计器中修改。</Typography.Paragraph>}
        <Form
          getFormApi={(api) => { formApiRef.current = api; }}
          initValues={{
            ...settings,
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
          <Form.Switch field="allowWithdraw" label="允许撤回" disabled={readOnly || lockedSettings.includes('allowWithdraw')} />
          <Form.Switch field="allowResubmit" label="允许驳回后重新提交" disabled={readOnly || lockedSettings.includes('allowResubmit')} />
          <Form.Switch field="notifyInitiator" label="流程结束后通知发起人" disabled={readOnly || lockedSettings.includes('notifyInitiator')} />
          <Form.RadioGroup
            field="approverDedupMode"
            disabled={readOnly || lockedSettings.includes('approverDedupMode')}
            label="自动去重"
            direction="vertical"
            extraText="同一审批人在流程中重复出现时的处理方式"
          >
            {WORKFLOW_APPROVER_DEDUP_OPTIONS.map((o) => (
              <Radio key={o.value} value={o.value}>{o.label}</Radio>
            ))}
          </Form.RadioGroup>
          <Form.Switch field="allowComment" label="允许流程中评论" />
          {/* 摘要按选择顺序展示且最多三项，保留全部标签便于核对顺序。 */}
          <Form.Select
            field="summaryFields"
            disabled={readOnly || lockedSettings.includes('summaryFields')}
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
          <WorkflowNumberingSettings value={settings.numbering} formFields={numberingFields} readOnly={readOnly}
            onChange={value => formApiRef.current?.setValue('numbering', value)} />

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
                <Space wrap style={{ width: '100%' }} align="start">
                  <Select
                    value={print.templateId ?? undefined}
                    onChange={(value) => print.onTemplateChange(value ? Number(value) : null)}
                    optionList={printTemplateOptions}
                    loading={printTemplatesQuery.isPending}
                    placeholder="不绑定：按表单自动生成版式"
                    showClear
                    filter
                    disabled={readOnly}
                    style={{ width: '100%' }}
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
              <Form.Switch
                field="print.autoArchive"
                label="办结自动归档"
                extraText="流程通过 / 驳回后由后台生成一份不可变的 PDF 存证（记录 SHA-256），之后打印默认返回归档原件，不再随模板或数据变化"
              />
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
