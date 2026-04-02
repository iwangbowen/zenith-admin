/**
 * 条件规则编辑器 — 可视化配置分支条件
 *
 * 支持：
 * - 多条件组（AND/OR 逻辑切换）
 * - 条件字段从流程表单字段动态生成
 * - 运算符选择 + 值输入
 */
import { useEffect, useState } from 'react';
import { Button, Input, Select, SideSheet, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { ConditionGroup, ConditionRule, ConditionOperator, FlowBranch } from '../types';
import { OPERATOR_LABELS } from '../constants';

interface FormField {
  key: string;
  label: string;
  type: string;
  options?: string[];
}

interface ConditionEditorProps {
  visible: boolean;
  branch: FlowBranch | null;
  formFields: FormField[];
  onSave: (branchId: string, conditions: ConditionGroup[]) => void;
  onCancel: () => void;
}

const operatorOptions = Object.entries(OPERATOR_LABELS).map(([value, label]) => ({ value, label }));

const EMPTY_RULE: ConditionRule = { field: '', operator: 'eq', value: '' };
const DEFAULT_GROUP: ConditionGroup = { type: 'and', rules: [{ ...EMPTY_RULE }] };

let ruleKeyCounter = 0;
function nextRuleKey() {
  return `rule-${++ruleKeyCounter}`;
}
let groupKeyCounter = 0;
function nextGroupKey() {
  return `group-${++groupKeyCounter}`;
}

function initGroups(branch: FlowBranch | null): ConditionGroup[] {
  if (branch?.conditions?.length) return structuredClone(branch.conditions);
  return [{ ...DEFAULT_GROUP, rules: [{ ...EMPTY_RULE }] }];
}

/** 顶层函数：替换指定 group 中的某条 rule（减少嵌套层级） */
function replaceRuleInGroup(group: ConditionGroup, ruleIndex: number, updates: Partial<ConditionRule>): ConditionGroup {
  const newRules = group.rules.map((r, ri) =>
    ri === ruleIndex ? { ...r, ...updates } : r
  );
  return { ...group, rules: newRules };
}

/** 顶层函数：移除指定 group 中的某条 rule */
function removeRuleFromGroup(group: ConditionGroup, ruleIndex: number): ConditionGroup {
  const newRules = group.rules.filter((_, ri) => ri !== ruleIndex);
  return { ...group, rules: newRules.length > 0 ? newRules : [{ ...EMPTY_RULE }] };
}

/** 顶层函数：按 index 移除数组项 */
function filterByIndex<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

export default function ConditionEditor({
  visible,
  branch,
  formFields,
  onSave,
  onCancel,
}: Readonly<ConditionEditorProps>) {
  const [groups, setGroups] = useState<ConditionGroup[]>(() => initGroups(branch));
  const [groupKeys, setGroupKeys] = useState<string[]>(() => initGroups(branch).map(() => nextGroupKey()));
  const [ruleKeys, setRuleKeys] = useState<string[][]>(() =>
    initGroups(branch).map(g => g.rules.map(() => nextRuleKey()))
  );

  // 当 branch 变化时重新初始化
  useEffect(() => {
    const g = initGroups(branch);
    setGroups(g);
    setGroupKeys(g.map(() => nextGroupKey()));
    setRuleKeys(g.map(gr => gr.rules.map(() => nextRuleKey())));
  }, [branch?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleGroupTypeToggle = (groupIndex: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? { ...g, type: g.type === 'and' ? 'or' : 'and' } : g
    ));
  };

  const handleAddRule = (groupIndex: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? { ...g, rules: [...g.rules, { ...EMPTY_RULE }] } : g
    ));
    setRuleKeys(prev => prev.map((keys, i) =>
      i === groupIndex ? [...keys, nextRuleKey()] : keys
    ));
  };

  const handleRemoveRule = (groupIndex: number, ruleIndex: number) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? removeRuleFromGroup(g, ruleIndex) : g
    ));
    setRuleKeys(prev => prev.map((keys, i) =>
      i === groupIndex ? filterByIndex(keys, ruleIndex) : keys
    ));
  };

  const updateRule = (groupIndex: number, ruleIndex: number, updates: Partial<ConditionRule>) => {
    setGroups(prev => prev.map((g, i) =>
      i === groupIndex ? replaceRuleInGroup(g, ruleIndex, updates) : g
    ));
  };

  const handleAddGroup = () => {
    setGroups(prev => [...prev, { ...DEFAULT_GROUP, rules: [{ ...EMPTY_RULE }] }]);
    setGroupKeys(prev => [...prev, nextGroupKey()]);
    setRuleKeys(prev => [...prev, [nextRuleKey()]]);
  };

  const handleRemoveGroup = (groupIndex: number) => {
    setGroups(prev => {
      const updated = prev.filter((_, i) => i !== groupIndex);
      return updated.length > 0 ? updated : [{ ...DEFAULT_GROUP, rules: [{ ...EMPTY_RULE }] }];
    });
    setGroupKeys(prev => {
      const updated = prev.filter((_, i) => i !== groupIndex);
      return updated.length > 0 ? updated : [nextGroupKey()];
    });
    setRuleKeys(prev => {
      const updated = prev.filter((_, i) => i !== groupIndex);
      return updated.length > 0 ? updated : [[nextRuleKey()]];
    });
  };

  const handleSave = () => {
    if (!branch) return;
    // 过滤掉空条件
    const cleaned = groups
      .map(g => ({
        ...g,
        rules: g.rules.filter(r => r.field !== ''),
      }))
      .filter(g => g.rules.length > 0);
    onSave(branch.id, cleaned);
  };

  const fieldOptions = formFields.map(f => ({ value: f.key, label: f.label }));

  return (
    <SideSheet
      title={`条件配置 — ${branch?.name ?? ''}`}
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
      {branch?.isDefault ? (
        <div style={{ textAlign: 'center', padding: '40px 0', color: 'var(--semi-color-text-2)' }}>
          <Typography.Title heading={6}>默认分支</Typography.Title>
          <Typography.Text type="tertiary">
            当其他分支条件都不满足时，将进入此分支，无需配置条件。
          </Typography.Text>
        </div>
      ) : (
        <div className="fd-condition-editor">
          {groups.map((group, gi) => (
            <div key={groupKeys[gi]} className="fd-condition-group">
              {/* 条件组头部 */}
              <div className="fd-condition-group__header">
                <button
                  type="button"
                  className="fd-condition-logic-btn"
                  onClick={() => handleGroupTypeToggle(gi)}
                >
                  {group.type === 'and' ? '且 (AND)' : '或 (OR)'}
                </button>
                {groups.length > 1 && (
                  <button
                    type="button"
                    className="fd-condition-remove-group"
                    onClick={() => handleRemoveGroup(gi)}
                    title="删除条件组"
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>

              {/* 条件规则列表 */}
              {group.rules.map((rule, ri) => (
                <div key={ruleKeys[gi]?.[ri] ?? ri} className="fd-condition-rule">
                  <Select
                    value={rule.field || undefined}
                    onChange={(v) => updateRule(gi, ri, { field: v as string })}
                    placeholder="选择字段"
                    optionList={fieldOptions}
                    style={{ width: 140 }}
                    size="small"
                    emptyContent="暂无表单字段"
                  />
                  <Select
                    value={rule.operator}
                    onChange={(v) => updateRule(gi, ri, { operator: v as ConditionOperator })}
                    optionList={operatorOptions}
                    style={{ width: 100 }}
                    size="small"
                  />
                  {renderValueInput(rule, formFields, (v) => updateRule(gi, ri, { value: v }))}
                  <button
                    type="button"
                    className="fd-condition-rule__remove"
                    onClick={() => handleRemoveRule(gi, ri)}
                    title="删除条件"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}

              {/* 添加条件按钮 */}
              <Button
                type="tertiary"
                size="small"
                icon={<Plus size={12} />}
                onClick={() => handleAddRule(gi)}
                style={{ marginTop: 8 }}
              >
                添加条件
              </Button>
            </div>
          ))}

          {/* 添加条件组 */}
          <Button
            type="secondary"
            size="small"
            icon={<Plus size={12} />}
            onClick={handleAddGroup}
            style={{ marginTop: 12 }}
            block
          >
            添加条件组
          </Button>
        </div>
      )}
    </SideSheet>
  );
}

/** 根据字段类型渲染值输入组件 */
function renderValueInput(
  rule: ConditionRule,
  formFields: FormField[],
  onChange: (value: string | number | boolean) => void,
) {
  const field = formFields.find(f => f.key === rule.field);

  if (field?.type === 'select' && field.options) {
    return (
      <Select
        value={rule.value as string}
        onChange={(v) => onChange(v as string)}
        optionList={field.options.map(o => ({ value: o, label: o }))}
        style={{ width: 140 }}
        size="small"
        placeholder="选择值"
      />
    );
  }

  if (field?.type === 'number') {
    return (
      <Input
        value={String(rule.value ?? '')}
        onChange={(v) => onChange(Number(v) || 0)}
        placeholder="输入数值"
        style={{ width: 140 }}
        size="small"
        type="number"
      />
    );
  }

  return (
    <Input
      value={String(rule.value ?? '')}
      onChange={(v) => onChange(v)}
      placeholder="输入值"
      style={{ width: 140 }}
      size="small"
    />
  );
}
