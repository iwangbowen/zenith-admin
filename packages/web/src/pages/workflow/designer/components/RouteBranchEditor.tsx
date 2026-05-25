/**
 * 路由分支编辑器 — Switch/Case 单字段路由
 *
 * 配置项：
 * - 路由字段（仅 select / radio 类型表单字段；首次配置后保存到父节点 props.routeFieldKey）
 * - 分支名称
 * - 匹配值（来自路由字段的 options；同级已占用值禁用）
 *
 * 默认分支：仅可见名称，不可编辑、不需配置匹配值。
 */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Input, Select, SideSheet, Typography } from '@douyinfe/semi-ui';
import type { FlowBranch, FlowNode } from '../types';

interface FormField {
  key: string;
  label: string;
  type: string;
  options?: string[];
}

export interface RouteBranchEditorUpdates {
  name: string;
  caseValue?: string;
  /** 用户在编辑器中切换了路由字段；非 undefined 时父页应当同步更新父节点 props + 重置兄弟分支 caseValue */
  newRouteFieldKey?: string;
}

interface Props {
  visible: boolean;
  branch: FlowBranch | null;
  parentNode: FlowNode | null;
  formFields: FormField[];
  onSave: (branchId: string, updates: RouteBranchEditorUpdates) => void;
  onCancel: () => void;
}

export default function RouteBranchEditor({
  visible,
  branch,
  parentNode,
  formFields,
  onSave,
  onCancel,
}: Readonly<Props>) {
  const [name, setName] = useState<string>('');
  const [caseValue, setCaseValue] = useState<string>('');
  const [routeFieldKey, setRouteFieldKey] = useState<string>('');
  const [error, setError] = useState<string>('');

  // 可选路由字段：仅 select / radio
  const routableFields = useMemo(
    () => formFields.filter(f => f.type === 'select' || f.type === 'radio'),
    [formFields],
  );

  // 当前选定字段（用于解析 options）
  const currentField = routableFields.find(f => f.key === routeFieldKey);

  // 同级分支已占用的 caseValue（用于禁用重复值）
  const occupiedCaseValues = useMemo(() => {
    if (!parentNode?.branches || !branch) return new Set<string>();
    return new Set(
      parentNode.branches
        .filter((b): b is FlowBranch & { caseValue: string } => b.id !== branch.id && !b.isDefault && !!b.caseValue)
        .map(b => b.caseValue),
    );
  }, [parentNode, branch]);

  useEffect(() => {
    if (!visible) return;
    setName(branch?.name ?? '');
    setCaseValue(branch?.caseValue ?? '');
    setRouteFieldKey((parentNode?.props?.routeFieldKey as string | undefined) ?? '');
    setError('');
  }, [branch?.id, visible, parentNode?.id, parentNode?.props?.routeFieldKey]);

  const originalRouteFieldKey = (parentNode?.props?.routeFieldKey as string | undefined) ?? '';
  const isDefault = !!branch?.isDefault;

  const handleRouteFieldChange = (v: string) => {
    setRouteFieldKey(v);
    // 切换字段时清空当前 case 值（兄弟分支由父页统一重置）
    setCaseValue('');
  };

  const handleSave = () => {
    if (!branch) return;
    const trimmedName = name.trim() || branch.name;
    const updates: RouteBranchEditorUpdates = { name: trimmedName };

    if (routeFieldKey !== originalRouteFieldKey) {
      updates.newRouteFieldKey = routeFieldKey;
    }

    if (!isDefault) {
      if (!routeFieldKey) {
        setError('请先选择路由字段');
        return;
      }
      const trimmedCase = caseValue.trim();
      if (!trimmedCase) {
        setError('请选择匹配值');
        return;
      }
      if (occupiedCaseValues.has(trimmedCase)) {
        setError('该匹配值已被其他分支占用');
        return;
      }
      updates.caseValue = trimmedCase;
    }
    setError('');
    onSave(branch.id, updates);
  };

  const fieldOptions = routableFields.map(f => ({ value: f.key, label: f.label }));
  const valueOptions = (currentField?.options ?? []).map(o => ({
    value: o,
    label: o,
    disabled: occupiedCaseValues.has(o),
  }));

  return (
    <SideSheet
      title={`路由分支 — ${branch?.name ?? ''}`}
      visible={visible}
      onCancel={onCancel}
      placement="right"
      width={520}
      className="fd-config-drawer"
      footer={
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, padding: '12px 0' }}>
          <button type="button" className="fd-drawer-btn fd-drawer-btn--cancel" onClick={onCancel}>取消</button>
          <button type="button" className="fd-drawer-btn fd-drawer-btn--save" onClick={handleSave}>保存</button>
        </div>
      }
    >
      {isDefault ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--semi-color-text-2)' }}>
          <Typography.Title heading={6}>默认分支</Typography.Title>
          <Typography.Text type="tertiary">
            未命中其它分支的匹配值时，将进入此分支，无需配置。
          </Typography.Text>
        </div>
      ) : (
        <div className="fd-condition-editor">
          {routableFields.length === 0 && (
            <Banner
              type="warning"
              description="表单中没有可作为路由键的字段（仅支持 select / radio 类型）。请先到「表单设计」步骤添加该类型字段。"
              style={{ marginBottom: 12 }}
              closeIcon={null}
            />
          )}

          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>路由字段</Typography.Text>
            <Select
              value={routeFieldKey || undefined}
              onChange={(v) => handleRouteFieldChange(v as string)}
              optionList={fieldOptions}
              placeholder="选择 select / radio 类型字段"
              style={{ width: '100%' }}
              emptyContent="暂无可用字段"
              disabled={routableFields.length === 0}
            />
            {routeFieldKey !== originalRouteFieldKey && originalRouteFieldKey && (
              <Typography.Text type="warning" size="small" style={{ display: 'block', marginTop: 6 }}>
                切换路由字段后，本节点下其它分支的匹配值将被清空。
              </Typography.Text>
            )}
          </div>

          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>分支名称</Typography.Text>
            <Input
              value={name}
              onChange={setName}
              placeholder="请输入分支名称"
              maxLength={20}
              showClear
            />
          </div>

          <div style={{ marginBottom: 16 }}>
            <Typography.Text strong style={{ display: 'block', marginBottom: 6 }}>匹配值</Typography.Text>
            <Select
              value={caseValue || undefined}
              onChange={(v) => setCaseValue(v as string)}
              optionList={valueOptions}
              placeholder={routeFieldKey ? '选择匹配值' : '请先选择路由字段'}
              style={{ width: '100%' }}
              emptyContent={routeFieldKey ? '当前字段无选项' : '请先选择路由字段'}
              disabled={!routeFieldKey || valueOptions.length === 0}
            />
          </div>

          {error && (
            <Banner type="danger" description={error} closeIcon={null} style={{ marginTop: 8 }} />
          )}
        </div>
      )}
    </SideSheet>
  );
}
