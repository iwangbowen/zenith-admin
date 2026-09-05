import { useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  Button,
  Card,
  Col,
  Form,
  Modal,
  Row,
  Select,
  Space,
  Spin,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ArrowDown, ArrowLeft, ArrowUp, Eye, GripVertical, ImageUp, Monitor, Save, Send, Smartphone, Tablet, Trash2 } from 'lucide-react';
import dayjs from 'dayjs';
import { CMS_WIDGET_RENDERER_LABELS, CMS_WIDGET_SOURCE_TYPE_LABELS, CMS_WIDGET_STATUS_LABELS, CMS_WIDGET_RENDERER_OPTIONS, CMS_WIDGET_SOURCE_TYPE_OPTIONS } from '@zenith/shared/cms';
import type { CmsChannel, CmsWidgetItem, CmsWidgetRendererKey, CmsWidgetSourceType } from '@zenith/shared/cms';
import AppModal from '@/components/AppModal';
import MediaPickerModal from '@/components/MediaPickerModal';
import { usePermission } from '@/hooks/usePermission';
import { useCmsChannelTree, useCmsContentList } from '@/hooks/queries/cms';
import {
  useCmsWidgetDetail,
  useCmsWidgetPreview,
  useCmsWidgetRenderers,
  usePublishCmsWidget,
  useSaveCmsWidget,
} from '@/hooks/queries/cms-widgets';
import { formatDateTimeForApi } from '@/utils/date';
import { CmsSiteSelect } from './CmsSiteSelect';
import { CreateButton } from '@/components/toolbar-controls';
import { abortSubmit } from '@/lib/abort-submit';

function newItemId(): string {
  return `wi${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

function flattenChannels(nodes: CmsChannel[]): CmsChannel[] {
  return nodes.flatMap((node) => [node, ...flattenChannels(node.children ?? [])]);
}

function itemLabel(item: CmsWidgetItem, lookup?: { channelNames?: Map<number, string>; contentTitles?: Map<number, string> }): string {
  if (item.title?.trim()) return item.title;
  if (item.sourceType === 'content') {
    const title = item.sourceId ? lookup?.contentTitles?.get(item.sourceId) : undefined;
    return title ? `${title}（内容 #${item.sourceId}）` : `内容 #${item.sourceId}`;
  }
  if (item.sourceType === 'channel') {
    const name = item.sourceId ? lookup?.channelNames?.get(item.sourceId) : undefined;
    return name ? `${name}（栏目最新）` : `栏目 #${item.sourceId}`;
  }
  return '未命名条目';
}

