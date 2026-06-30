/**
 * 操作按钮设置 Tab — 表格化配置审批节点支持的动作按钮
 *
 * 按钮：通过 / 拒绝 / 转办 / 委派 / 加签 / 退回
 * 每行可配置：显示名称、意见名称、跳转配置（仅 reject/return）、附件、启用
 */
import { useState } from 'react';
import { Switch, Popover, Input, Button, Select, Empty } from '@douyinfe/semi-ui';
import { Pencil } from 'lucide-react';
import type { ActionButtonKey, ActionButtonConfig, ActionButtonsConfig, ActionUploadMode, FlowNodeType } from '../../types';
import { ACTION_BUTTON_META, getActionButtonConfig, normalizeActionButtons } from '../../action-buttons';

const UPLOAD_MODE_OPTIONS: Array<{ value: ActionUploadMode; label: string }> = [
  { value: 'hidden', label: '不显示' },
  { value: 'optional', label: '选填' },
  { value: 'required', label: '必填' },
];

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
          maxWidth: '100%',
        }}
      >
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{value || placeholder}</span>
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
    const meta = ACTION_BUTTON_META.find(m => m.key === key);
    if (!meta) return;
    const current = getActionButtonConfig(value, meta);
    onChange(normalizeActionButtons({
      ...(value ?? {}),
      [key]: { ...current, ...patch },
    }));
  };

  const jumpOptions = jumpTargetNodes.map(n => ({
    value: n.key ?? n.id,
    label: n.name || n.key || n.id,
  }));

  return (
    <div className="fd-drawer-tab-content">
      <div style={{ fontWeight: 600, fontSize: 14, marginBottom: 12 }}>操作按钮</div>
      <div className="fd-action-button-table-wrap">
        <table className="fd-action-button-table">
          <thead>
            <tr>
              <th className="fd-action-button-table__action">操作按钮</th>
              <th className="fd-action-button-table__text">显示名称</th>
              <th className="fd-action-button-table__text">意见名称</th>
              <th className="fd-action-button-table__jump">跳转配置</th>
              <th className="fd-action-button-table__upload">附件</th>
              <th className="fd-action-button-table__enabled">启用</th>
            </tr>
          </thead>
          <tbody>
            {ACTION_BUTTON_META.map(meta => {
              const cfg = getActionButtonConfig(value, meta);
              const disabled = !cfg.enabled;
              // approve / reject 不允许整体关闭（流程必须可决策）
              const lockEnabled = meta.key === 'approve' || meta.key === 'reject';
              return (
                <tr key={meta.key}>
                  <td className="fd-action-button-table__cell fd-action-button-table__action">{meta.label}</td>
                  <td className="fd-action-button-table__cell">
                    <EditableTextCell
                      value={cfg.displayName ?? meta.defaultDisplayName}
                      placeholder={meta.defaultDisplayName}
                      disabled={disabled}
                      onChange={(v) => updateButton(meta.key, { displayName: v || undefined })}
                    />
                  </td>
                  <td className="fd-action-button-table__cell">
                    <EditableTextCell
                      value={cfg.opinionName ?? meta.defaultOpinionName}
                      placeholder={meta.defaultOpinionName}
                      disabled={disabled}
                      onChange={(v) => updateButton(meta.key, { opinionName: v || undefined })}
                    />
                  </td>
                  <td className="fd-action-button-table__cell">
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
                      <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>
                    )}
                  </td>
                  <td className="fd-action-button-table__cell fd-action-button-table__upload">
                    <Select
                      size="small"
                      value={cfg.uploadMode ?? 'hidden'}
                      disabled={disabled}
                      onChange={(v) => updateButton(meta.key, { uploadMode: v as ActionUploadMode })}
                      optionList={UPLOAD_MODE_OPTIONS}
                      style={{ width: '100%' }}
                    />
                  </td>
                  <td className="fd-action-button-table__cell fd-action-button-table__enabled">
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
      </div>
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
