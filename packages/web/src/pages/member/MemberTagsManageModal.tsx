import { useRef, useState } from 'react';
import { Button, Form, Modal, Popconfirm, Space, Table, Tag, Toast } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Plus } from 'lucide-react';
import type { MemberTag } from '@zenith/shared';
import { AppModal } from '@/components/AppModal';
import { useDeleteMemberTag, useMemberTags, useSaveMemberTag } from '@/hooks/queries/member-admin';
import { useDictItems } from '@/hooks/useDictItems';

const TAG_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'] as const;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** 会员标签轻量管理（列表 + 新增/编辑/删除，嵌在会员管理页）*/
export function MemberTagsManageModal({ visible, onClose }: Readonly<Props>) {
  const { items: statusItems } = useDictItems('common_status');
  const formApi = useRef<FormApi | null>(null);
  const [editing, setEditing] = useState<MemberTag | null>(null);
  const [formVisible, setFormVisible] = useState(false);
  const tagsQuery = useMemberTags();
  const saveMutation = useSaveMemberTag();
  const deleteMutation = useDeleteMemberTag();
  const tags = tagsQuery.data ?? [];

  const openCreate = () => { setEditing(null); setFormVisible(true); };
  const openEdit = (record: MemberTag) => { setEditing(record); setFormVisible(true); };

  const handleSave = async () => {
    let values;
    try { values = await formApi.current!.validate(); } catch { throw new Error('validation'); }
    await saveMutation.mutateAsync({ id: editing?.id, values });
    Toast.success(editing ? '更新成功' : '创建成功');
    setFormVisible(false);
    setEditing(null);
  };

  const handleDelete = async (record: MemberTag) => {
    await deleteMutation.mutateAsync(record.id);
    Toast.success('删除成功');
  };

  const columns: ColumnProps<MemberTag>[] = [
    {
      title: '标签', dataIndex: 'name', width: 140,
      render: (v: string, r: MemberTag) => <Tag color={(r.color || 'blue') as 'blue'}>{v}</Tag>,
    },
    { title: '说明', dataIndex: 'description', render: (v?: string | null) => v || '-' },
    { title: '会员数', dataIndex: 'memberCount', width: 80, render: (v?: number) => v ?? 0 },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作', dataIndex: 'op', width: 120, fixed: 'right',
      render: (_: unknown, record: MemberTag) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => openEdit(record)}>编辑</Button>
          <Popconfirm title="删除后将解除所有会员的该标签绑定，确定删除？" onConfirm={() => void handleDelete(record)}>
            <Button theme="borderless" type="danger" size="small">删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Modal title="会员标签管理" visible={visible} onCancel={onClose} footer={null} width={640} closeOnEsc>
      <div style={{ marginBottom: 12, display: 'flex', justifyContent: 'flex-end' }}>
        <Button type="primary" icon={<Plus size={14} />} onClick={openCreate}>新增标签</Button>
      </div>
      <Table
        columns={columns}
        dataSource={tags}
        rowKey="id"
        size="small"
        pagination={false}
        loading={tagsQuery.isFetching}
        empty="暂无标签"
        style={{ maxHeight: 420, overflow: 'auto' }}
      />

      <AppModal title={editing ? '编辑标签' : '新增标签'} visible={formVisible} width={480}
        okButtonProps={{ loading: saveMutation.isPending }}
        onCancel={() => { setFormVisible(false); setEditing(null); }} onOk={handleSave}>
        <Form key={editing?.id ?? 'new'} getFormApi={(api) => { formApi.current = api; }}
          initValues={editing ? { name: editing.name, color: editing.color ?? undefined, description: editing.description, sort: editing.sort, status: editing.status } : { status: 'enabled', color: 'blue' }}
          labelPosition="left" labelWidth={80}>
          <Form.Input field="name" label="名称" placeholder="如：高价值 / 易流失" maxLength={32}
            rules={[{ required: true, message: '请输入标签名称' }]} />
          <Form.Select field="color" label="颜色" style={{ width: '100%' }}
            optionList={TAG_COLORS.map((c) => ({ value: c, label: c }))}
            renderSelectedItem={(item: { value?: string }) => <Tag color={(item.value || 'blue') as 'blue'}>{item.value}</Tag>} />
          <Form.Input field="description" label="说明" placeholder="选填" maxLength={256} />
          <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} precision={0} />
          <Form.Select field="status" label="状态" style={{ width: '100%' }}
            optionList={statusItems.map((i) => ({ value: i.value, label: i.label }))} />
        </Form>
      </AppModal>
    </Modal>
  );
}
