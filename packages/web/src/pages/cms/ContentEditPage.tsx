import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Form, Spin, Toast, Row, Col, Banner, SideSheet, Timeline, Modal } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { ArrowLeft, Save, Send, History } from 'lucide-react';
import RichTextEditor from '@/components/RichTextEditor';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import {
  useCmsContentDetail, useCmsChannelTree, useAllCmsModels, useAllCmsTags,
  useSaveCmsContent, useCmsContentAction, useCmsContentVersions, useRestoreCmsContentVersion,
} from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared';
import type { CmsChannel, CmsModelField } from '@zenith/shared';

function channelsToTree(nodes: CmsChannel[]): TreeNodeData[] {
  return nodes.map((n) => ({
    key: String(n.id),
    value: n.id,
    label: n.name,
    disabled: n.type !== 'list',
    children: n.children ? channelsToTree(n.children) : undefined,
  }));
}

function findChannel(nodes: CmsChannel[], id: number | undefined): CmsChannel | undefined {
  if (!id) return undefined;
  for (const n of nodes) {
    if (n.id === id) return n;
    const hit = n.children ? findChannel(n.children, id) : undefined;
    if (hit) return hit;
  }
  return undefined;
}

/** 按模型字段元数据渲染动态表单控件（值写入 extend.{name}） */
function ModelFieldControl({ field }: Readonly<{ field: CmsModelField }>) {
  const f = `extend.${field.name}`;
  const rules = field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined;
  const common = { field: f, label: field.label, rules, placeholder: field.placeholder ?? undefined };
  switch (field.fieldType) {
    case 'textarea':
      return <Form.TextArea {...common} rows={3} />;
    case 'richtext':
      return <Form.TextArea {...common} rows={5} placeholder={field.placeholder ?? '支持 HTML'} />;
    case 'number':
      return <Form.InputNumber {...common} style={{ width: '100%' }} />;
    case 'date':
      return <Form.DatePicker {...common} type="date" density="compact" style={{ width: '100%' }} />;
    case 'datetime':
      return <Form.DatePicker {...common} type="dateTime" density="compact" style={{ width: '100%' }} />;
    case 'select':
      return <Form.Select {...common} style={{ width: '100%' }} optionList={field.options ?? []} showClear />;
    case 'radio':
      return (
        <Form.RadioGroup {...common}>
          {(field.options ?? []).map((o) => <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>)}
        </Form.RadioGroup>
      );
    case 'checkbox':
      return <Form.CheckboxGroup {...common} options={field.options ?? []} direction="horizontal" />;
    case 'switch':
      return <Form.Switch {...common} />;
    case 'image':
    case 'file':
      return <Form.Input {...common} placeholder={field.placeholder ?? '资源 URL（可从文件管理复制）'} />;
    default:
      return <Form.Input {...common} />;
  }
}

