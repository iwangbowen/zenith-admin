/**
 * 操作按钮设置 Tab — 表格化配置审批节点支持的动作按钮
 *
 * 按钮：通过 / 拒绝 / 转办 / 委派 / 加签 / 退回
 * 每行可配置：显示名称、意见名称、跳转配置（仅 reject/return）、上传配置、启用
 */
import { useState } from 'react';
import { Switch, Popover, Input, Button, Select, Empty } from '@douyinfe/semi-ui';
import { Pencil } from 'lucide-react';
import type { ActionButtonKey, ActionButtonConfig, ActionButtonsConfig, FlowNodeType } from '../../types';

interface JumpTargetNode {
  id: string;
  key?: string;
  name: string;
  type: FlowNodeType;
}

interface ActionButtonsTabProps {
  value: ActionButtonsConfig | undefined;
  onChange: (next: ActionButtonsConfig) => void;
  /** "跳转配置" 下拉的候选节点（可退回的前序节点） */
  jumpTargetNodes?: JumpTargetNode[];
}

interface ButtonMeta {
  key: ActionButtonKey;
  label: string;
  defaultDisplayName: string;
  defaultOpinionName: string;
  /** 是否支持跳转配置（仅 reject / return） */
  supportsJump: boolean;
  /** 是否默认启用 */
  defaultEnabled: boolean;
}

const BUTTON_META: ButtonMeta[] = [
  { key: 'approve',  label: '通过', defaultDisplayName: '通过', defaultOpinionName: '通过', supportsJump: false, defaultEnabled: true },
  { key: 'reject',   label: '拒绝', defaultDisplayName: '拒绝', defaultOpinionName: '拒绝', supportsJump: true,  defaultEnabled: true },
  { key: 'transfer', label: '转办', defaultDisplayName: '转办', defaultOpinionName: '转办', supportsJump: false, defaultEnabled: true },
  { key: 'delegate', label: '委派', defaultDisplayName: '委派', defaultOpinionName: '委派', supportsJump: false, defaultEnabled: true },
  { key: 'addSign',  label: '加签', defaultDisplayName: '加签', defaultOpinionName: '加签', supportsJump: false, defaultEnabled: true },
  { key: 'return',   label: '退回', defaultDisplayName: '退回', defaultOpinionName: '退回', supportsJump: true,  defaultEnabled: true },
];

function getConfig(value: ActionButtonsConfig | undefined, meta: ButtonMeta): ActionButtonConfig {
  return value?.[meta.key] ?? { enabled: meta.defaultEnabled };
}

/** 内联可编辑文字单元格：默认显示文字 + 编辑图标，点击弹出 Popover 输入框 */
function EditableTextCell({
  value,
  placeholder,
  onChange,
  disabled,
}: Readonly<{
  value: string;
  placeholder: string;
  onChange: (v: string) => void;
  disabled?: boolean;
}>) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(value);

  const handleVisibleChange = (v: boolean) => {
    if (v) setDraft(value);
    setOpen(v);
  };

  const handleConfirm = () => {
    onChange(draft.trim());
    setOpen(false);
  };

  return (
    <Popover
      visible={open}
      onVisibleChange={handleVisibleChange}
      trigger="click"
      position="bottom"
      content={
        <div style={{ padding: 8, width: 200, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Input
            value={draft}
            onChange={setDraft}
            placeholder={placeholder}
            maxLength={32}
            autoFocus
            onEnterPress={handleConfirm}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }}>
            <Button size="small" onClick={() => setOpen(false)}>取消</Button>
            <Button size="small" type="primary" onClick={handleConfirm}>确定</Button>
          </div>
        </div>
      }
    >
      <button
        type="button"
        disabled={disabled}
        style={{
          background: 'none',
          border: 'none',
          padding: 0,
          cursor: disabled ? 'not-allowed' : 'pointer',
          color: disabled ? 'var(--semi-color-text-2)' : 'var(--semi-color-text-0)',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          fontSize: 13,
        }}
      >
        <span>{value || placeholder}</span>
        {!disabled && <Pencil size={12} style={{ color: 'var(--semi-color-text-2)' }} />}
      </button>
    </Popover>
  );
}

