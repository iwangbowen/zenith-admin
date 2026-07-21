import { useRef, useState } from 'react';
import { Button, Form, Input, Modal, Select, Space, Tag, Toast, Typography, Empty, Spin } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Search, RotateCcw, Upload, FileText, Film, Music, File as FileIcon } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { AppModal } from '@/components/AppModal';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import {
  cmsResourceKeys, useCmsResourceList, useCmsResourceReferences,
  useUploadCmsResource, useUpdateCmsResource, useCropCmsResource, useDeleteCmsResources,
} from '@/hooks/queries/cms';
import { CMS_RESOURCE_TYPE_LABELS, CMS_RESOURCE_TYPES } from '@zenith/shared';
import type { CmsResource, CmsResourceType } from '@zenith/shared';
import { CmsSiteSelect } from './CmsSiteSelect';

const TYPE_COLORS: Record<CmsResourceType, 'blue' | 'purple' | 'cyan' | 'orange' | 'grey'> = {
  image: 'blue', video: 'purple', audio: 'cyan', document: 'orange', other: 'grey',
};

const REFERENCE_KIND_LABELS: Record<'content' | 'ad' | 'fragment', string> = {
  content: '内容', ad: '广告', fragment: '碎片',
};

function formatSize(bytes: number): string {
  if (bytes >= 1048576) return `${(bytes / 1048576).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}

function TypeIcon({ type }: Readonly<{ type: CmsResourceType }>) {
  if (type === 'video') return <Film size={22} />;
  if (type === 'audio') return <Music size={22} />;
  if (type === 'document') return <FileText size={22} />;
  return <FileIcon size={22} />;
}

/** 裁剪弹窗：图片上拖拽画选区（映射回原图像素），调服务端 sharp 裁剪另存新素材 */
function CropModal({ resource, onClose }: Readonly<{ resource: CmsResource | null; onClose: () => void }>) {
  const cropMutation = useCropCmsResource();
  const imgRef = useRef<HTMLImageElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  function relativePoint(e: React.MouseEvent): { x: number; y: number } | null {
    const box = boxRef.current?.getBoundingClientRect();
    if (!box) return null;
    return {
      x: Math.min(Math.max(e.clientX - box.left, 0), box.width),
      y: Math.min(Math.max(e.clientY - box.top, 0), box.height),
    };
  }

  function handleMouseDown(e: React.MouseEvent) {
    const p = relativePoint(e);
    if (!p) return;
    dragRef.current = { startX: p.x, startY: p.y };
    setRect({ x: p.x, y: p.y, w: 0, h: 0 });
  }

  function handleMouseMove(e: React.MouseEvent) {
    if (!dragRef.current) return;
    const p = relativePoint(e);
    if (!p) return;
    const { startX, startY } = dragRef.current;
    setRect({
      x: Math.min(startX, p.x),
      y: Math.min(startY, p.y),
      w: Math.abs(p.x - startX),
      h: Math.abs(p.y - startY),
    });
  }

  function handleMouseUp() {
    dragRef.current = null;
  }

  // 展示尺寸 → 原图像素的换算比例（图片加载/窗口变化后由拖拽重渲染自然刷新）
  const img = imgRef.current;
  const scale = img && resource?.width ? resource.width / img.clientWidth : 1;

  const originalRect = rect && rect.w > 4 && rect.h > 4
    ? {
        left: Math.round(rect.x * scale),
        top: Math.round(rect.y * scale),
        width: Math.round(rect.w * scale),
        height: Math.round(rect.h * scale),
      }
    : null;

  async function handleConfirm() {
    if (!resource || !originalRect) return;
    await cropMutation.mutateAsync({ id: resource.id, rect: originalRect });
    Toast.success('裁剪成功，已另存为新素材');
    onClose();
  }

  return (
    <AppModal
      title={`裁剪图片 — ${resource?.name ?? ''}`}
      visible={resource !== null}
      onCancel={onClose}
      width={640}
      centered
      closeOnEsc
      footer={
        <Space>
          <Button onClick={onClose}>取消</Button>
          <Button onClick={() => setRect(null)} disabled={!rect}>清除选区</Button>
          <Button type="primary" loading={cropMutation.isPending} disabled={!originalRect} onClick={() => void handleConfirm()}>
            裁剪并另存
          </Button>
        </Space>
      }
    >
      {resource ? (
        <>
          <Typography.Text type="tertiary" style={{ display: 'block', marginBottom: 8, fontSize: 12 }}>
            在图片上按住鼠标拖拽框选裁剪区域（原图 {resource.width ?? '?'}×{resource.height ?? '?'}）
            {originalRect ? `，当前选区 ${originalRect.width}×${originalRect.height} @ (${originalRect.left}, ${originalRect.top})` : ''}
          </Typography.Text>
          {/* 阻断默认拖图行为，覆盖层画选区 */}
          <div
            ref={boxRef}
            role="presentation"
            style={{ position: 'relative', display: 'inline-block', cursor: 'crosshair', userSelect: 'none', maxWidth: '100%' }}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
          >
            <img ref={imgRef} src={resource.url} alt={resource.name} draggable={false} style={{ maxWidth: '100%', maxHeight: 420, display: 'block' }} />
            {rect ? (
              <div style={{
                position: 'absolute', left: rect.x, top: rect.y, width: rect.w, height: rect.h,
                border: '1px dashed var(--semi-color-primary)', background: 'rgba(0, 100, 250, 0.15)', pointerEvents: 'none',
              }} />
            ) : null}
          </div>
        </>
      ) : null}
    </AppModal>
  );
}

/** 引用弹窗：列出素材被内容/广告/碎片引用的位置 */
function ReferencesModal({ resource, onClose }: Readonly<{ resource: CmsResource | null; onClose: () => void }>) {
  const refsQuery = useCmsResourceReferences(resource?.id ?? null);
  const refs = refsQuery.data ?? [];
  return (
    <AppModal title={`引用位置 — ${resource?.name ?? ''}`} visible={resource !== null} onCancel={onClose} footer={null} width={480} centered closeOnEsc>
      {refsQuery.isLoading ? (
        <div style={{ textAlign: 'center', padding: 24 }}><Spin /></div>
      ) : refs.length === 0 ? (
        <Empty title="暂无引用" description="该素材未被站内内容、广告或碎片引用，可安全删除" style={{ padding: 24 }} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, paddingBottom: 12 }}>
          {refs.map((r) => (
            <div key={`${r.kind}-${r.id}`} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Tag size="small">{REFERENCE_KIND_LABELS[r.kind]}</Tag>
              <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 360 }}>#{r.id} {r.title}</Typography.Text>
            </div>
          ))}
        </div>
      )}
    </AppModal>
  );
}

export default function ResourcesPage() {
  const { hasPermission } = usePermission();
  const qc = useQueryClient();
  const [siteId, setSiteId] = useState<number | undefined>(undefined);
  const [type, setType] = useState<CmsResourceType | undefined>(undefined);
  const [keywordDraft, setKeywordDraft] = useState('');
  const [keyword, setKeyword] = useState<string | undefined>(undefined);
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const [selectedIds, setSelectedIds] = useState<number[]>([]);
  const [renameTarget, setRenameTarget] = useState<CmsResource | null>(null);
  const [cropTarget, setCropTarget] = useState<CmsResource | null>(null);
  const [refsTarget, setRefsTarget] = useState<CmsResource | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const listQuery = useCmsResourceList({ page, pageSize, siteId: siteId ?? 0, type, keyword }, siteId !== undefined);
  const uploadMutation = useUploadCmsResource();
  const updateMutation = useUpdateCmsResource();
  const deleteMutation = useDeleteCmsResources();

  const canUpload = hasPermission('cms:resource:upload');
  const canUpdate = hasPermission('cms:resource:update');
  const canDelete = hasPermission('cms:resource:delete');

  function handleSearch() {
    setKeyword(keywordDraft.trim() || undefined);
    setPage(1);
    void qc.invalidateQueries({ queryKey: cmsResourceKeys.lists });
  }

  function handleReset() {
    setKeywordDraft('');
    setKeyword(undefined);
    setType(undefined);
    setPage(1);
    void qc.invalidateQueries({ queryKey: cmsResourceKeys.lists });
  }

  async function handleUploadFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || siteId === undefined) return;
    await uploadMutation.mutateAsync({ siteId, file });
    Toast.success('上传成功');
  }

  function handleDelete(ids: number[]) {
    Modal.confirm({
      title: `删除 ${ids.length} 个素材？`,
      content: '存在站内引用的素材会被拒绝删除；删除会同步移除底层文件，不可恢复。',
      okButtonProps: { type: 'danger', theme: 'solid' },
      onOk: async () => {
        await deleteMutation.mutateAsync(ids);
        setSelectedIds([]);
        Toast.success('删除成功');
      },
    });
  }

  const columns: ColumnProps<CmsResource>[] = [
    {
      title: '预览', dataIndex: 'url', width: 80,
      render: (_: string, record: CmsResource) => record.type === 'image'
        ? <img src={record.thumbUrl ?? record.url} alt={record.name} style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-medium)' }} />
        : <div style={{ width: 48, height: 48, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--semi-color-text-2)', background: 'var(--semi-color-fill-0)', borderRadius: 'var(--semi-border-radius-medium)' }}><TypeIcon type={record.type} /></div>,
    },
    {
      title: '名称', dataIndex: 'name', width: 240,
      render: (v: string, record: CmsResource) => (
        <div style={{ minWidth: 0 }}>
          <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: 220, display: 'block' }}>{v}</Typography.Text>
          {record.remark ? <Typography.Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 220, display: 'block' }}>{record.remark}</Typography.Text> : null}
        </div>
      ),
    },
    {
      title: '类型', dataIndex: 'type', width: 90,
      render: (v: CmsResourceType) => <Tag size="small" color={TYPE_COLORS[v]}>{CMS_RESOURCE_TYPE_LABELS[v]}</Tag>,
    },
    {
      title: '尺寸', dataIndex: 'width', width: 110,
      render: (_: number | null, record: CmsResource) => (record.width && record.height ? `${record.width}×${record.height}` : '-'),
    },
    { title: '大小', dataIndex: 'size', width: 100, render: (v: number) => formatSize(v) },
    { title: '上传时间', dataIndex: 'createdAt', width: 170 },
    createOperationColumn<CmsResource>({
      width: 220,
      desktopInlineKeys: ['references', 'crop', 'rename', 'delete'],
      actions: (record) => [
        { key: 'references', label: '引用', onClick: () => setRefsTarget(record) },
        ...(canUpdate && record.type === 'image' && record.fileId ? [{
          key: 'crop', label: '裁剪', onClick: () => setCropTarget(record),
        }] : []),
        ...(canUpdate ? [{ key: 'rename', label: '编辑', onClick: () => setRenameTarget(record) }] : []),
        ...(canDelete ? [{ key: 'delete', label: '删除', danger: true, onClick: () => handleDelete([record.id]) }] : []),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <CmsSiteSelect value={siteId} onChange={(v) => { setSiteId(v); setPage(1); }} width={200} />
        <Select
          placeholder="素材类型"
          style={{ width: 130 }}
          showClear
          value={type}
          onChange={(v) => { setType(v as CmsResourceType | undefined); setPage(1); }}
          optionList={CMS_RESOURCE_TYPES.map((t) => ({ label: CMS_RESOURCE_TYPE_LABELS[t], value: t }))}
        />
        <Input prefix={<Search size={14} />} placeholder="搜索素材名称" showClear value={keywordDraft} onChange={setKeywordDraft} style={{ width: 200 }} onEnterPress={handleSearch} />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {canUpload ? (
          <Button type="primary" icon={<Upload size={14} />} loading={uploadMutation.isPending} disabled={siteId === undefined} onClick={() => fileInputRef.current?.click()}>
            上传素材
          </Button>
        ) : null}
        {selectedIds.length > 0 && canDelete ? (
          <Button type="danger" onClick={() => handleDelete(selectedIds)}>批量删除（{selectedIds.length}）</Button>
        ) : null}
      </SearchToolbar>
      <input ref={fileInputRef} type="file" style={{ display: 'none' }} onChange={(e) => void handleUploadFile(e)} />
      <ConfigurableTable
        bordered
        columns={columns}
        dataSource={listQuery.data?.list ?? []}
        loading={listQuery.isFetching}
        rowKey="id"
        size="small"
        empty="暂无素材，请先选择站点后上传"
        scroll={{ x: 1020 }}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(listQuery.data?.total ?? 0)}
        rowSelection={{
          selectedRowKeys: selectedIds.map(String),
          onChange: (keys) => setSelectedIds((keys ?? []).map(Number)),
        }}
      />

      {/* 重命名/备注 */}
      <AppModal
        title={`编辑素材 — ${renameTarget?.name ?? ''}`}
        visible={renameTarget !== null}
        onCancel={() => setRenameTarget(null)}
        footer={null}
        width={440}
        centered
        closeOnEsc
      >
        {renameTarget ? (
          <Form
            labelPosition="left"
            labelWidth={80}
            initValues={{ name: renameTarget.name, remark: renameTarget.remark ?? '' }}
            onSubmit={async (values: { name: string; remark: string }) => {
              await updateMutation.mutateAsync({ id: renameTarget.id, values: { name: values.name, remark: values.remark || null } });
              Toast.success('已保存');
              setRenameTarget(null);
            }}
          >
            <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入素材名称' }]} maxLength={255} />
            <Form.Input field="remark" label="备注" maxLength={200} />
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8, paddingBottom: 12 }}>
              <Button onClick={() => setRenameTarget(null)}>取消</Button>
              <Button type="primary" htmlType="submit" loading={updateMutation.isPending}>保存</Button>
            </div>
          </Form>
        ) : null}
      </AppModal>

      <CropModal resource={cropTarget} onClose={() => setCropTarget(null)} />
      <ReferencesModal resource={refsTarget} onClose={() => setRefsTarget(null)} />
    </div>
  );
}
