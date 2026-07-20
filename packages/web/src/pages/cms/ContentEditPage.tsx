import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Form, Spin, Toast, Row, Col, Banner, SideSheet, Timeline, Modal, Upload, Typography, useFormApi } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { ArrowLeft, Save, Send, History, ImageUp, Eye, GitCompare, Images } from 'lucide-react';
import RichTextEditor from '@/components/RichTextEditor';
import { MediaPickerModal } from '@/components/MediaPickerModal';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { config as appConfig } from '@/config';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';
import {
  useCmsContentDetail, useCmsChannelTree, useAllCmsModels, useAllCmsTags,
  useSaveCmsContent, useCmsContentAction, useCmsContentVersions, useRestoreCmsContentVersion,
  useCmsVersionDiff, useCmsPreviewLink, acquireCmsEditLock, releaseCmsEditLock, useCmsContentList,
  useAllCmsSites, useCmsThemeTemplates,
} from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared';
import type { CmsChannel, CmsModelField, CmsEditLock } from '@zenith/shared';

const AUTO_SAVE_INTERVAL_MS = 30_000;
const EDIT_LOCK_HEARTBEAT_MS = 30_000;

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

/** image/file 型模型字段：输入框 + 媒体库选择按钮 */
function MediaFieldControl({ field }: Readonly<{ field: CmsModelField }>) {
  const formApi = useFormApi();
  const [pickerVisible, setPickerVisible] = useState(false);
  const rules = field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined;
  return (
    <>
      <Form.Input
        field={`extend.${field.name}`}
        label={field.label}
        rules={rules}
        placeholder={field.placeholder ?? '资源 URL（可从媒体库选择）'}
        suffix={(
          <Button size="small" theme="borderless" icon={<Images size={14} />} onClick={() => setPickerVisible(true)}>媒体库</Button>
        )}
      />
      <MediaPickerModal
        visible={pickerVisible}
        imageOnly={field.fieldType === 'image'}
        onCancel={() => setPickerVisible(false)}
        onSelect={(file) => {
          formApi.setValue(`extend.${field.name}`, file.url);
          setPickerVisible(false);
        }}
      />
    </>
  );
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
      return <MediaFieldControl field={field} />;
    default:
      return <Form.Input {...common} />;
  }
}

