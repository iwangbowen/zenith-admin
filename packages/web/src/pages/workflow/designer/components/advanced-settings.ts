import type { WorkflowSerialNoConfig, WorkflowNotifyChannels } from '@zenith/shared';

export interface AdvancedSettingsData {
  allowWithdraw: boolean;
  allowResubmit: boolean;
  notifyInitiator: boolean;
  autoApproveIfSameUser: boolean;
  allowComment?: boolean;
  serialNo?: WorkflowSerialNoConfig;
  notifyChannels?: WorkflowNotifyChannels;
}

export const DEFAULT_SERIAL_NO: Required<WorkflowSerialNoConfig> = {
  enabled: false,
  prefix: '',
  dateFormat: 'none',
  seqLength: 4,
  resetPeriod: 'never',
};

export const DEFAULT_ADVANCED_SETTINGS: AdvancedSettingsData = {
  allowWithdraw: true,
  allowResubmit: true,
  notifyInitiator: true,
  autoApproveIfSameUser: false,
  allowComment: true,
  serialNo: { ...DEFAULT_SERIAL_NO },
};