export default function WidgetEditPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = usePermission();
  const routeId = Number(searchParams.get('id')) || undefined;
  const initialSiteId = Number(searchParams.get('siteId')) || undefined;
  const [activeId, setActiveId] = useState<number | undefined>(routeId);
  const [siteId, setSiteId] = useState<number | undefined>(initialSiteId);
  const [items, setItems] = useState<CmsWidgetItem[]>([]);
  const [selectedRenderer, setSelectedRenderer] = useState<CmsWidgetRendererKey>('list-sidebar');
  const [itemModal, setItemModal] = useState<{ item: CmsWidgetItem; index: number | null } | null>(null);
  const [editingSourceType, setEditingSourceType] = useState<CmsWidgetSourceType>('manual');
  const [mediaPickerVisible, setMediaPickerVisible] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [previewId, setPreviewId] = useState<number | undefined>();
  const [previewViewport, setPreviewViewport] = useState<'desktop' | 'tablet' | 'mobile'>('desktop');
  const [draftRevision, setDraftRevision] = useState<number | undefined>();
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const initializedRef = useRef<number | 'new' | null>(null);
  const baseFormApi = useRef<FormApi | null>(null);
  const itemFormApi = useRef<FormApi | null>(null);

  const detailQuery = useCmsWidgetDetail(activeId);
  const widget = detailQuery.data;
  const renderersQuery = useCmsWidgetRenderers(siteId);
  const previewQuery = useCmsWidgetPreview(previewId, selectedRenderer, previewVisible);
  const channelTreeQuery = useCmsChannelTree(siteId);
  const hasContentItems = items.some((item) => item.sourceType === 'content');
  const contentQuery = useCmsContentList({
    page: 1,
    pageSize: 100,
    siteId: siteId ?? 0,
    status: 'published',
  }, ((!!itemModal && editingSourceType === 'content') || hasContentItems) && !!siteId);
  const saveMutation = useSaveCmsWidget();
  const publishMutation = usePublishCmsWidget();

  useEffect(() => {
    const marker = activeId ?? 'new';
    if (initializedRef.current === marker) return;
    if (activeId && !widget) return;
    initializedRef.current = marker;
    if (widget) {
      setSiteId(widget.siteId);
      setItems(widget.draftData.items);
      setSelectedRenderer(widget.defaultRendererKey);
      setDraftRevision(widget.draftRevision);
    } else {
      setItems([]);
      setSelectedRenderer('list-sidebar');
      setDraftRevision(undefined);
    }
  }, [activeId, widget]);

  const channelOptions = flattenChannels(channelTreeQuery.data ?? []).filter((channel) => channel.type === 'list').map((channel) => ({
    value: channel.id,
    label: channel.name,
  }));
  // 条目列表可读性：栏目/内容来源显示名称而非裸 #ID
  const itemNameLookup = {
    channelNames: new Map(flattenChannels(channelTreeQuery.data ?? []).map((channel) => [channel.id, channel.name])),
    contentTitles: new Map((contentQuery.data?.list ?? []).map((content) => [content.id, content.title])),
  };
  const rendererOptions = (renderersQuery.data ?? []).map((renderer) => ({
    value: renderer.key,
    label: renderer.label,
  }));

  function openItem(item?: CmsWidgetItem, index: number | null = null) {
    const next = item ?? {
      id: newItemId(),
      sourceType: 'manual' as const,
      title: '',
      summary: '',
      url: '',
      image: '',
      displayDate: null,
    };
    setEditingSourceType(next.sourceType);
    setItemModal({ item: next, index });
  }

  function moveItem(index: number, direction: -1 | 1) {
    setItems((current) => {
      const target = index + direction;
      if (target < 0 || target >= current.length) return current;
      const next = [...current];
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function reorderItem(from: number, to: number) {
    if (from === to) return;
    setItems((current) => {
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }

  async function saveItem() {
    if (!itemModal) return;
    const values = await itemFormApi.current?.validate();
    if (!values) return;
    const displayDate = values.displayDate instanceof Date
      ? formatDateTimeForApi(values.displayDate)
      : values.displayDate || null;
    const sourceType = values.sourceType as CmsWidgetSourceType;
    const next: CmsWidgetItem = {
      id: itemModal.item.id,
      sourceType,
      ...(sourceType === 'manual' ? {} : { sourceId: Number(values.sourceId) }),
      title: values.title?.trim() || null,
      summary: values.summary?.trim() || null,
      url: values.url?.trim() || null,
      image: values.image?.trim() || null,
      displayDate,
    };
    setItems((current) => itemModal.index === null
      ? [...current, next]
      : current.map((item, index) => index === itemModal.index ? next : item));
    setItemModal(null);
  }

  async function saveWidget() {
    if (!siteId) {
      Toast.warning('请先选择站点');
      throw new Error('site-required');
    }
    const values = await baseFormApi.current?.validate();
    if (!values) abortSubmit('validation');
    if (activeId && draftRevision === undefined) throw new Error('revision-required');
    const saved = await saveMutation.mutateAsync({
      id: activeId,
      values: {
        ...(activeId
          ? { expectedRevision: draftRevision }
          : { siteId, type: 'manual-list', code: values.code }),
        name: values.name,
        defaultRendererKey: selectedRenderer,
        remark: values.remark?.trim() || null,
        draftData: { items },
      },
    });
    setDraftRevision(saved.draftRevision);
    if (!activeId) {
      setActiveId(saved.id);
      initializedRef.current = saved.id;
      navigate(`/cms/widgets/edit?id=${saved.id}&siteId=${saved.siteId}`, { replace: true });
    }
    Toast.success('草稿已保存');
    return saved;
  }

  async function handlePublish() {
    const saved = await saveWidget();
    Modal.confirm({
      title: `发布页面部件「${saved.name}」？`,
      content: saved.impactCount > 0
        ? `发布后将刷新 ${saved.impactCount} 个页面或首页${saved.highFanout ? '，该部件影响范围较大，请确认变更' : ''}。`
        : '当前没有页面或主题插槽引用，发布不会触发页面刷新。',
      onOk: async () => {
        await publishMutation.mutateAsync({ params: { id: saved.id } });
        Toast.success('发布成功，引用刷新任务已提交');
      },
    });
  }

  async function handlePreview() {
    const saved = await saveWidget();
    setPreviewId(saved.id);
    setPreviewVisible(true);
  }

  const formKey = widget ? `${widget.id}-${widget.draftRevision}` : 'new';
  const status = widget?.status ?? 'draft';
  const canEditWidget = hasPermission(activeId ? 'cms:widget:update' : 'cms:widget:create');

  return (
    <div className="page-container">
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Space wrap>
          <Button icon={<ArrowLeft size={14} />} onClick={() => navigate('/cms/widgets')}>返回</Button>
          <Typography.Title heading={4} style={{ margin: 0 }}>
            {widget ? `编辑页面部件：${widget.name}` : '新增页面部件'}
          </Typography.Title>
          <Tag color={status === 'published' ? 'green' : status === 'offline' ? 'orange' : 'grey'}>
            {CMS_WIDGET_STATUS_LABELS[status]}
          </Tag>
          {widget?.hasUnpublishedChanges ? <Tag color="blue">有未发布修改</Tag> : null}
        </Space>
        <Space wrap>
          <Button
            icon={<Eye size={14} />}
            loading={saveMutation.isPending && previewVisible}
            disabled={!canEditWidget}
            onClick={() => void handlePreview()}
          >
            保存并预览
          </Button>
          <Button
            icon={<Save size={14} />}
            loading={saveMutation.isPending}
            disabled={!canEditWidget}
            onClick={() => void saveWidget()}
          >
            保存草稿
          </Button>
          <Button
            type="primary"
            icon={<Send size={14} />}
            loading={publishMutation.isPending}
            disabled={!hasPermission('cms:widget:publish')}
            onClick={() => void handlePublish()}
          >
            发布
          </Button>
        </Space>
      </div>

      <Spin spinning={detailQuery.isFetching && !!activeId}>
        <Card title="基础信息" style={{ marginBottom: 16 }}>
          <Form
            key={formKey}
            getFormApi={(api) => { baseFormApi.current = api; }}
            labelPosition="left"
            labelWidth={90}
            disabled={!canEditWidget}
            initValues={{
              name: widget?.name ?? '',
              code: widget?.code ?? '',
              remark: widget?.remark ?? '',
            }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Slot label="所属站点">
                  <CmsSiteSelect value={siteId} onChange={setSiteId} />
                </Form.Slot>
              </Col>
              <Col span={12}>
                <Form.Input field="name" label="部件名称" rules={[{ required: true, message: '请输入部件名称' }]} />
              </Col>
              <Col span={12}>
                <Form.Input
                  field="code"
                  label="部件编码"
                  disabled={!!activeId}
                  rules={[
                    { required: true, message: '请输入部件编码' },
                    { pattern: /^[a-z0-9-]+$/, message: '仅允许小写字母、数字和中划线' },
                  ]}
                />
              </Col>
              <Col span={12}>
                <Form.Slot label="默认模板">
                  <Select
                    value={selectedRenderer}
                    onChange={(value) => setSelectedRenderer(value as CmsWidgetRendererKey)}
                    optionList={rendererOptions.length > 0
                      ? rendererOptions
                      : CMS_WIDGET_RENDERER_OPTIONS}
                    style={{ width: '100%' }}
                  />
                </Form.Slot>
              </Col>
            </Row>
            <Form.TextArea field="remark" label="备注" rows={2} />
          </Form>
        </Card>

        <Card
          title={`部件条目（${items.length}）`}
          headerExtraContent={(
            <CreateButton disabled={!canEditWidget} onClick={() => openItem()}>新增条目</CreateButton>
          )}
        >
          {items.length === 0 ? (
            <div style={{ color: 'var(--semi-color-text-2)', textAlign: 'center', padding: 36 }}>
              暂无条目，点击“新增条目”开始配置
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {items.map((item, index) => (
                <div
                  key={item.id}
                  draggable
                  onDragStart={() => setDragIndex(index)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => {
                    if (dragIndex !== null) reorderItem(dragIndex, index);
                    setDragIndex(null);
                  }}
                  onDragEnd={() => setDragIndex(null)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    border: '1px solid var(--semi-color-border)',
                    borderRadius: 'var(--semi-border-radius-medium)',
                    padding: '10px 12px',
                  }}
                >
                  <GripVertical size={15} color="var(--semi-color-text-2)" />
                  <span style={{ width: 28, color: 'var(--semi-color-text-2)' }}>{index + 1}</span>
                  <Tag size="small">{CMS_WIDGET_SOURCE_TYPE_LABELS[item.sourceType]}</Tag>
                  <Typography.Text ellipsis={{ showTooltip: true }} style={{ flex: 1 }}>
                    {itemLabel(item, itemNameLookup)}
                  </Typography.Text>
                  <Button theme="borderless" size="small" icon={<ArrowUp size={14} />} disabled={index === 0} onClick={() => moveItem(index, -1)} />
                  <Button theme="borderless" size="small" icon={<ArrowDown size={14} />} disabled={index === items.length - 1} onClick={() => moveItem(index, 1)} />
                  <Button theme="borderless" size="small" onClick={() => openItem(item, index)}>编辑</Button>
                  <Button
                    theme="borderless"
                    size="small"
                    type="danger"
                    icon={<Trash2 size={14} />}
                    onClick={() => setItems((current) => current.filter((_entry, itemIndex) => itemIndex !== index))}
                  />
                </div>
              ))}
            </div>
          )}
        </Card>
      </Spin>

      <AppModal
        title={itemModal?.index === null ? '新增条目' : '编辑条目'}
        visible={!!itemModal}
        onCancel={() => setItemModal(null)}
        onOk={saveItem}
        width={660}
        closeOnEsc
      >
        {itemModal ? (
          <Form
            key={`${itemModal.item.id}-${itemModal.index ?? 'new'}`}
            getFormApi={(api) => { itemFormApi.current = api; }}
            labelPosition="left"
            labelWidth={90}
            initValues={{
              ...itemModal.item,
              displayDate: itemModal.item.displayDate ? dayjs(itemModal.item.displayDate).toDate() : undefined,
            }}
          >
            <Row gutter={16}>
              <Col span={12}>
                <Form.Select
                  field="sourceType"
                  label="条目来源"
                  optionList={CMS_WIDGET_SOURCE_TYPE_OPTIONS}
                  onChange={(value) => {
                    setEditingSourceType(value as CmsWidgetSourceType);
                    itemFormApi.current?.setValue('sourceId', undefined);
                  }}
                  rules={[{ required: true, message: '请选择条目来源' }]}
                  style={{ width: '100%' }}
                />
              </Col>
              {editingSourceType === 'content' ? (
                <Col span={12}>
                  <Form.Select
                    field="sourceId"
                    label="选择内容"
                    filter
                    optionList={(contentQuery.data?.list ?? []).map((content) => ({ value: content.id, label: content.title }))}
                    loading={contentQuery.isFetching}
                    rules={[{ required: true, message: '请选择内容' }]}
                    style={{ width: '100%' }}
                  />
                </Col>
              ) : null}
              {editingSourceType === 'channel' ? (
                <Col span={12}>
                  <Form.Select
                    field="sourceId"
                    label="选择栏目"
                    filter
                    optionList={channelOptions}
                    loading={channelTreeQuery.isFetching}
                    rules={[{ required: true, message: '请选择栏目' }]}
                    style={{ width: '100%' }}
                  />
                </Col>
              ) : null}
              <Col span={12}>
                <Form.Input
                  field="title"
                  label={editingSourceType === 'manual' ? '标题' : '覆盖标题'}
                  rules={editingSourceType === 'manual' ? [{ required: true, message: '请输入标题' }] : undefined}
                  extraText={editingSourceType === 'manual' ? undefined : '留空时实时跟随来源'}
                />
              </Col>
              <Col span={12}>
                <Form.DatePicker field="displayDate" label="展示日期" type="dateTime" style={{ width: '100%' }} />
              </Col>
            </Row>
            <Form.TextArea field="summary" label={editingSourceType === 'manual' ? '摘要' : '覆盖摘要'} rows={3} />
            <Form.Input field="url" label={editingSourceType === 'manual' ? '链接' : '覆盖链接'} />
            <Form.Input
              field="image"
              label={editingSourceType === 'manual' ? '图片' : '覆盖图片'}
              suffix={<Button theme="borderless" icon={<ImageUp size={14} />} onClick={() => setMediaPickerVisible(true)}>媒体库</Button>}
            />
          </Form>
        ) : null}
      </AppModal>

      <MediaPickerModal
        visible={mediaPickerVisible}
        onCancel={() => setMediaPickerVisible(false)}
        onSelect={(file) => {
          itemFormApi.current?.setValue('image', file.url);
          setMediaPickerVisible(false);
        }}
      />

      <AppModal
        title={`真实主题预览 · ${CMS_WIDGET_RENDERER_LABELS[selectedRenderer]}`}
        visible={previewVisible}
        onCancel={() => setPreviewVisible(false)}
        footer={null}
        width={1200}
        closeOnEsc
      >
        <Spin spinning={previewQuery.isFetching}>
          <Space style={{ marginBottom: 12 }}>
            <Button
              type={previewViewport === 'desktop' ? 'primary' : 'tertiary'}
              icon={<Monitor size={14} />}
              onClick={() => setPreviewViewport('desktop')}
            >
              桌面
            </Button>
            <Button
              type={previewViewport === 'tablet' ? 'primary' : 'tertiary'}
              icon={<Tablet size={14} />}
              onClick={() => setPreviewViewport('tablet')}
            >
              平板
            </Button>
            <Button
              type={previewViewport === 'mobile' ? 'primary' : 'tertiary'}
              icon={<Smartphone size={14} />}
              onClick={() => setPreviewViewport('mobile')}
            >
              手机
            </Button>
          </Space>
          <div style={{ display: 'flex', justifyContent: 'center', overflow: 'auto', padding: 12, background: 'var(--semi-color-fill-0)' }}>
            <iframe
              title="页面部件真实主题预览"
              srcDoc={previewQuery.data?.documentHtml ?? ''}
              sandbox=""
              style={{
                width: previewViewport === 'desktop' ? '100%' : previewViewport === 'tablet' ? 768 : 390,
                height: 620,
                border: '1px solid var(--semi-color-border)',
                borderRadius: 'var(--semi-border-radius-medium)',
                background: '#fff',
              }}
            />
          </div>
        </Spin>
      </AppModal>
    </div>
  );
}
