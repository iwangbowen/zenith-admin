/**
 * 流程定义页左侧分类侧栏
 */
import { useState } from 'react';
import { Button, Dropdown, List, Popconfirm, Space, Toast, Form } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { MoreHorizontal, Plus } from 'lucide-react';
import type { WorkflowCategory } from '@zenith/shared';
import { request } from '@/utils/request';
import AppModal from '@/components/AppModal';

interface Props {
  categories: WorkflowCategory[];
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onChanged: () => void;
  canManage: boolean;
}

const PRESET_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#ec4899', '#64748b'];

export default function CategorySidebar({ categories, selectedId, onSelect, onChanged, canManage }: Readonly<Props>) {
  const [editVisible, setEditVisible] = useState(false);
  const [editing, setEditing] = useState<WorkflowCategory | null>(null);
  const [editKey, setEditKey] = useState(0);
  const [openMenuId, setOpenMenuId] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [formApi, setFormApi] = useState<FormApi | null>(null);
  const [selectedColor, setSelectedColor] = useState<string>('');

  const openNew = () => {
    setEditing(null);
    setSelectedColor('');
    setEditKey(k => k + 1);
    setEditVisible(true);
  };

  const openEdit = (c: WorkflowCategory) => {
    setEditing(c);
    setSelectedColor(c.color ?? '');
    setEditKey(k => k + 1);
    setEditVisible(true);
  };

  const handleSubmit = async () => {
    if (!formApi) return;
    try {
      const values = await formApi.validate() as Record<string, unknown>;
      setSubmitting(true);
      const payload = {
        name: values.name,
        code: values.code || null,
        icon: values.icon || null,
        color: selectedColor || null,
        sort: typeof values.sort === 'number' ? values.sort : Number(values.sort) || 0,
        description: values.description || null,
      };
      const res = editing
        ? await request.put(`/api/workflows/categories/${editing.id}`, payload)
        : await request.post('/api/workflows/categories', payload);
      if (res.code === 0) {
        Toast.success(editing ? '已更新' : '已新增');
        setEditVisible(false);
        onChanged();
      }
    } catch {
      // validation failed
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (c: WorkflowCategory) => {
    const res = await request.delete(`/api/workflows/categories/${c.id}`);
    if (res.code === 0) {
      Toast.success('已删除');
      if (selectedId === c.id) onSelect(null);
      onChanged();
    }
  };

  type ListItem = { id: number | null; name: string; color?: string | null };
  const listData: ListItem[] = [{ id: null, name: '全部流程', color: null }, ...categories];

  const renderItem = (item: ListItem) => {
    const isAll = item.id === null;
    const isActive = isAll ? selectedId === null : selectedId === item.id;
    return (
      <List.Item
        style={{
          padding: '7px 8px',
          borderRadius: 6,
          cursor: 'pointer',
          background: isActive ? 'var(--semi-color-fill-1)' : 'transparent',
          marginBottom: 2,
        }}
        onClick={() => onSelect(isAll ? null : item.id!)}
        main={
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, userSelect: 'none' }}>
            {item.color
              ? <span style={{ width: 8, height: 8, borderRadius: '50%', background: item.color, flexShrink: 0 }} />
              : <span style={{ width: 8, flexShrink: 0 }} />
            }
            <span style={{ flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--semi-color-text-0)' }}>
              {item.name}
            </span>
          </div>
        }
        extra={
          canManage && !isAll ? (
            <Dropdown
              trigger="custom"
              visible={openMenuId === item.id}
              onClickOutSide={() => setOpenMenuId(null)}
              position="bottomRight"
              render={
                <Dropdown.Menu>
                  <Dropdown.Item onClick={() => { setOpenMenuId(null); openEdit(item as WorkflowCategory); }}>编辑</Dropdown.Item>
                  <Dropdown.Item>
                    <Popconfirm
                      title="确定删除该分类？"
                      content="分类下若仍有流程将无法删除"
                      onConfirm={() => { setOpenMenuId(null); void handleDelete(item as WorkflowCategory); }}
                    >
                      <span style={{ color: 'var(--semi-color-danger)' }}>删除</span>
                    </Popconfirm>
                  </Dropdown.Item>
                </Dropdown.Menu>
              }
            >
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); setOpenMenuId(openMenuId === item.id ? null : item.id!); }}
                style={{ border: 'none', background: 'transparent', cursor: 'pointer', padding: 2, display: 'flex', alignItems: 'center' }}
              >
                <MoreHorizontal size={14} />
              </button>
            </Dropdown>
          ) : null
        }
      />
    );
  };

  return (
    <div style={{
      width: 220, flexShrink: 0,
      background: 'var(--semi-color-bg-1)',
      borderRadius: 8, border: '1px solid var(--semi-color-border)',
      padding: '8px 8px',
      alignSelf: 'flex-start',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 4px 8px', borderBottom: '1px solid var(--semi-color-border)', marginBottom: 4 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--semi-color-text-0)' }}>流程分类</span>
        {canManage && (
          <Button theme="borderless" size="small" icon={<Plus size={14} />} onClick={openNew}>新增</Button>
        )}
      </div>

      <List<ListItem>
        size="small"
        split={false}
        dataSource={listData}
        renderItem={renderItem}
      />

      <AppModal
        title={editing ? '编辑分类' : '新增分类'}
        visible={editVisible}
        onCancel={() => setEditVisible(false)}
        onOk={() => void handleSubmit()}
        confirmLoading={submitting}
        okText="保存"
        width={520}

      >
        <Form
          key={editKey}
          getFormApi={api => setFormApi(api)}
          allowEmpty
          initValues={{
            name: editing?.name ?? '',
            code: editing?.code ?? '',
            icon: editing?.icon ?? '',
            sort: editing?.sort ?? 0,
            description: editing?.description ?? '',
          }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input
            field="name" label="名称"
            placeholder="如：人事 / 财务 / IT"
            rules={[{ required: true, message: '请填写名称' }]}
          />
          <Form.Input field="code" label="编码" placeholder="可选，仅字母数字" />
          <Form.Slot label="颜色">
            <Space wrap>
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
              <input
                type="text"
                value={selectedColor}
                onChange={e => setSelectedColor(e.target.value)}
                placeholder="自定义 #hex"
                style={{ width: 110, border: '1px solid var(--semi-color-border)', borderRadius: 4, padding: '4px 8px', fontSize: 13, outline: 'none' }}
              />
            </Space>
          </Form.Slot>
          <Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} />
          <Form.TextArea field="description" label="描述" autosize={{ minRows: 2, maxRows: 4 }} />
        </Form>
      </AppModal>
    </div>
  );
}
