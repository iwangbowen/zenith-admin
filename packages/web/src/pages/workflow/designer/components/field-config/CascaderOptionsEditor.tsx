// ─── 级联选择（cascader）树形选项编辑器：缩进文本模式（拆分自 TypeSpecificSection）───
import { useEffect, useState } from 'react';
import { Switch, TextArea, Typography } from '@douyinfe/semi-ui';
import type { WorkflowFormField, WorkflowFormCascaderNode } from '@zenith/shared';

/**
 * 树 → 缩进文本：每行一个节点，两个空格表示一级缩进；「值|显示名」可分离。
 */
function treeToText(nodes: WorkflowFormCascaderNode[], depth = 0): string {
  return nodes
    .map((n) => {
      const line = '  '.repeat(depth) + (n.label && n.label !== n.value ? `${n.value}|${n.label}` : n.value);
      const childText = n.children?.length ? `\n${treeToText(n.children, depth + 1)}` : '';
      return line + childText;
    })
    .join('\n');
}

/** 缩进文本 → 树（空行忽略；缩进按 2 空格一级，容忍奇数空格向下取整） */
function textToTree(text: string): WorkflowFormCascaderNode[] {
  const root: WorkflowFormCascaderNode[] = [];
  const stack: Array<{ depth: number; node: WorkflowFormCascaderNode }> = [];
  for (const rawLine of text.replace(/\r/g, '').replace(/\t/g, '  ').split('\n')) {
    if (!rawLine.trim()) continue;
    const depth = Math.floor((rawLine.length - rawLine.trimStart().length) / 2);
    const body = rawLine.trim();
    const sep = body.indexOf('|');
    const value = (sep >= 0 ? body.slice(0, sep) : body).trim();
    if (!value) continue;
    const label = sep >= 0 ? body.slice(sep + 1).trim() : '';
    const node: WorkflowFormCascaderNode = { value, ...(label && label !== value ? { label } : {}) };
    while (stack.length > 0 && stack[stack.length - 1].depth >= depth) stack.pop();
    if (stack.length === 0) {
      root.push(node);
    } else {
      const parent = stack[stack.length - 1].node;
      parent.children = parent.children ?? [];
      parent.children.push(node);
    }
    stack.push({ depth, node });
  }
  return root;
}

export function CascaderOptionsEditor({
  field,
  onChange,
}: Readonly<{ field: WorkflowFormField; onChange: (updates: Partial<WorkflowFormField>) => void }>) {
  const [draft, setDraft] = useState(() => treeToText(field.cascaderOptions ?? []));

  // 切换字段时同步草稿
  useEffect(() => {
    setDraft(treeToText(field.cascaderOptions ?? []));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [field.key]);

  const commit = (text: string) => {
    setDraft(text);
    onChange({ cascaderOptions: textToTree(text) });
  };

  const empty = (field.cascaderOptions ?? []).length === 0;

  return (
    <>
      <div className="fd-form-config__field">
        <Typography.Text strong size="small">级联选项</Typography.Text>
        <TextArea
          value={draft}
          onChange={commit}
          rows={Math.min(14, Math.max(6, draft.split('\n').length + 1))}
          placeholder={'每行一个选项，两个空格缩进表示下一级：\n华东\n  上海\n  杭州\n华南\n  深圳'}
        />
        {empty ? (
          <Typography.Text type="danger" size="small">级联选项为空</Typography.Text>
        ) : (
          <Typography.Text type="tertiary" size="small">
            两空格缩进=下一级；「值|显示名」可分离；Tab 自动按两空格处理
          </Typography.Text>
        )}
      </div>
      <div className="fd-form-config__field fd-form-config__field--inline">
        <div>
          <Typography.Text strong size="small">可选任意层级</Typography.Text>
          <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
            关闭时仅末级选项可选
          </Typography.Text>
        </div>
        <Switch
          size="small"
          checked={field.cascaderChangeOnSelect ?? false}
          onChange={(v) => onChange({ cascaderChangeOnSelect: v || undefined })}
        />
      </div>
    </>
  );
}
