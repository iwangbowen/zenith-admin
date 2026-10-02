import type { ActionButtonConfig, ActionButtonKey, ActionButtonsConfig, ActionUploadMode } from './types';

export interface ActionButtonMeta {
  key: ActionButtonKey;
  label: string;
  defaultDisplayName: string;
  defaultOpinionName: string;
  supportsJump: boolean;
  defaultEnabled: boolean;
}

export const ACTION_BUTTON_META: ActionButtonMeta[] = [
  { key: 'approve',  label: '通过', defaultDisplayName: '通过', defaultOpinionName: '通过', supportsJump: false, defaultEnabled: true },
  { key: 'reject',   label: '拒绝', defaultDisplayName: '拒绝', defaultOpinionName: '拒绝', supportsJump: true,  defaultEnabled: true },
  { key: 'transfer', label: '转办', defaultDisplayName: '转办', defaultOpinionName: '转办', supportsJump: false, defaultEnabled: true },
  { key: 'delegate', label: '委派', defaultDisplayName: '委派', defaultOpinionName: '委派', supportsJump: false, defaultEnabled: true },
  { key: 'addSign',  label: '加签', defaultDisplayName: '加签', defaultOpinionName: '加签', supportsJump: false, defaultEnabled: true },
  { key: 'reduceSign', label: '减签', defaultDisplayName: '减签', defaultOpinionName: '减签说明', supportsJump: false, defaultEnabled: false },
  { key: 'return',   label: '退回', defaultDisplayName: '退回', defaultOpinionName: '退回', supportsJump: true,  defaultEnabled: true },
];

const UPLOAD_MODES = new Set<ActionUploadMode>(['hidden', 'optional', 'required']);

function normalizeUploadMode(value: unknown): ActionUploadMode | undefined {
  return typeof value === 'string' && UPLOAD_MODES.has(value as ActionUploadMode)
    ? value as ActionUploadMode
    : undefined;
}

function normalizeSingleButton(
  input: ActionButtonConfig | undefined,
  meta: ActionButtonMeta,
): ActionButtonConfig {
  const button: ActionButtonConfig = {
    enabled: input?.enabled ?? meta.defaultEnabled,
    displayName: input?.displayName?.trim() || meta.defaultDisplayName,
    opinionName: input?.opinionName?.trim() || meta.defaultOpinionName,
    uploadMode: normalizeUploadMode(input?.uploadMode) ?? 'hidden',
  };
  if (meta.supportsJump && input?.jumpToNodeKey?.trim()) button.jumpToNodeKey = input.jumpToNodeKey.trim();
  return button;
}

export function getActionButtonConfig(
  value: ActionButtonsConfig | undefined,
  meta: ActionButtonMeta,
): ActionButtonConfig {
  return normalizeSingleButton(value?.[meta.key], meta);
}

export function normalizeActionButtons(value: ActionButtonsConfig | undefined): ActionButtonsConfig {
  return ACTION_BUTTON_META.reduce<ActionButtonsConfig>((acc, meta) => {
    acc[meta.key] = normalizeSingleButton(value?.[meta.key], meta);
    return acc;
  }, {});
}
