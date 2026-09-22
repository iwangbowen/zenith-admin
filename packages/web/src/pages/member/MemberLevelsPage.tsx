
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Space, Form, Tag, Row, Col, Typography, OverflowList, Popover } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { MemberLevel } from '@zenith/shared/member';
import { SearchToolbar } from '@/components/SearchToolbar';
import ConfigurableTable from '@/components/ConfigurableTable';
import { listTableProps, useCrudOperationColumn } from '@/components/list-page';
import { EMPTY_PLACEHOLDER, renderEllipsis, enabledStatusColumn } from '@/utils/table-columns';
import { memberAdminKeys, useDeleteMemberLevel, useMemberLevels, useSaveMemberLevel, type MemberLevelFormValues } from '@/hooks/queries/member-admin';
import { useDictItems } from '@/hooks/useDictItems';
import { CreateButton, RefreshButton } from '@/components/toolbar-controls';
import { useEditModal } from '@/hooks/useEditModal';
import { EditFormModal } from '@/components/EditFormModal';

/** 「权益」列内容宽度 = 列宽 220 − 单元格左右 padding 32 */
const BENEFIT_TAG_CONTENT_WIDTH = 188;

export default function MemberLevelsPage() {
  const navigate = useNavigate();
  const { options: statusOptions } = useDictItems('common_status');
  const queryClient = useQueryClient();
  const listQuery = useMemberLevels();
  const saveMutation = useSaveMemberLevel();
  const deleteMutation = useDeleteMemberLevel();

  const levelModal = useEditModal<MemberLevel, MemberLevelFormValues>({
    entityName: '等级',
    save: saveMutation,
    defaults: { level: 0, growthThreshold: 0, discount: 100, sort: 0, status: 'enabled' as const, benefits: [] },
    toValues: (record) => ({ name: record.name, level: record.level, growthThreshold: record.growthThreshold, discount: record.discount, benefits: record.benefits, description: record.description, sort: record.sort, status: record.status }),
  });

  const operationColumn = useCrudOperationColumn<MemberLevel>({
    permission: 'member:level',
    edit: levelModal,
    remove: (record) => deleteMutation.mutateAsync({ params: { id: record.id } }),
    title: (record) => `确认删除等级「${record.name}」？`,
    content: '删除后该等级下会员的等级将被置空。',
    width: 150,
    desktopInlineKeys: ['edit', 'delete'],
  });

  const columns: ColumnProps<MemberLevel>[] = [
    { title: '等级名称', dataIndex: 'name', minWidth: 140, render: renderEllipsis },
    { title: '等级序号', dataIndex: 'level', width: 90, align: 'right' },
    { title: '成长值门槛', dataIndex: 'growthThreshold', width: 110, align: 'right' },
    { title: '折扣', dataIndex: 'discount', width: 90, align: 'right', render: (v: number) => (v >= 100 ? '无' : `${(v / 10).toFixed(1)}折`) },
    { title: '会员数', dataIndex: 'memberCount', width: 90, align: 'right', render: (v: number | undefined, r: MemberLevel) => (
      (v ?? 0) > 0
        ? <Typography.Text link onClick={() => navigate(`/member/members?levelId=${r.id}`)}>{v}</Typography.Text>
        : 0
    ) },
    {
      // 权益是自由文本标签，全部铺开会折成多行、把行高撑大；单行放不下的收纳为 +N，
      // 悬浮给出被收纳的权益（与用户管理的角色列同一做法）
      title: '权益', dataIndex: 'benefits', width: 220,
      render: (v: string[]) => {
        if (!v?.length) return EMPTY_PLACEHOLDER;
        const items = v.map((benefit, index) => ({ key: `${index}-${benefit}`, label: benefit }));
        return (
          <div style={{ width: BENEFIT_TAG_CONTENT_WIDTH, maxWidth: '100%', minWidth: 0, overflow: 'hidden' }}>
            <OverflowList
              items={items}
              renderMode="collapse"
              style={{ width: BENEFIT_TAG_CONTENT_WIDTH, maxWidth: '100%', minWidth: 0 }}
              visibleItemRenderer={(item) => (
                <Tag key={item.key} color="light-blue" style={{ flex: '0 0 auto', marginRight: 4 }}>{item.label}</Tag>
              )}
              overflowRenderer={(overflowItems) => (
                overflowItems.length > 0 ? (
                  <Popover
                    position="bottomLeft"
                    content={(
                      <Space spacing={4} wrap style={{ maxWidth: 220 }}>
                        {overflowItems.map((item) => <Tag key={item.key} color="light-blue">{item.label}</Tag>)}
                      </Space>
                    )}
                  >
                    <Tag color="grey" style={{ flex: '0 0 auto', cursor: 'pointer' }}>+{overflowItems.length}</Tag>
                  </Popover>
                ) : null
              )}
            />
          </div>
        );
      },
    },
    enabledStatusColumn(),
    operationColumn,
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <RefreshButton onClick={() => void queryClient.invalidateQueries({ queryKey: memberAdminKeys.levels })} />
            <CreateButton permission="member:level:create" onClick={levelModal.openCreate}>新增等级</CreateButton>
          </>
        )}
      />

      <ConfigurableTable<MemberLevel> columns={columns} {...listTableProps(listQuery, { empty: '暂无数据' })} />

      <EditFormModal modal={levelModal} width={660}>
        <Row gutter={16}>
          <Col span={12}><Form.Input field="name" label="等级名称" placeholder="如：黄金会员" rules={[{ required: true, message: '请输入等级名称' }]} /></Col>
          <Col span={12}><Form.InputNumber field="level" label="等级序号" min={0} style={{ width: '100%' }} rules={[{ required: true, message: '请输入序号' }]} /></Col>
          <Col span={12}><Form.InputNumber field="growthThreshold" label="成长值门槛" min={0} style={{ width: '100%' }} /></Col>
          <Col span={12}><Form.InputNumber field="discount" label="折扣(%)" min={1} max={100} style={{ width: '100%' }} suffix="%" /></Col>
          <Col span={12}><Form.InputNumber field="sort" label="排序" min={0} style={{ width: '100%' }} /></Col>
          <Col span={12}><Form.Select field="status" label="状态" style={{ width: '100%' }} optionList={statusOptions} /></Col>
        </Row>
        <Form.TagInput field="benefits" label="权益说明" placeholder="输入权益后回车，如：生日礼券" />
        <Form.TextArea field="description" label="描述" placeholder="请输入等级描述" maxCount={256} />
      </EditFormModal>
    </div>
  );
}
