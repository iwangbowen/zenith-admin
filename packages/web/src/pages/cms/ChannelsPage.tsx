import { useRef, useState } from 'react';
import { Button, Form, Tag, Toast, Modal, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Plus, ExternalLink } from 'lucide-react';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import AppModal from '@/components/AppModal';
import RichTextEditor from '@/components/RichTextEditor';
import { usePermission } from '@/hooks/usePermission';
import { useCmsChannelTree, useAllCmsModels, useAllCmsSites, useSaveCmsChannel, useDeleteCmsChannel } from '@/hooks/queries/cms';
import { CMS_CHANNEL_TYPE_LABELS } from '@zenith/shared';
import type { CmsChannel } from '@zenith/shared';
import { CmsSiteSelect, cmsPreviewUrl } from './CmsSiteSelect';

function toTreeSelectData(nodes: CmsChannel[], excludeId?: number): TreeNodeData[] {
  return nodes
    .filter((n) => n.id !== excludeId)
    .map((n) => ({
      key: String(n.id),
      value: n.id,
      label: n.name,
      children: n.children ? toTreeSelectData(n.children, excludeId) : undefined,
    }));
}

export default function ChannelsPage() {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const [siteId, setSiteId] = useState<number | undefined>(undefined);

  const treeQuery = useCmsChannelTree(siteId);
  const tree = treeQuery.data ?? [];
  const { data: models } = useAllCmsModels();
  const { data: sites } = useAllCmsSites();
  const currentSite = sites?.find((s) => s.id === siteId);

  const [modalVisible, setModalVisible] = useState(false);
  const [editingRecord, setEditingRecord] = useState<CmsChannel | null>(null);
  const [channelType, setChannelType] = useState<string>('list');
  const [pageContent, setPageContent] = useState('');
  const saveMutation = useSaveCmsChannel();
  const deleteMutation = useDeleteCmsChannel();

  function openCreate(parentId = 0) {
    setEditingRecord(null);
    setChannelType('list');
    setPageContent('');
    setModalVisible(true);
    // Form initValues 由 key 重置，父栏目通过 setTimeout 设置避免 Form 未挂载
    setTimeout(() => formApi.current?.setValue('parentId', parentId), 0);
  }

  function openEdit(record: CmsChannel) {
    setEditingRecord(record);
    setChannelType(record.type);
    setPageContent(record.pageContent ?? '');
    setModalVisible(true);
  }

  function closeModal() {
    setModalVisible(false);
    setEditingRecord(null);
  }

  const formInitValues = editingRecord
    ? {
        parentId: editingRecord.parentId,
        name: editingRecord.name,
        slug: editingRecord.slug,
        type: editingRecord.type,
        modelId: editingRecord.modelId ?? undefined,
        linkUrl: editingRecord.linkUrl ?? '',
        pageSize: editingRecord.pageSize,
        sort: editingRecord.sort,
        visible: editingRecord.visible,
        status: editingRecord.status,
        seoTitle: editingRecord.seoTitle ?? '',
        seoKeywords: editingRecord.seoKeywords ?? '',
        seoDescription: editingRecord.seoDescription ?? '',
      }
    : { parentId: 0, type: 'list', pageSize: 20, sort: 0, visible: true, status: 'enabled' };

  async function handleModalOk() {
    if (!siteId) return;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      throw new Error('validation');
    }
    if (values.modelId === undefined) values.modelId = null;
    const payload: Record<string, unknown> = { ...values, pageContent };
    if (!editingRecord) payload.siteId = siteId;
    await saveMutation.mutateAsync({ id: editingRecord?.id, values: payload });
    Toast.success(editingRecord ? '更新成功' : '创建成功');
    closeModal();
  }

  async function handleDelete(id: number) {
    await deleteMutation.mutateAsync(id);
    Toast.success('删除成功');
  }

  const columns: ColumnProps<CmsChannel>[] = [
    { title: '栏目名称', dataIndex: 'name', width: 220 },
    {
      title: '类型',
      dataIndex: 'type',
      width: 100,
      render: (v: CmsChannel['type']) => {
        const color = v === 'list' ? 'blue' : v === 'page' ? 'purple' : 'orange';
        return <Tag size="small" color={color}>{CMS_CHANNEL_TYPE_LABELS[v]}</Tag>;
      },
    },
    { title: 'URL 路径', dataIndex: 'path', width: 180, render: (v: string) => `/${v}/` },
    { title: '绑定模型', dataIndex: 'modelName', width: 110, render: (v: string | null) => v ?? '-' },
    { title: '排序', dataIndex: 'sort', width: 70 },
    {
      title: '导航显示',
      dataIndex: 'visible',
      width: 90,
      render: (v: boolean) => (v ? <Tag size="small" color="green">显示</Tag> : <Tag size="small">隐藏</Tag>),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 80,
      fixed: 'right',
      render: (v: string) => (v === 'enabled' ? <Tag color="green" size="small">启用</Tag> : <Tag color="red" size="small">停用</Tag>),
    },
    createOperationColumn<CmsChannel>({
      width: 240,
      desktopInlineKeys: ['addChild', 'edit', 'delete'],
      actions: (record) => [
        {
          key: 'visit',
          label: '访问',
          onClick: () => {
            if (currentSite) window.open(cmsPreviewUrl(currentSite.code, `${record.path}/`), '_blank');
          },
        },
        ...(hasPermission('cms:channel:create') ? [{
          key: 'addChild',
          label: '添加子栏目',
          onClick: () => openCreate(record.id),
        }] : []),
        ...(hasPermission('cms:channel:update') ? [{
          key: 'edit',
          label: '编辑',
          onClick: () => openEdit(record),
        }] : []),
        ...(hasPermission('cms:channel:delete') ? [{
          key: 'delete',
          label: '删除',
          danger: true,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该栏目吗？',
              content: '需先清空子栏目与栏目下内容',
              onOk: () => handleDelete(record.id),
            });
          },
        }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={setSiteId} />
        {currentSite ? (
          <Button
            icon={<ExternalLink size={14} />}
            onClick={() => window.open(cmsPreviewUrl(currentSite.code), '_blank')}
          >
            访问站点
          </Button>
        ) : null}
        {hasPermission('cms:channel:create') ? (
          <Button type="primary" icon={<Plus size={14} />} onClick={() => openCreate(0)}>新增栏目</Button>
        ) : null}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={tree}
        loading={treeQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无栏目，点击右上角「新增栏目」创建"
        scroll={{ x: 1090 }}
        onRefresh={() => void treeQuery.refetch()}
        refreshLoading={treeQuery.isFetching}
        pagination={false}
        expandAllRows
      />

      <AppModal
        title={editingRecord ? '编辑栏目' : '新增栏目'}
        visible={modalVisible}
        onOk={handleModalOk}
        onCancel={closeModal}
        okButtonProps={{ loading: saveMutation.isPending }}
        width={720}
        closeOnEsc
      >
        <Form
          key={editingRecord?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={formInitValues}
          onValueChange={(values) => {
            if (values.type !== channelType) setChannelType(values.type as string);
          }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Slot label="父栏目">
            <Form.TreeSelect
              field="parentId"
              noLabel
              style={{ width: '100%' }}
              treeData={[{ key: '0', value: 0, label: '顶级栏目' }, ...toTreeSelectData(tree, editingRecord?.id)]}
            />
          </Form.Slot>
          <Row gutter={16}>
            <Col span={12}>
              <Form.Input field="name" label="栏目名称" rules={[{ required: true, message: '请输入栏目名称' }]} />
            </Col>
            <Col span={12}>
              <Form.Input field="slug" label="URL 标识" placeholder="小写字母/数字/中划线" rules={[{ required: true, message: '请输入 URL 标识' }]} />
            </Col>
            <Col span={12}>
              <Form.Select field="type" label="栏目类型" style={{ width: '100%' }}
                optionList={[
                  { value: 'list', label: '列表栏目（挂内容）' },
                  { value: 'page', label: '单页栏目（富文本）' },
                  { value: 'link', label: '外链栏目（跳转）' },
                ]} />
            </Col>
            {channelType === 'list' ? (
              <Col span={12}>
                <Form.Select field="modelId" label="内容模型" style={{ width: '100%' }} showClear
                  optionList={(models ?? []).map((m) => ({ value: m.id, label: m.name }))} />
              </Col>
            ) : null}
            {channelType === 'link' ? (
              <Col span={12}>
                <Form.Input field="linkUrl" label="跳转地址" placeholder="https://..." rules={[{ required: true, message: '请输入跳转地址' }]} />
              </Col>
            ) : null}
            {channelType === 'list' ? (
              <Col span={12}>
                <Form.InputNumber field="pageSize" label="每页条数" min={1} max={100} style={{ width: '100%' }} />
              </Col>
            ) : null}
            <Col span={12}>
              <Form.InputNumber field="sort" label="排序" style={{ width: '100%' }} />
            </Col>
            <Col span={12}>
              <Form.Switch field="visible" label="导航显示" />
            </Col>
            <Col span={12}>
              <Form.RadioGroup field="status" label="状态">
                <Form.Radio value="enabled">启用</Form.Radio>
                <Form.Radio value="disabled">停用</Form.Radio>
              </Form.RadioGroup>
            </Col>
          </Row>
          {channelType === 'page' ? (
            <Form.Slot label="单页内容">
              <RichTextEditor value={pageContent} onChange={setPageContent} height={240} />
            </Form.Slot>
          ) : null}
          <Form.Section text="SEO 设置（留空继承站点默认）">
            <Form.Input field="seoTitle" label="SEO 标题" />
            <Form.Input field="seoKeywords" label="SEO 关键词" />
            <Form.TextArea field="seoDescription" label="SEO 描述" rows={2} />
          </Form.Section>
        </Form>
      </AppModal>
    </div>
  );
}