export default function ActionButtonsTab({
  value,
  onChange,
  jumpTargetNodes = [],
}: Readonly<ActionButtonsTabProps>) {

  const updateButton = (key: ActionButtonKey, patch: Partial<ActionButtonConfig>) => {
    const meta = BUTTON_META.find(m => m.key === key);
    const current = value?.[key] ?? { enabled: meta?.defaultEnabled ?? true };
    onChange({
      ...(value ?? {}),
      [key]: { ...current, ...patch },
    });
  };

  const jumpOptions = jumpTargetNodes.map(n => ({
    value: n.key ?? n.id,
    label: n.name || n.key || n.id,
  }));

  return (
    <div className="fd-drawer-tab-content">
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>操作按钮</div>
      <table className="fd-action-button-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
            <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 500, color: 'var(--semi-color-text-2)', width: 64, whiteSpace: 'nowrap' }}>操作按钮</th>
            <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 500, color: 'var(--semi-color-text-2)', width: 96, whiteSpace: 'nowrap' }}>显示名称</th>
            <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 500, color: 'var(--semi-color-text-2)', width: 96, whiteSpace: 'nowrap' }}>意见名称</th>
            <th style={{ textAlign: 'left', padding: '10px 8px', fontWeight: 500, color: 'var(--semi-color-text-2)', width: 120, whiteSpace: 'nowrap' }}>跳转配置</th>
            <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 500, color: 'var(--semi-color-text-2)', width: 64, whiteSpace: 'nowrap' }}>上传配置</th>
            <th style={{ textAlign: 'center', padding: '10px 8px', fontWeight: 500, color: 'var(--semi-color-text-2)', width: 48, whiteSpace: 'nowrap' }}>启用</th>
          </tr>
        </thead>
        <tbody>
          {BUTTON_META.map(meta => {
            const cfg = getConfig(value, meta);
            const disabled = !cfg.enabled;
            // approve / reject 不允许整体关闭（流程必须可决策）
            const lockEnabled = meta.key === 'approve' || meta.key === 'reject';
            return (
              <tr key={meta.key} style={{ borderBottom: '1px solid var(--semi-color-border)' }}>
                <td style={{ padding: '10px 8px', color: 'var(--semi-color-text-0)', whiteSpace: 'nowrap' }}>{meta.label}</td>
                <td style={{ padding: '10px 8px' }}>
                  <EditableTextCell
                    value={cfg.displayName ?? meta.defaultDisplayName}
                    placeholder={meta.defaultDisplayName}
                    disabled={disabled}
                    onChange={(v) => updateButton(meta.key, { displayName: v || undefined })}
                  />
                </td>
                <td style={{ padding: '10px 8px' }}>
                  <EditableTextCell
                    value={cfg.opinionName ?? meta.defaultOpinionName}
                    placeholder={meta.defaultOpinionName}
                    disabled={disabled}
                    onChange={(v) => updateButton(meta.key, { opinionName: v || undefined })}
                  />
                </td>
                <td style={{ padding: '10px 8px' }}>
                  {meta.supportsJump ? (
                    jumpOptions.length > 0 ? (
                      <Select
                        size="small"
                        placeholder="默认策略"
                        value={cfg.jumpToNodeKey}
                        onChange={(v) => updateButton(meta.key, { jumpToNodeKey: (v as string) || undefined })}
                        optionList={jumpOptions}
                        showClear
                        disabled={disabled}
                        style={{ width: '100%' }}
                      />
                    ) : (
                      <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>
                    )
                  ) : (
                    <Switch size="small" disabled checked={false} />
                  )}
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <Switch
                    size="small"
                    checked={!!cfg.uploadRequired}
                    disabled={disabled}
                    onChange={(v) => updateButton(meta.key, { uploadRequired: v })}
                  />
                </td>
                <td style={{ padding: '10px 8px', textAlign: 'center' }}>
                  <Switch
                    size="small"
                    checked={cfg.enabled}
                    disabled={lockEnabled}
                    onChange={(v) => updateButton(meta.key, { enabled: v })}
                  />
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {jumpTargetNodes.length === 0 && (
        <div style={{ marginTop: 12, color: 'var(--semi-color-text-2)', fontSize: 12 }}>
          <Empty
            description={'当前节点之前没有可退回的审批/办理节点；如需"跳转配置"，请在流程中添加前序节点'}
            style={{ padding: 12 }}
          />
        </div>
      )}
    </div>
  );
}
