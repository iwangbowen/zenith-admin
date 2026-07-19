import { useRef, useState } from 'react';
import { Button, Form, Tag, Toast, Modal, Tabs, TabPane, Select } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import {
  useCmsAdSlots, useSaveCmsAdSlot, useDeleteCmsAdSlot,
  useCmsAdList, useSaveCmsAd, useDeleteCmsAd,
} from '@/hooks/queries/cms';
import type { CmsAdSlot, CmsAd } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

// ─── 广告位 Tab ───────────────────────────────────────────────────────────────
function SlotsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsAdSlot | null>(null);

  const slotsQuery = useCmsAdSlots(siteId);
  const saveMutation = useSaveCmsAdSlot();
  const deleteMutation = useDeleteCmsAdSlot();
  const canManage = hasPermission('cms:ad:manage');

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!editingRecord) values.siteId = siteId;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsAdSlot>[] = [
    { title: '广告位名称', dataIndex: 'name', width: 180 },
    { title: '模板引用标识', dataIndex: 'code', width: 160, render: (v: string) => <Tag size="small">{v}</Tag> },
    { title: '投放广告数', dataIndex: 'adCount', width: 110 },
    { title: '备注', dataIndex: 'remark', width: 220, render: (v: string | null) => v ?? '-' },
    createOperationColumn<CmsAdSlot>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => { setEditingRecord(record); setModalVisible(true); } },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该广告位吗？',
              content: '需先清空广告位下的广告',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          },
        },
      ] : [],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增广告位</Button> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={slotsQuery.data ?? []}
        loading={slotsQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无广告位；默认主题支持 home-ad（首页横幅下方）"
        onRefresh={() => void slotsQuery.refetch()}
        refreshLoading={slotsQuery.isFetching}
        pagination={false}
      />
      <AppModal
        title={editingRecord ? '编辑广告位' : '新增广告位'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={480}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord ? { code: editingRecord.code, name: editingRecord.name, remark: editingRecord.remark ?? '' } : {}}
          labelPosition="left"
          labelWidth={100}
        >
          <Form.Input field="name" label="广告位名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="code" label="引用标识" disabled={!!editingRecord} placeholder="如 home-ad（主题模板中引用）" rules={[{ required: true, message: '请输入标识' }]} />
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </>
  );
}

// ─── 广告投放 Tab ─────────────────────────────────────────────────────────────
function AdsTab({ siteId }: Readonly<{ siteId: number | undefined }>) {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [slotFilter, setSlotFilter] = useState<number | undefined>(undefined);
  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsAd | null>(null);

  const slotsQuery = useCmsAdSlots(siteId);
  const listQuery = useCmsAdList({ page, pageSize, siteId: siteId ?? 0, slotId: slotFilter }, siteId !== undefined);
  const saveMutation = useSaveCmsAd();
  const deleteMutation = useDeleteCmsAd();
  const canManage = hasPermission('cms:ad:manage');

  async function handleModalOk() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (values.startAt instanceof Date) values.startAt = formatDateTimeForApi(values.startAt);
    if (values.endAt instanceof Date) values.endAt = formatDateTimeForApi(values.endAt);
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsAd>[] = [
    { title: '广告名称', dataIndex: 'name', width: 180 },
    { title: '广告位', dataIndex: 'slotName', width: 140 },
    { title: '跳转地址', dataIndex: 'linkUrl', width: 200, render: (v: string | null) => v ?? '-' },
    { title: '点击量', dataIndex: 'clickCount', width: 90, align: 'right' },
    { title: '开始时间', dataIndex: 'startAt', width: 180, render: (v: string | null) => v ?? '不限' },
    { title: '结束时间', dataIndex: 'endAt', width: 180, render: (v: string | null) => v ?? '不限' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '状态', dataIndex: 'status', width: 80, fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsAd>({
      width: 160,
      desktopInlineKeys: ['edit', 'delete'],
      actions: (record) => canManage ? [
        { key: 'edit', label: '编辑', onClick: () => { setEditingRecord(record); setModalVisible(true); } },
        {
          key: 'delete', label: '删除', danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该广告吗？',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          },
        },
      ] : [],
    }),
  ];

  return (
    <>
      <SearchToolbar>
        <Select
          placeholder="全部广告位"
          value={slotFilter}
          onChange={(v) => { setSlotFilter(v as number | undefined); setPage(1); }}
          showClear
          style={{ width: 180 }}
          optionList={(slotsQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))}
        />
        {canManage ? <Button type="primary" icon={<Plus size={14} />} onClick={() => { setEditingRecord(null); setModalVisible(true); }}>新增广告</Button> : null}
      </SearchToolbar>
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无广告"
        scroll={{ x: 1210 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
      />
      <AppModal
        title={editingRecord ? '编辑广告' : '新增广告'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={() => { setModalVisible(false); setEditingRecord(null); }}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={560}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={editingRecord
            ? {
                slotId: editingRecord.slotId, name: editingRecord.name, image: editingRecord.image ?? '',
                linkUrl: editingRecord.linkUrl ?? '', startAt: editingRecord.startAt ?? undefined,
                endAt: editingRecord.endAt ?? undefined, sort: editingRecord.sort, status: editingRecord.status,
              }
            : { sort: 0, status: 'enabled' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Select field="slotId" label="广告位" style={{ width: '100%' }} rules={[{ required: true, message: '请选择广告位' }]}
            optionList={(slotsQuery.data ?? []).map((s) => ({ value: s.id, label: s.name }))} />
          <Form.Input field="name" label="广告名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="image" label="图片 URL" placeholder="留空显示文字条" />
          <Form.Input field="linkUrl" label="跳转地址" placeholder="/products/enterprise.html 或 https://..." />
          <Form.DatePicker field="startAt" label="开始时间" type="dateTime" density="compact" style={{ width: '100%' }} placeholder="不限" />
          <Form.DatePicker field="endAt" label="结束时间" type="dateTime" density="compact" style={{ width: '100%' }} placeholder="不限" />
          <Form.InputNumber field="sort" label="排序" style={{ width: 160 }} />
          <Form.RadioGroup field="status" label="状态">
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
        </Form>
      </AppModal>
    </>
  );
}

// ════════════════════════════════════════════════════════════════════════════
export default function AdsPage() {
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [activeTab, setActiveTab] = useState('slots');

  return (
    <div className="page-container page-tabs-page">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} width={200} />
      </SearchToolbar>
      <Tabs activeKey={activeTab} onChange={setActiveTab} type="line" lazyRender keepDOM={false}>
        <TabPane tab="广告位" itemKey="slots">
          <SlotsTab siteId={siteId} />
        </TabPane>
        <TabPane tab="广告投放" itemKey="ads">
          <AdsTab siteId={siteId} />
        </TabPane>
      </Tabs>
    </div>
  );
}
