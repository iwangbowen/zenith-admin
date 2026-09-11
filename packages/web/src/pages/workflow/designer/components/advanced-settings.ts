import type { WorkflowSerialNoConfig, WorkflowNotifyChannels, WorkflowApproverDedupMode, WorkflowPrintSettings } from '@zenith/shared/workflow';

export interface AdvancedSettingsData {
  allowWithdraw: boolean;
  allowResubmit: boolean;
  notifyInitiator: boolean;
  /** 流程级「自动去重」模式（同一审批人在流程中重复出现时的处理方式） */
  approverDedupMode?: WorkflowApproverDedupMode;
  allowComment?: boolean;
  /** 待办/列表摘要字段（≤3 个表单字段 key） */
  summaryFields?: string[];
  serialNo?: WorkflowSerialNoConfig;
  notifyChannels?: WorkflowNotifyChannels;
  /** 审批单打印限制与水印（模板绑定在流程定义列 printTemplateId） */
  print?: WorkflowPrintSettings;
}

export const DEFAULT_SERIAL_NO: Required<WorkflowSerialNoConfig> = {
  enabled: false,
  mode: 'structured',
  prefix: '',
  suffix: '',
  separator: '',
  dateFormat: 'none',
  seqLength: 4,
  seqStart: 1,
  seqStep: 1,
  template: '',
  resetPeriod: 'never',
};

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettingsData = {
  allowWithdraw: true,
  allowResubmit: true,
  notifyInitiator: true,
  approverDedupMode: 'all',
  allowComment: true,
  serialNo: { ...DEFAULT_SERIAL_NO },
};