export default function ContentEditPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formApi = useRef<FormApi | null>(null);

  const id = searchParams.get('id') ? Number(searchParams.get('id')) : undefined;
  const siteIdParam = searchParams.get('siteId') ? Number(searchParams.get('siteId')) : undefined;
  const channelIdParam = searchParams.get('channelId') ? Number(searchParams.get('channelId')) : undefined;

  const detailQuery = useCmsContentDetail(id);
  const detail = detailQuery.data;
  const siteId = detail?.siteId ?? siteIdParam;

  const treeQuery = useCmsChannelTree(siteId);
  const { data: models } = useAllCmsModels();
  const { data: tags } = useAllCmsTags(siteId);
  const saveMutation = useSaveCmsContent();
  const actionMutation = useCmsContentAction();

  const [body, setBody] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState<number | undefined>(channelIdParam);
  const [versionsVisible, setVersionsVisible] = useState(false);
  const versionsQuery = useCmsContentVersions(id, versionsVisible);
  const restoreMutation = useRestoreCmsContentVersion();

  useEffect(() => {
    if (detail) {
      setBody(detail.body ?? '');
      setSelectedChannelId(detail.channelId);
    }
  }, [detail]);

  const currentChannel = findChannel(treeQuery.data ?? [], selectedChannelId);
  const currentModel = useMemo(
    () => (models ?? []).find((m) => m.id === (currentChannel?.modelId ?? detail?.modelId)),
    [models, currentChannel, detail],
  );
  const modelFields = currentModel?.fields ?? [];

  const initValues = detail
    ? {
        channelId: detail.channelId,
        title: detail.title,
        slug: detail.slug ?? '',
        summary: detail.summary ?? '',
        coverImage: detail.coverImage ?? '',
        author: detail.author ?? '',
        source: detail.source ?? '',
        externalLink: detail.externalLink ?? '',
        isTop: detail.isTop,
        isRecommend: detail.isRecommend,
        isHot: detail.isHot,
        sort: detail.sort,
        tagIds: detail.tagIds ?? [],
        seoTitle: detail.seoTitle ?? '',
        seoKeywords: detail.seoKeywords ?? '',
        seoDescription: detail.seoDescription ?? '',
        scheduledAt: detail.scheduledAt ?? undefined,
        extend: detail.extend ?? {},
      }
    : { channelId: channelIdParam, isTop: false, isRecommend: false, isHot: false, sort: 0, tagIds: [], extend: {} };

  async function save(): Promise<number | null> {
    if (!siteId) return null;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      return null;
    }
    const payload: Record<string, unknown> = { ...values, body };
    if (!values.slug) payload.slug = null;
    if (values.scheduledAt instanceof Date) payload.scheduledAt = formatDateTimeForApi(values.scheduledAt);
    if (!values.scheduledAt) payload.scheduledAt = null;
    if (!id) payload.siteId = siteId;
    const saved = await saveMutation.mutateAsync({ id, values: payload });
    return saved.id;
  }

  async function handleSaveDraft() {
    const savedId = await save();
    if (savedId) {
      Toast.success('保存成功');
      if (!id) navigate(`/cms/contents/edit?id=${savedId}&siteId=${siteId}`, { replace: true });
    }
  }

  async function handleSaveAndPublish() {
    const savedId = await save();
    if (savedId) {
      await actionMutation.mutateAsync({ id: savedId, action: 'publish' });
      Toast.success('已保存并发布');
      navigate(-1);
    }
  }

  const loading = (!!id && detailQuery.isFetching && !detail) || treeQuery.isLoading;

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16 }}>
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>返回</Button>
        <h3 style={{ margin: 0, flex: 1 }}>
          {id ? '编辑内容' : '新增内容'}
          {detail ? <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 'normal', color: 'var(--semi-color-text-2)' }}>状态：{CMS_CONTENT_STATUS_LABELS[detail.status]}</span> : null}
        </h3>
        <Button icon={<Save size={14} />} loading={saveMutation.isPending} onClick={() => void handleSaveDraft()}>保存</Button>
        {id ? (
          <Button icon={<History size={14} />} onClick={() => setVersionsVisible(true)}>历史版本</Button>
        ) : null}
        {hasPermission('cms:content:publish') ? (
          <Button type="primary" icon={<Send size={14} />} loading={actionMutation.isPending} onClick={() => void handleSaveAndPublish()}>保存并发布</Button>
        ) : null}
      </div>

      {detail?.status === 'rejected' && detail.rejectReason ? (
        <Banner type="danger" description={`驳回原因：${detail.rejectReason}`} style={{ marginBottom: 12 }} closeIcon={null} />
      ) : null}

      <Spin spinning={loading}>
        <Form
          key={detail?.id ?? 'new'}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={initValues}
          onValueChange={(values) => {
            if (values.channelId !== selectedChannelId) setSelectedChannelId(values.channelId as number);
          }}
          labelPosition="top"
        >
          <Row gutter={24}>
            {/* 左：主编辑区 */}
            <Col xs={24} lg={16}>
              <Form.Input field="title" label="标题" size="large" rules={[{ required: true, message: '请输入标题' }]} />
              <Form.TextArea field="summary" label="摘要" rows={2} placeholder="留空时前台自动截取正文" />
              <Form.Slot label="正文">
                <RichTextEditor value={body} onChange={setBody} height={420} />
              </Form.Slot>
              {modelFields.length > 0 ? (
                <Form.Section text={`模型字段（${currentModel?.name}）`}>
                  <Row gutter={16}>
                    {modelFields.map((f) => (
                      <Col key={f.name} span={f.fieldType === 'textarea' || f.fieldType === 'richtext' ? 24 : 12}>
                        <ModelFieldControl field={f} />
                      </Col>
                    ))}
                  </Row>
                </Form.Section>
              ) : null}
            </Col>
            {/* 右：属性面板 */}
            <Col xs={24} lg={8}>
              <Form.TreeSelect
                field="channelId"
                label="所属栏目"
                style={{ width: '100%' }}
                treeData={channelsToTree(treeQuery.data ?? [])}
                rules={[{ required: true, message: '请选择栏目' }]}
              />
              <Form.Select
                field="tagIds"
                label="标签"
                multiple
                style={{ width: '100%' }}
                optionList={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
              />
              <Row gutter={12}>
                <Col span={12}><Form.Input field="author" label="作者" /></Col>
                <Col span={12}><Form.Input field="source" label="来源" /></Col>
              </Row>
              <Form.Input field="coverImage" label="封面图 URL" placeholder="https://..." />
              <Form.Input field="slug" label="自定义 URL 标识" placeholder="留空使用 ID" />
              <Form.Input field="externalLink" label="外链地址" placeholder="填写后点击标题直接跳转" />
              <Row gutter={12}>
                <Col span={8}><Form.Switch field="isTop" label="置顶" /></Col>
                <Col span={8}><Form.Switch field="isRecommend" label="推荐" /></Col>
                <Col span={8}><Form.Switch field="isHot" label="热门" /></Col>
              </Row>
              <Form.InputNumber field="sort" label="排序权重" style={{ width: '100%' }} />
              <Form.DatePicker
                field="scheduledAt"
                label="定时发布"
                type="dateTime"
                density="compact"
                style={{ width: '100%' }}
                placeholder="到期自动发布（每分钟检查）"
              />
              <Form.Section text="SEO（留空继承栏目/站点）">
                <Form.Input field="seoTitle" label="SEO 标题" />
                <Form.Input field="seoKeywords" label="SEO 关键词" />
                <Form.TextArea field="seoDescription" label="SEO 描述" rows={2} />
              </Form.Section>
            </Col>
          </Row>
        </Form>
      </Spin>

      {/* 版本历史抽屉 */}
      <SideSheet title="历史版本" visible={versionsVisible} onCancel={() => setVersionsVisible(false)} width={420}>
        {versionsQuery.data && versionsQuery.data.length > 0 ? (
          <Timeline>
            {versionsQuery.data.map((v) => (
              <Timeline.Item key={v.id} time={v.createdAt}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b>v{v.version}</b>
                  <span style={{ flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                  <Button
                    size="small"
                    theme="borderless"
                    loading={restoreMutation.isPending}
                    onClick={() => {
                      Modal.confirm({
                        title: `回滚到 v${v.version}？`,
                        content: '当前内容将自动留档后被该版本覆盖',
                        onOk: async () => {
                          await restoreMutation.mutateAsync({ contentId: id!, versionId: v.id });
                          Toast.success('回滚成功');
                          setVersionsVisible(false);
                        },
                      });
                    }}
                  >
                    回滚
                  </Button>
                </div>
                <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>
                  {v.remark ?? ''}{v.createdByName ? ` · ${v.createdByName}` : ''}
                </div>
              </Timeline.Item>
            ))}
          </Timeline>
        ) : (
          <div style={{ color: 'var(--semi-color-text-2)', padding: 24, textAlign: 'center' }}>
            {versionsQuery.isFetching ? '加载中…' : '暂无历史版本（每次保存自动留档）'}
          </div>
        )}
      </SideSheet>
    </div>
  );
}