/** 版本差异值展示（布尔/对象友好化） */
function diffValueText(value: unknown): string {
  if (value === null || value === undefined || value === '') return '（空）';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
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
  // 相关文章候选：本站最近 100 条已发布内容
  const relatedCandidatesQuery = useCmsContentList(
    { page: 1, pageSize: 100, siteId: siteId ?? 0, status: 'published' },
    siteId !== undefined,
  );
  const saveMutation = useSaveCmsContent();
  const actionMutation = useCmsContentAction();
  const previewMutation = useCmsPreviewLink();

  const [body, setBody] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState<number | undefined>(channelIdParam);
  const [versionsVisible, setVersionsVisible] = useState(false);
  const versionsQuery = useCmsContentVersions(id, versionsVisible);
  const restoreMutation = useRestoreCmsContentVersion();
  const [diffVersionId, setDiffVersionId] = useState<number | undefined>(undefined);
  const diffQuery = useCmsVersionDiff(id, diffVersionId);
  const [coverPickerVisible, setCoverPickerVisible] = useState(false);

  // ─── 编辑锁 / 乐观锁 / 自动保存状态 ─────────────────────────────────────────
  const [lockHolder, setLockHolder] = useState<CmsEditLock['holder']>(null);
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const versionRef = useRef<number | undefined>(undefined);
  const detailStatusRef = useRef<string | undefined>(undefined);
  const bodyInitializedForRef = useRef<number | null>(null);
  const pendingFormResetRef = useRef(false);
  const [formEpoch, setFormEpoch] = useState(0);

  useEffect(() => {
    if (!detail) return;
    versionRef.current = detail.version;
    detailStatusRef.current = detail.status;
    // 版本回滚后强制重挂表单，加载最新字段值
    if (pendingFormResetRef.current) {
      pendingFormResetRef.current = false;
      bodyInitializedForRef.current = null;
      setFormEpoch((e) => e + 1);
    }
    // 正文只在首次加载（或回滚重置后）初始化，避免自动保存触发的 refetch 吞掉输入
    if (bodyInitializedForRef.current !== detail.id) {
      bodyInitializedForRef.current = detail.id;
      setBody(detail.body ?? '');
      setSelectedChannelId(detail.channelId);
    }
  }, [detail]);

  // 编辑锁：进入抢占 + 30s 心跳续期，离开释放（软锁，保存冲突由乐观锁兜底）
  useEffect(() => {
    if (!id) return;
    let stopped = false;
    const beat = () => {
      acquireCmsEditLock(id)
        .then((r) => { if (!stopped) setLockHolder(r.acquired ? null : r.holder); })
        .catch(() => undefined);
    };
    beat();
    const timer = setInterval(beat, EDIT_LOCK_HEARTBEAT_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
      void releaseCmsEditLock(id).catch(() => undefined);
    };
  }, [id]);

  const currentChannel = findChannel(treeQuery.data ?? [], selectedChannelId);
  const { data: allSites } = useAllCmsSites();
  const siteTheme = allSites?.find((s) => s.id === siteId)?.theme;
  const { data: themeTemplates } = useCmsThemeTemplates(siteTheme);
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
        detailTemplate: detail.detailTemplate ?? undefined,
        isTop: detail.isTop,
        isRecommend: detail.isRecommend,
        isHot: detail.isHot,
        sort: detail.sort,
        tagIds: detail.tagIds ?? [],
        extraChannelIds: detail.extraChannelIds ?? [],
        relatedIds: detail.relatedIds ?? [],
        seoTitle: detail.seoTitle ?? '',
        seoKeywords: detail.seoKeywords ?? '',
        seoDescription: detail.seoDescription ?? '',
        scheduledAt: detail.scheduledAt ?? undefined,
        expireAt: detail.expireAt ?? undefined,
        extend: detail.extend ?? {},
      }
    : { channelId: channelIdParam, isTop: false, isRecommend: false, isHot: false, sort: 0, tagIds: [], extraChannelIds: [], relatedIds: [], extend: {} };

  async function save(opts?: { silent?: boolean }): Promise<number | null> {
    if (!siteId) return null;
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      if (!opts?.silent) Toast.error('请完善必填项后再保存');
      return null;
    }
    const payload: Record<string, unknown> = { ...values, body };
    if (!values.slug) payload.slug = null;
    // 模板下拉清空后为 undefined，显式置 null 才能在更新时清除覆盖
    payload.detailTemplate = values.detailTemplate ?? null;
    if (values.scheduledAt instanceof Date) payload.scheduledAt = formatDateTimeForApi(values.scheduledAt);
    if (!values.scheduledAt) payload.scheduledAt = null;
    if (values.expireAt instanceof Date) payload.expireAt = formatDateTimeForApi(values.expireAt);
    if (!values.expireAt) payload.expireAt = null;
    if (!id) payload.siteId = siteId;
    // 乐观锁：携带读取时的版本号，被他人修改时后端返回 409
    if (id && versionRef.current !== undefined) payload.expectedVersion = versionRef.current;
    const wasDirty = dirtyRef.current;
    dirtyRef.current = false;
    try {
      const saved = await saveMutation.mutateAsync({ id, values: payload });
      versionRef.current = saved.version;
      detailStatusRef.current = saved.status;
      return saved.id;
    } catch (err) {
      dirtyRef.current = wasDirty;
      throw err;
    }
  }

  const saveRef = useRef(save);
  saveRef.current = save;

  // 自动保存：仅对已存在的草稿/驳回内容，有改动时每 30s 静默保存一次
  useEffect(() => {
    if (!id) return;
    const timer = setInterval(() => {
      if (!dirtyRef.current) return;
      const status = detailStatusRef.current;
      if (status !== 'draft' && status !== 'rejected') return;
      void saveRef.current({ silent: true })
        .then((savedId) => {
          if (savedId) setAutoSavedAt(new Date().toTimeString().slice(0, 8));
        })
        .catch(() => undefined);
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [id]);

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

  async function handlePreview() {
    if (!id) return;
    // 预览前把当前改动落库，保证预览即所见
    if (dirtyRef.current) {
      const savedId = await save({ silent: true }).catch(() => null);
      if (!savedId) {
        Toast.warning('存在未通过校验的字段，预览将展示最近一次保存的内容');
      }
    }
    const link = await previewMutation.mutateAsync(id);
    window.open(link.url, '_blank');
  }

  const loading = (!!id && detailQuery.isFetching && !detail) || treeQuery.isLoading;
  const diffVersion = (versionsQuery.data ?? []).find((v) => v.id === diffVersionId);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>返回</Button>
        <h3 style={{ margin: 0, flex: 1, minWidth: 200 }}>
          {id ? '编辑内容' : '新增内容'}
          {detail ? <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 'normal', color: 'var(--semi-color-text-2)' }}>状态：{CMS_CONTENT_STATUS_LABELS[detail.status]}</span> : null}
          {autoSavedAt ? <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 'normal', color: 'var(--semi-color-text-2)' }}>已自动保存 {autoSavedAt}</span> : null}
        </h3>
        <Button icon={<Save size={14} />} loading={saveMutation.isPending} onClick={() => void handleSaveDraft()}>保存</Button>
        {id ? (
          <>
            <Button icon={<Eye size={14} />} loading={previewMutation.isPending} onClick={() => void handlePreview()}>预览</Button>
            <Button icon={<History size={14} />} onClick={() => setVersionsVisible(true)}>历史版本</Button>
          </>
        ) : null}
        {hasPermission('cms:content:publish') ? (
          <Button type="primary" icon={<Send size={14} />} loading={actionMutation.isPending} onClick={() => void handleSaveAndPublish()}>保存并发布</Button>
        ) : null}
      </div>

      {lockHolder ? (
        <Banner
          type="warning"
          description={`${lockHolder.nickname} 正在编辑此内容（${lockHolder.lockedAt} 开始）。继续编辑可能相互覆盖：保存时系统会做版本冲突检测。`}
          style={{ marginBottom: 12 }}
          closeIcon={null}
        />
      ) : null}

      {detail?.status === 'rejected' && detail.rejectReason ? (
        <Banner type="danger" description={`驳回原因：${detail.rejectReason}`} style={{ marginBottom: 12 }} closeIcon={null} />
      ) : null}

      <Spin spinning={loading}>
        <Form
          key={`${detail?.id ?? 'new'}-${formEpoch}`}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          initValues={initValues}
          onValueChange={(values) => {
            dirtyRef.current = true;
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
                <RichTextEditor
                  value={body}
                  onChange={(v) => { setBody(v); dirtyRef.current = true; }}
                  height={420}
                  uploadServer={siteId ? `${appConfig.apiBaseUrl}/api/cms/upload-image?siteId=${siteId}` : undefined}
                />
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
              <Form.TreeSelect
                field="extraChannelIds"
                label="副栏目（一文多栏目）"
                multiple
                style={{ width: '100%' }}
                treeData={channelsToTree(treeQuery.data ?? [])}
                placeholder="同时展示在其他栏目（可选）"
              />
              <Form.Select
                field="tagIds"
                label="标签"
                multiple
                style={{ width: '100%' }}
                optionList={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
              />
              <Form.Select
                field="relatedIds"
                label="相关文章"
                multiple
                filter
                style={{ width: '100%' }}
                placeholder="手动指定相关阅读（不足自动按标签补齐）"
                optionList={(relatedCandidatesQuery.data?.list ?? [])
                  .filter((c) => c.id !== id)
                  .map((c) => ({ value: c.id, label: c.title }))}
              />
              <Row gutter={12}>
                <Col span={12}><Form.Input field="author" label="作者" /></Col>
                <Col span={12}><Form.Input field="source" label="来源" /></Col>
              </Row>
              <Form.Input
                field="coverImage"
                label="封面图 URL"
                placeholder="https://... 或从媒体库选择"
                suffix={(
                  <span style={{ display: 'inline-flex', gap: 2 }}>
                    <Button size="small" theme="borderless" icon={<Images size={14} />} onClick={() => setCoverPickerVisible(true)}>媒体库</Button>
                    <Upload
                      action=""
                      accept="image/*"
                      limit={1}
                      showUploadList={false}
                      customRequest={async ({ fileInstance, onSuccess, onError }) => {
                        if (!siteId) { onError?.({ status: 0 }); return; }
                        try {
                          const formData = new FormData();
                          formData.append('file', fileInstance);
                          const res = await request.postForm<{ url: string; watermarked: boolean }>(
                            `/api/cms/upload-image?siteId=${siteId}`, formData,
                          ).then(unwrap);
                          formApi.current?.setValue('coverImage', res.url);
                          dirtyRef.current = true;
                          Toast.success(res.watermarked ? '上传成功（已加水印）' : '上传成功');
                          onSuccess?.({});
                        } catch {
                          onError?.({ status: 0 });
                        }
                      }}
                    >
                      <Button size="small" theme="borderless" icon={<ImageUp size={14} />}>上传</Button>
                    </Upload>
                  </span>
                )}
              />
              <Form.Input field="slug" label="自定义 URL 标识" placeholder="留空使用 ID" />
              <Form.Input field="externalLink" label="外链地址" placeholder="填写后点击标题直接跳转" />
              <Form.Select field="detailTemplate" label="详情模板" style={{ width: '100%' }} showClear
                placeholder="跟随栏目/站点默认"
                optionList={(themeTemplates?.detail ?? []).map((t) => ({ value: t.name, label: t.label }))} />
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
              <Form.DatePicker
                field="expireAt"
                label="过期下线"
                type="dateTime"
                density="compact"
                style={{ width: '100%' }}
                placeholder="到期自动下线（留空永不过期）"
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

      {/* 封面图媒体库选择 */}
      <MediaPickerModal
        visible={coverPickerVisible}
        onCancel={() => setCoverPickerVisible(false)}
        onSelect={(file) => {
          formApi.current?.setValue('coverImage', file.url);
          dirtyRef.current = true;
          setCoverPickerVisible(false);
        }}
      />

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
                    icon={<GitCompare size={13} />}
                    onClick={() => setDiffVersionId(v.id)}
                  >
                    对比
                  </Button>
                  <Button
                    size="small"
                    theme="borderless"
                    loading={restoreMutation.isPending}
                    onClick={() => {
                      Modal.confirm({
                        title: `回滚到 v${v.version}？`,
                        content: '当前内容将自动留档后被该版本覆盖',
                        onOk: async () => {
                          pendingFormResetRef.current = true;
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

      {/* 版本差异对比 */}
      <Modal
        title={diffVersion ? `v${diffVersion.version} 与当前内容的差异` : '版本差异'}
        visible={diffVersionId !== undefined}
        onCancel={() => setDiffVersionId(undefined)}
        footer={null}
        width={760}
        closeOnEsc
      >
        <Spin spinning={diffQuery.isFetching}>
          {diffQuery.data && diffQuery.data.length > 0 ? (
            <div style={{ maxHeight: '60vh', overflow: 'auto' }}>
              {diffQuery.data.map((d) => (
                <div key={d.field} style={{ marginBottom: 16 }}>
                  <Typography.Title heading={6} style={{ marginBottom: 8 }}>{d.label}</Typography.Title>
                  <Row gutter={12}>
                    <Col span={12}>
                      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 4 }}>v{diffVersion?.version ?? ''}（历史版本）</div>
                      <pre style={{ margin: 0, padding: 8, background: 'var(--semi-color-danger-light-default)', borderRadius: 'var(--semi-border-radius-small)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                        {diffValueText(d.before)}
                      </pre>
                    </Col>
                    <Col span={12}>
                      <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginBottom: 4 }}>当前内容</div>
                      <pre style={{ margin: 0, padding: 8, background: 'var(--semi-color-success-light-default)', borderRadius: 'var(--semi-border-radius-small)', whiteSpace: 'pre-wrap', wordBreak: 'break-all', fontSize: 12, maxHeight: 200, overflow: 'auto' }}>
                        {diffValueText(d.after)}
                      </pre>
                    </Col>
                  </Row>
                </div>
              ))}
            </div>
          ) : (
            <div style={{ color: 'var(--semi-color-text-2)', padding: 24, textAlign: 'center' }}>
              {diffQuery.isFetching ? '对比中…' : '该版本与当前内容无差异'}
            </div>
          )}
        </Spin>
      </Modal>
    </div>
  );
}
