/**
 * 基础信息面板 — 步骤 ① 基础信息
 */
import { Form, Select, Tag } from '@douyinfe/semi-ui';
import type { WorkflowDefinition } from '@zenith/shared';
import { useWorkflowCategories } from '@/hooks/useWorkflowCategories';
import { useMemo } from 'react';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';

type InitiatorScopeType = 'all' | 'users' | 'departments' | 'roles';

interface BasicInfoPanelProps {
  definition: WorkflowDefinition | null;
  isNew: boolean;
  categoryId: number | null;
  users: Array<{ id: number; nickname: string }>;
  roles: Array<{ id: number; name: string }>;
  departments: Array<{ id: number; name: string; parentId: number | null }>;
  initiatorScopeType: InitiatorScopeType;
  initiatorScopeIds: number[];
  onFieldChange: (field: string, value: string) => void;
  onCategoryChange: (categoryId: number | null) => void;
  onInitiatorScopeTypeChange: (v: InitiatorScopeType) => void;
  onInitiatorScopeIdsChange: (v: number[]) => void;
  readOnly?: boolean;
}

function getStatusLabel(status: string): string {
  if (status === 'published') return '已发布';
  if (status === 'draft') return '草稿';
  return '已禁用';
}

export default function BasicInfoPanel({
  definition,
  isNew,
  categoryId,
  users,
  roles,
  departments,
  initiatorScopeType,
  initiatorScopeIds,
  onFieldChange,
  onCategoryChange,
  onInitiatorScopeTypeChange,
  onInitiatorScopeIdsChange,
  readOnly = false,
}: Readonly<BasicInfoPanelProps>) {
  const { categories } = useWorkflowCategories();
  const scopeOptions = [
    { value: 'all', label: '全体人员' },
    { value: 'users', label: '指定人员' },
    { value: 'departments', label: '指定部门' },
    { value: 'roles', label: '指定角色' },
  ] as const;
  let targetOptions: Array<{ value: number; label: string }> = roles.map((r) => ({ value: r.id, label: r.name }));
  if (initiatorScopeType === 'users') {
    targetOptions = users.map((u) => ({ value: u.id, label: `${u.nickname} (#${u.id})` }));
  }

  const departmentTreeData = useMemo<TreeNodeData[]>(() => {
    const nodeMap = new Map<number, TreeNodeData>();
    const rootNodes: TreeNodeData[] = [];

    departments.forEach((item) => {
      nodeMap.set(item.id, {
        key: String(item.id),
        value: item.id,
        label: item.name,
        children: [],
      });
    });

    departments.forEach((item) => {
      const currentNode = nodeMap.get(item.id);
      if (!currentNode) return;

      if (item.parentId && nodeMap.has(item.parentId)) {
        const parentNode = nodeMap.get(item.parentId)!;
        parentNode.children = [...(parentNode.children ?? []), currentNode];
      } else {
        rootNodes.push(currentNode);
      }
    });

    return rootNodes;
  }, [departments]);
  let scopePlaceholder = '请选择角色';
  if (initiatorScopeType === 'users') scopePlaceholder = '请选择人员';
  else if (initiatorScopeType === 'departments') scopePlaceholder = '请选择部门';
  return (
    <div className="fd-basic-info">
      <div className="fd-basic-info__inner">
        <Form
          key={`basic-${definition?.id ?? 'new'}-${categoryId ?? 'none'}`}
          allowEmpty
          disabled={readOnly}
          initValues={{
            name: definition?.name ?? '',
            description: definition?.description ?? '',
            categoryId: categoryId ?? undefined,
            initiatorScopeIds,
          }}
          labelPosition="left"
          labelWidth={120}
          onValueChange={(values: Record<string, unknown>) => {
            if (typeof values.name === 'string') onFieldChange('name', values.name);
            if (typeof values.description === 'string') onFieldChange('description', values.description);
            if (Array.isArray(values.initiatorScopeIds)) {
              onInitiatorScopeIdsChange(values.initiatorScopeIds.map(Number).filter((x) => Number.isInteger(x) && x > 0));
            }
          }}
        >
          <Form.Input
            field="name"
            label="流程名称"
            placeholder="请输入流程名称"
            rules={[{ required: true, message: '请输入流程名称' }]}
          />
          <Form.Select
            field="categoryId"
            label="流程分类"
            placeholder="请选择流程分类"
            showClear
            style={{ width: '100%' }}
            onChange={v => onCategoryChange(typeof v === 'number' ? v : null)}
            optionList={categories.map(c => ({
              value: c.id,
              label: (
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {c.color ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, display: 'inline-block' }} /> : null}
                  {c.name}
                  {c.code ? <Tag size="small" color="white" style={{ marginLeft: 4 }}>{c.code}</Tag> : null}
                </span>
              ),
            }))}
          />
          <Form.TextArea
            field="description"
            label="流程描述"
            placeholder="请输入流程描述"
            autosize={{ minRows: 3, maxRows: 6 }}
          />
          <Form.Slot label="可发起范围">
            <Select
              value={initiatorScopeType}
              disabled={readOnly}
              style={{ width: '100%' }}
              optionList={scopeOptions as unknown as Array<{ label: string; value: string }>}
              onChange={(v) => onInitiatorScopeTypeChange((v as InitiatorScopeType) ?? 'all')}
            />
          </Form.Slot>
          {initiatorScopeType !== 'all' && (
            initiatorScopeType === 'departments' ? (
              <Form.TreeSelect
                field="initiatorScopeIds"
                label="可发起对象"
                treeData={departmentTreeData}
                multiple
                placeholder={scopePlaceholder}
                style={{ width: '100%' }}
                filterTreeNode
                showClear
              />
            ) : (
              <Form.Select
                field="initiatorScopeIds"
                label="可发起对象"
                multiple
                filter
                maxTagCount={3}
                style={{ width: '100%' }}
                optionList={targetOptions}
                placeholder={scopePlaceholder}
              />
            )
          )}
          {!isNew && definition && (
            <>
              <Form.Input key={`v-${definition.version}`} field="version" label="版本号" disabled initValue={String(definition.version)} />
              <Form.Input key={`s-${definition.status}`} field="status" label="状态" disabled initValue={getStatusLabel(definition.status)} />
            </>
          )}
        </Form>
      </div>
    </div>
  );
}
