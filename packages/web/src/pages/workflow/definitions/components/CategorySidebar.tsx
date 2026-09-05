/**
 * 流程定义页左侧分类侧栏
 */
import { useState } from 'react';
import { Button, Dropdown, Toast, Form, Input } from '@douyinfe/semi-ui';
import { MoreHorizontal, Plus, Layers, LayoutGrid, Pencil, Trash2 } from 'lucide-react';
import type { CreateWorkflowCategoryInput, WorkflowCategory } from '@zenith/shared/workflow';
import AppModal from '@/components/AppModal';
import { useDeleteWorkflowCategories, useSaveWorkflowCategory } from '@/hooks/useWorkflowCategories';
import { NavListPanel, NavListItem } from '@/components/NavListPanel';
import { confirmDelete } from '@/utils/confirm';
import { useEditModal } from '@/hooks/useEditModal';

interface Props {
  categories: WorkflowCategory[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onChanged: () => void;
  canManage: boolean;
}

const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];

interface CategoryFormValues {
  name: string;
  code: string;
  icon: string;
  sort: number | string;
  description: string;
}

export default function CategorySidebar({ categories, selectedId, onSelect, onChanged, canManage }: Readonly<Props>) {
  const [selectedColor, setSelectedColor] = useState<string>('');
  const saveMutation = useSaveWorkflowCategory();
  const deleteMutation = useDeleteWorkflowCategories();
  const modal = useEditModal<WorkflowCategory, CategoryFormValues, Partial<CreateWorkflowCategoryInput>>({
    save: saveMutation,
    defaults: { name: '', code: '', icon: '', sort: 0, description: '' },
    toValues: (category) => ({
      name: category.name,
      code: category.code ?? '',
      icon: category.icon ?? '',
      sort: category.sort ?? 0,
      description: category.description ?? '',
    }),
    beforeSave: (values) => ({
      name: values.name,
      code: values.code || null,
      icon: values.icon || null,
      color: selectedColor || null,
      sort: typeof values.sort === 'number' ? values.sort : Number(values.sort) || 0,
      description: values.description || null,
    }),
    successMessage: ({ isEdit }) => (isEdit ? '已更新' : '已新增'),
    onSaved: onChanged,
  });

  const openNew = () => {
    setSelectedColor('');
    modal.openCreate();
  };

  const openEdit = (c: WorkflowCategory) => {
    setSelectedColor(c.color ?? '');
    modal.openEdit(c);
  };

  const handleDelete = async (c: WorkflowCategory) => {
    await deleteMutation.mutateAsync([c.id]);
    Toast.success('已删除');
    if (selectedId === c.id) onSelect(null);
    onChanged();
  };

  type ListItem = { id: number | null; name: string; color?: string | null };
  const listData: ListItem[] = [{ id: null, name: '全部流程', color: null }, ...categories];

  return (
    <>
      <NavListPanel
        title="流程分类"
        headerExtra={
          canManage ? (
            <Button theme="borderless" size="small" icon={<Plus size={14} />} onClick={openNew}>新增</Button>
          ) : undefined
        }
        dataSource={listData}
        renderItem={(item) => {
          const isAll = item.id === null;
          const isActive = isAll ? selectedId === null : selectedId === item.id;
          const colorDot = item.color
            ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0, display: 'inline-block' }} />
            : <Layers size={13} />;
          const itemIcon = isAll ? <LayoutGrid size={13} /> : colorDot;
          return (
            <NavListItem
              key={item.id ?? 'all'}
              active={isActive}
              onClick={() => onSelect(isAll ? null : item.id!)}
              icon={itemIcon}
              primary={item.name}
              extra={
                canManage && !isAll ? (
                  <Dropdown
                    trigger="click"
                    position="bottomRight"
                    clickToHide
                    render={
                      <Dropdown.Menu>
                        <Dropdown.Item onClick={() => openEdit(item as WorkflowCategory)}>
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Pencil size={14} /> 编辑
                          </span>
                        </Dropdown.Item>
                        <Dropdown.Item
                          type="danger"
                          onClick={() => {
                            confirmDelete({
                              title: '确认删除该分类？',
                              content: '分类下若仍有流程将无法删除',
                              onOk: () => void handleDelete(item as WorkflowCategory),
                            });
                          }}
                        >
                          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <Trash2 size={14} /> 删除
                          </span>
                        </Dropdown.Item>
                      </Dropdown.Menu>
                    }
                  >
                    <Button
                      theme="borderless"
                      size="small"
                      icon={<MoreHorizontal size={14} />}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </Dropdown>
                ) : undefined
              }
            />
          );
        }}
      />

      <AppModal
        {...modal.modalProps}
        title={modal.isEdit ? '编辑分类' : '新增分类'}
        okText="保存"
        width={520}

      >
        <Form
          key={modal.formKey} {...modal.formProps}
        >
          <Form.Input
            field="name" label="名称"
            placeholder="如：人事 / 财务 / IT"
            rules={[{ required: true, message: '请填写名称' }]}
          />
          <Form.Input field="code" label="编码" placeholder="可选，仅字母数字" />
          <Form.Slot label="颜色">
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
              {PRESET_COLORS.map(color => (
                <button
                  key={color}
                  type="button"
                  onClick={() => setSelectedColor(selectedColor === color ? '' : color)}
                  style={{
                    width: 24, height: 24, borderRadius: '50%', background: color,
                    border: selectedColor === color ? '2px solid var(--semi-color-text-0)' : '2px solid transparent',
                    cursor: 'pointer',
                    flexShrink: 0,
                  }}
                  aria-label={color}
                />
              ))}
              <Input
                value={selectedColor}
                onChange={setSelectedColor}
                placeholder="自定义 #hex"
                size="small"
                style={{ width: 110 }}
              />
            </div>
          </Form.Slot>
          <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
          <Form.TextArea field="description" label="描述" autosize={{ minRows: 2, maxRows: 4 }} />
        </Form>
      </AppModal>
    </>
  );
}
