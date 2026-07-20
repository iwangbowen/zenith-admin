import { useRef, useState } from 'react';
import { Button, Form, Tag, Toast, Modal } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Plus } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import { createdAtColumn } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { useCmsPublishChannels, useSaveCmsPublishChannel, useDeleteCmsPublishChannel, useAllCmsSites } from '@/hooks/queries/cms';
import { CMS_CHANNEL_SEGMENT_PREFIX } from '@zenith/shared';
import type { CmsPublishChannel } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

export default function PublishChannelsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);

  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);
  const listQuery = useCmsPublishChannels(siteId);
  const list = listQuery.data ?? [];

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsPublishChannel | null>(null);
  const saveMutation = useSaveCmsPublishChannel();
  const deleteMutation = useDeleteCmsPublishChannel();

  function openCreate() {
    setEditingRecord(null);
    setModalVisible(true);
  }

  function openEdit(record: CmsPublishChannel) {
    setEditingRecord(record);
    setModalVisible(true);
  }

  const formInitValues = editingRecord
    ? {
        name: editingRecord.name,
        code: editingRecord.code,
        domain: editingRecord.domain ?? '',
        uaRegex: editingRecord.uaRegex ?? '',
        isDefault: editingRecord.isDefault,
        status: editingRecord.status,
        sort: editingRecord.sort,
        remark: editingRecord.remark ?? '',
      }
    : { isDefault: false, status: 'enabled', sort: 0 };

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (!values.domain) values.domain = null;
    if (!values.uaRegex) values.uaRegex = null;
    if (!editingRecord) values.siteId = siteId;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    setModalVisible(false);
    setEditingRecord(null);
  }

  const columns: ColumnProps<CmsPublishChannel>[] = [
    {
      title: '通道名称',
      dataIndex: 'name',
      width: 180,
      render: (v: string, record) => (
        <span>
          {v}
          {record.isDefault ? <Tag size="small" color="green" style={{ marginLeft: 6 }}>默认</Tag> : null}
        </span>
      ),
    },
    { title: '编码', dataIndex: 'code', width: 120 },
    {
      title: '独立域名',
      dataIndex: 'domain',
      width: 200,
      render: (v: string | null, record) => {
        if (record.isDefault) return <span style={{ color: 'var(--semi-color-text-2)' }}>跟随站点主域名</span>;
        return v || <span style={{ color: 'var(--semi-color-text-2)' }}>未绑定</span>;
      },
    },
    { title: 'UA 匹配规则', dataIndex: 'uaRegex', width: 220, render: (v: string | null) => v ? <code style={{ fontSize: 12 }}>{v}</code> : '-' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    createdAtColumn,
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsPublishChannel>({
      width: 200,
      desktopInlineKeys: ['visit', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'visit',
          label: '预览',
          onClick: () => {
            if (!currentSite) return;
            const path = record.isDefault ? '' : `${CMS_CHANNEL_SEGMENT_PREFIX}${record.code}/`;
            window.open(cmsPreviewUrl(currentSite.code, path), '_blank');
          },
        },
        ...(hasPermission('cms:publish-channel:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }] : []),
        ...(hasPermission('cms:publish-channel:delete') && !record.isDefault ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该发布通道吗？',
              content: '删除后该通道的静态产物不再更新，站点默认模板中按此通道的配置将失效',
              onOk: async () => {
                await deleteMutation.mutateAsync(record.id);
                Toast.success('删除成功');
              },
            });
          },
        }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={<CmsSiteSelect value={siteId} onChange={setSiteId} />}
        actions={hasPermission('cms:publish-channel:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={openCreate} disabled={!siteId}>新增</Button>
        ) : null}
      />

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={list}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty={siteId ? '暂无发布通道，站点默认使用虚拟 PC 通道' : '请先选择站点'}
        scroll={{ x: 1200 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={false}
      />

      <AppModal
        title={editingRecord ? '编辑发布通道' : '新增发布通道'}
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
          initValues={formInitValues}
          labelPosition="left"
          labelWidth={110}
        >
          <Form.Input field="name" label="通道名称" placeholder="如 H5 移动 / 小程序 / 大屏" rules={[{ required: true, message: '请输入通道名称' }]} />
          <Form.Input field="code" label="通道编码" disabled={!!editingRecord} placeholder="小写字母/数字/中划线，如 h5"
            extraText={editingRecord ? '编码关联静态产物目录与模板配置，不可修改' : `预览路径 /__cms/{站点}/${CMS_CHANNEL_SEGMENT_PREFIX}{编码}/，静态产物 ${CMS_CHANNEL_SEGMENT_PREFIX}{编码}/ 子树`}
            rules={[{ required: true, message: '请输入通道编码' }]} />
          <Form.Input field="domain" label="独立域名" placeholder="如 m.example.com，留空仅预览访问"
            extraText="默认通道跟随站点主域名，无需填写" />
          <Form.Input field="uaRegex" label="UA 匹配规则" placeholder="如 Mobile|Android|iPhone"
            extraText="正则；与独立域名同时配置后，主域名按 UA 自动 302 到本通道" />
          <Form.Switch field="isDefault" label="默认通道" extraText="服务站点根目录静态树；每站点唯一，不可删除/停用" />
          <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
          <Form.RadioGroup field="status" label="状态" disabled={editingRecord?.isDefault}>
            <Form.Radio value="enabled">启用</Form.Radio>
            <Form.Radio value="disabled">停用</Form.Radio>
          </Form.RadioGroup>
          <Form.Input field="remark" label="备注" />
        </Form>
      </AppModal>
    </div>
  );
}
