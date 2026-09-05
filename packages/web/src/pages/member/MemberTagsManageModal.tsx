import { Button, Form, Modal, Popconfirm, Space, Table, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberTag } from '@zenith/shared/member';
import { AppModal } from '@/components/AppModal';
import { useDeleteMemberTag, useMemberTags, useSaveMemberTag, type MemberTagFormValues } from '@/hooks/queries/member-admin';
import { useDictItems } from '@/hooks/useDictItems';
import { CreateButton } from '@/components/toolbar-controls';
import { useEditModal } from '@/hooks/useEditModal';
import { renderEllipsis } from '@/utils/table-columns';

const TAG_COLORS = ['red', 'orange', 'amber', 'green', 'teal', 'blue', 'purple', 'pink', 'grey'] as const;

interface Props {
  visible: boolean;
  onClose: () => void;
}

/** 会员标签轻量管理（列表 + 新增/编辑/删除，嵌在会员管理页）*/
export function MemberTagsManageModal({ visible, onClose }: Readonly<Props>) {
  const { items: statusItems } = useDictItems('common_status');
  const tagsQuery = useMemberTags();
  const saveMutation = useSaveMemberTag();
  const deleteMutation = useDeleteMemberTag();
  const tags = tagsQuery.data ?? [];

  const tagModal = useEditModal<MemberTag, MemberTagFormValues>({
    entityName: '标签',
    save: saveMutation,
    defaults: { status: 'enabled', color: 'blue' },
    toValues: (record) => ({ name: record.name, color: record.color ?? undefined, description: record.description, sort: record.sort, status: record.status }),
    labelWidth: 80,
  });

  const handleDelete = async (record: MemberTag) => {
    await deleteMutation.mutateAsync({ params: { id: record.id } });
    Toast.success('删除成功');
  };

  const columns: ColumnProps<MemberTag>[] = [
    {
      title: '标签', dataIndex: 'name', width: 140,
      render: (v: string, r: MemberTag) => <Tag color={(r.color || 'blue') as 'blue'}>{v}</Tag>,
    },
    { title: '说明', dataIndex: 'description', width: 220, render: renderEllipsis },
    { title: '会员数', dataIndex: 'memberCount', width: 80, align: 'right', render: (v?: number) => v ?? 0 },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: string) => <Tag color={v === 'enabled' ? 'green' : 'grey'} size="small">{v === 'enabled' ? '启用' : '停用'}</Tag>,
    },
    {
      title: '操作', dataIndex: 'op', width: 150, fixed: 'right',
      render: (_: unknown, record: MemberTag) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => tagModal.openEdit(record)}>编辑</Button>
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
        <CreateButton onClick={tagModal.openCreate}>新增标签</CreateButton>
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

      <AppModal {...tagModal.modalProps} width={480}>
        <Form key={tagModal.formKey} {...tagModal.formProps}>
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
