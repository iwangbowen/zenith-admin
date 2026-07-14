/**
 * 大纲树 — 表单字段结构导航
 * 展示字段嵌套层级（分栏列/分组/标签页/分步/明细子字段），点击选中并定位画布。
 */
import { useMemo } from 'react';
import { Tree, Typography } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import type { WorkflowFormField } from '@zenith/shared';
import { FORM_FIELD_TYPES } from '../form-types';

interface FormOutlineProps {
  fields: WorkflowFormField[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
}

function nodeLabel(field: WorkflowFormField): React.ReactNode {
  const info = FORM_FIELD_TYPES.find((t) => t.type === field.type);
  const Icon = info?.icon;
  return (
    <span className="fd-form-outline__label">
      {Icon && <Icon size={12} className="fd-form-outline__icon" />}
      <span className="fd-form-outline__text">{field.label || field.key}</span>
      {field.required && <span className="fd-form-outline__required">*</span>}
    </span>
  );
}

function toTreeNodes(fields: WorkflowFormField[]): TreeNodeData[] {
  return fields.map((f) => {
    const children: TreeNodeData[] = [];
    f.columns?.forEach((col) => children.push(...toTreeNodes(col.fields)));
    f.panes?.forEach((pane) => children.push(...toTreeNodes(pane.fields)));
    if (f.children) children.push(...toTreeNodes(f.children));
    return {
      key: f.key,
      value: f.key,
      label: nodeLabel(f),
      children: children.length > 0 ? children : undefined,
    };
  });
}

export default function FormOutline({ fields, selectedKey, onSelect }: Readonly<FormOutlineProps>) {
  const treeData = useMemo(() => toTreeNodes(fields), [fields]);

  if (fields.length === 0) {
    return (
      <div className="fd-form-outline fd-form-outline--empty">
        <Typography.Text type="tertiary" size="small">暂无字段，从「控件」页添加</Typography.Text>
      </div>
    );
  }

  return (
    <div className="fd-form-outline">
      <Tree
        treeData={treeData}
        value={selectedKey ?? undefined}
        onSelect={(key) => onSelect(String(key))}
        expandAll
        blockNode
      />
    </div>
  );
}
