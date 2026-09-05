import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Form, Spin, Toast, Row, Col, Banner, SideSheet, Space, Timeline, Modal, Upload, Typography, useFormApi, Tag, Input, Tabs, TabPane } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ArrowLeft, Save, Send, History, ImageUp, Eye, GitCompare, Images, Paperclip, SpellCheck, ScrollText } from 'lucide-react';
import { MediaPickerModal } from '@/components/MediaPickerModal';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useUploadFile } from '@/hooks/queries/files';
import { config as appConfig } from '@/config';
import { confirmDanger } from '@/utils/confirm';
import {
  useCmsContentDetail, useCmsChannelTree, useAllCmsModels, useAllCmsTags,
  useSaveCmsContent, useCmsContentAction, useCmsContentVersions, useRestoreCmsContentVersion,
  useCmsVersionDiff, useCmsPreviewLink, acquireCmsEditLock, releaseCmsEditLock, useCmsContentList,
  useAllCmsSites, useCmsThemeTemplates, useCmsContentOpLogs, useCmsCheckText, useUploadCmsResource,
  useCheckCmsContentTitle, useUploadCmsImage, cmsImageUploadUrl,
} from '@/hooks/queries/cms';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_TYPE_LABELS, CMS_CONTENT_TYPES, CMS_TITLE_STYLE_COLORS } from '@zenith/shared/cms';
import type { CmsChannel, CmsModelField, CmsEditLock, CmsTextCheckResult, CmsContentType, CmsAlbumImage, CmsContentAttachment } from '@zenith/shared/cms';
import { useCmsLinkPicker } from './CmsLinkInput';
import { formatBytes } from '@zenith/shared/core';
import { channelsToSelectTree } from './channel-tree';
import './ContentEditPage.css';

// 富文本引擎（wangeditor）压缩后约 266 KB。静态导入会阻塞整个编辑页 chunk 的加载，
// 且「链接」类型内容与已映射内容根本不渲染编辑器；改为懒加载后表单先出，编辑器再补。
const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));
const editorLoadingFallback = (
  <div
    style={{
      height: 420,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      border: '1px solid var(--semi-color-border)',
      borderRadius: 'var(--semi-border-radius-small)',
    }}
  >
    <Spin />
  </div>
);

const AUTO_SAVE_INTERVAL_MS = 30_000;
const EDIT_LOCK_HEARTBEAT_MS = 30_000;

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
function MediaFieldControl({ field, canUpload }: Readonly<{ field: CmsModelField; canUpload: boolean }>) {
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
          <Button size="small" theme="borderless" icon={<Images size={14} />} disabled={!canUpload} onClick={() => setPickerVisible(true)}>媒体库</Button>
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

/**
 * 字段可选项：优先用服务端解析后的 resolvedOptions（字典来源已展开），
 * 回落 options 兼容尚未返回 resolvedOptions 的旧接口响应。
 */
function fieldOptions(field: CmsModelField): { label: string; value: string }[] {
  return field.resolvedOptions ?? field.options ?? [];
}

/** 解析模型字段 defaultValue 为表单控件初值（与服务端 applyCmsModelFieldDefaults 同一口径） */
function parseFieldDefault(field: CmsModelField): unknown {
  const raw = field.defaultValue?.trim();
  if (!raw) return undefined;
  switch (field.fieldType) {
    case 'switch':
      return raw === 'true';
    case 'checkbox': {
      if (raw.startsWith('[')) {
        try {
          const parsed: unknown = JSON.parse(raw);
          return Array.isArray(parsed) ? parsed.map(String) : [raw];
        } catch {
          return [raw];
        }
      }
      return raw.split(',').map((v) => v.trim()).filter(Boolean);
    }
    case 'number': {
      const num = Number(raw);
      return Number.isNaN(num) ? undefined : num;
    }
    default:
      return raw;
  }
}

/** 按模型字段元数据渲染动态表单控件（值写入 extend.{name}）；applyDefault 仅新建内容时生效 */
function ModelFieldControl({ field, applyDefault, canUpload }: Readonly<{ field: CmsModelField; applyDefault?: boolean; canUpload: boolean }>) {
  const f = `extend.${field.name}`;
  // 必填不挂表单 rules：草稿保存必须放行缺失的模型必填（写一半先存是常态），
  // 提审/发布时由服务端按模型定义强校验并给出逐字段错误提示
  const initValue = applyDefault ? parseFieldDefault(field) : undefined;
  const common = {
    field: f,
    label: field.required ? `${field.label}（发布必填）` : field.label,
    placeholder: field.placeholder ?? undefined,
    ...(initValue !== undefined ? { initValue } : {}),
  };
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
      return <Form.Select {...common} style={{ width: '100%' }} optionList={fieldOptions(field)} showClear />;
    case 'radio':
      return (
        <Form.RadioGroup {...common}>
          {fieldOptions(field).map((o) => <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>)}
        </Form.RadioGroup>
      );
    case 'checkbox':
      return <Form.CheckboxGroup {...common} options={fieldOptions(field)} direction="horizontal" />;
    case 'switch':
      return <Form.Switch {...common} />;
    case 'image':
    case 'file':
      return <MediaFieldControl field={field} canUpload={canUpload} />;
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

/** 右侧属性面板字段 → 所属标签页，校验失败时自动切到出错分组 */
const SIDE_TAB_BY_FIELD: Record<string, string> = {
  channelId: 'basic', title: 'basic', subTitle: 'basic', shortTitle: 'basic', summary: 'basic',
  tagIds: 'basic', coverImage: 'basic', isTop: 'basic', isOriginal: 'basic', isRecommend: 'basic', isHot: 'basic',
  extraChannelIds: 'attribution', relatedIds: 'attribution',
  author: 'attribution', editor: 'attribution', source: 'attribution', sourceUrl: 'attribution',
  seoTitle: 'seo', seoKeywords: 'seo', seoDescription: 'seo', socialImageAlt: 'seo', twitterCreator: 'seo',
  topWeight: 'schedule', topExpireAt: 'schedule', sort: 'schedule', scheduledAt: 'schedule', expireAt: 'schedule',
  slug: 'advanced', detailTemplate: 'advanced',
};

/** 展平 Semi 校验错误对象（含 extend.xxx 嵌套），提取字段路径与提示文案 */
function flattenFormErrors(errors: unknown, prefix = ''): { field: string; message: string }[] {
  if (!errors || typeof errors !== 'object') return [];
  return Object.entries(errors as Record<string, unknown>).flatMap(([key, value]) => {
    const field = prefix ? `${prefix}.${key}` : key;
    if (typeof value === 'string') return value ? [{ field, message: value }] : [];
    if (value && typeof value === 'object') return flattenFormErrors(value, field);
    return [];
  });
}

export default function ContentEditPage() {
  const { hasPermission } = usePermission();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const formApi = useRef<FormApi | null>(null);
  const uploadCmsImage = useUploadCmsImage();

  const id = searchParams.get('id') ? Number(searchParams.get('id')) : undefined;
  const siteIdParam = searchParams.get('siteId') ? Number(searchParams.get('siteId')) : undefined;
  const channelIdParam = searchParams.get('channelId') ? Number(searchParams.get('channelId')) : undefined;
  // 内容形态由列表页「新增」分裂按钮指定，创建后不可变更
  const contentTypeParam = searchParams.get('contentType');
  const newContentType: CmsContentType = CMS_CONTENT_TYPES.includes(contentTypeParam as CmsContentType)
    ? (contentTypeParam as CmsContentType)
    : 'article';

  const detailQuery = useCmsContentDetail(id);
  const detail = detailQuery.data;
  const siteId = detail?.siteId ?? siteIdParam;

  const treeQuery = useCmsChannelTree(siteId);
  const { data: models } = useAllCmsModels(siteId);
  const { data: tags } = useAllCmsTags(siteId);
  // 相关文章候选：本站最近 100 条已发布内容
  const relatedCandidatesQuery = useCmsContentList(
    { page: 1, pageSize: 100, siteId: siteId ?? 0, status: 'published' },
    siteId !== undefined,
  );
  const saveMutation = useSaveCmsContent();
  const actionMutation = useCmsContentAction();
  const previewMutation = useCmsPreviewLink();
  const uploadMediaMutation = useUploadFile();
  const uploadResourceMutation = useUploadCmsResource();
  const canUploadResources = hasPermission('cms:resource:upload');

  // P4 标题查重：失焦时同站查重提示（不阻断保存）
  const lastCheckedTitle = useRef('');
  const checkTitleMutation = useCheckCmsContentTitle();
  async function checkTitleDuplicate() {
    const title = String(formApi.current?.getValue('title') ?? '').trim();
    if (!title || !siteId || title === lastCheckedTitle.current) return;
    lastCheckedTitle.current = title;
    try {
      const res = await checkTitleMutation.mutateAsync({ query: { siteId, title, excludeId: id ? Number(id) : undefined } });
      if (res?.duplicate) {
        Toast.warning({ content: `本站已存在 ${res.matches.length} 条同名内容（如 #${res.matches[0].id}），请确认是否重复发布`, duration: 5 });
      }
    } catch {
      // 查重失败静默忽略（编辑辅助功能）
    }
  }

  const [body, setBody] = useState('');
  const [selectedChannelId, setSelectedChannelId] = useState<number | undefined>(channelIdParam);
  // 链接字段的镜像值：仅用于回显解析出的内部链接目标名（真值仍在 Form 里）
  const [externalLink, setExternalLink] = useState('');
  const contentType: CmsContentType = detail?.contentType ?? newContentType;
  // 图集图片（受控管理，保存时并入 mediaData.images）
  const [albumImages, setAlbumImages] = useState<CmsAlbumImage[]>([]);
  // 正文附件（受控管理，保存时随 payload.attachments 提交）
  const [attachments, setAttachments] = useState<CmsContentAttachment[]>([]);
  const [albumPickerVisible, setAlbumPickerVisible] = useState(false);
  const [versionsVisible, setVersionsVisible] = useState(false);
  const versionsQuery = useCmsContentVersions(id, versionsVisible);
  const restoreMutation = useRestoreCmsContentVersion();
  const [diffVersionId, setDiffVersionId] = useState<number | undefined>(undefined);
  const diffQuery = useCmsVersionDiff(id, diffVersionId);
  const [coverPickerVisible, setCoverPickerVisible] = useState(false);
  // 右侧属性面板当前标签页（受控：校验失败时自动切到出错分组）
  const [sideTab, setSideTab] = useState('basic');
  const [opLogsVisible, setOpLogsVisible] = useState(false);
  const opLogsQuery = useCmsContentOpLogs(id, opLogsVisible);
  const checkMutation = useCmsCheckText();
  const [checkResult, setCheckResult] = useState<CmsTextCheckResult | null>(null);
  const [checkModalVisible, setCheckModalVisible] = useState(false);
  const isMapped = !!detail?.mappingSourceId;
  const isPersistentlyLocked = !!detail?.lockedAt;
  const canUpdateContent = id ? hasPermission('cms:content:update') : hasPermission('cms:content:create');
  const isReadOnly = isPersistentlyLocked || !canUpdateContent;

  const linkPicker = useCmsLinkPicker({
    siteId,
    value: externalLink,
    disabled: isPersistentlyLocked,
    excludeContentId: id,
    onPick: (next) => {
      formApi.current?.setValue('externalLink', next);
      setExternalLink(next);
      dirtyRef.current = true;
    },
  });

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
      setExternalLink(detail.externalLink ?? '');
      setAlbumImages(Array.isArray(detail.mediaData?.images) ? detail.mediaData.images.map((img) => ({ ...img })) : []);
      setAttachments(Array.isArray(detail.attachments) ? detail.attachments.map((a) => ({ ...a })) : []);
    }
  }, [detail]);

  // 编辑锁：进入抢占 + 30s 心跳续期，离开释放（软锁，保存冲突由乐观锁兜底）
  useEffect(() => {
    if (!id || !detail || isPersistentlyLocked) return;
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
  }, [detail, id, isPersistentlyLocked]);

  const currentChannel = findChannel(treeQuery.data ?? [], selectedChannelId);
  const { data: allSites } = useAllCmsSites();
  const selectedSite = allSites?.find((site) => site.id === siteId);
  const siteTheme = selectedSite?.effectiveTheme ?? selectedSite?.theme;
  const { data: themeTemplates } = useCmsThemeTemplates(siteTheme, siteId || undefined);
  const currentModel = useMemo(
    () => (models ?? []).find((m) => m.id === (currentChannel?.modelId ?? detail?.modelId)),
    [models, currentChannel, detail],
  );
  const modelFields = currentModel?.fields ?? [];

  /** 模板试穿：以选中详情模板打开预览（?__template= 仅预览路径生效，不影响线上） */
  function handleTemplateTryOn() {
    if (!detail || detail.status !== 'published') {
      Toast.info('仅已发布内容支持模板试穿；草稿请先用「预览」生成预览链接查看');
      return;
    }
    if (!detail.previewUrl) {
      Toast.warning('当前内容暂无可用的预览地址');
      return;
    }
    const tpl = (formApi.current?.getValue('detailTemplate') as string | undefined) ?? '';
    const query = tpl ? `?__template=${encodeURIComponent(tpl)}` : '';
    window.open(`${detail.previewUrl}${query}`, '_blank');
  }

  const initValues = detail
    ? {
        channelId: detail.channelId,
        title: detail.title,
        subTitle: detail.subTitle ?? '',
        shortTitle: detail.shortTitle ?? '',
        slug: detail.slug ?? '',
        staticPath: detail.staticPath ?? '',
        titleBold: detail.titleStyle?.bold ?? false,
        titleColor: detail.titleStyle?.color ?? '',
        summary: detail.summary ?? '',
        coverImage: detail.coverImage ?? '',
        author: detail.author ?? '',
        editor: detail.editor ?? '',
        source: detail.source ?? '',
        sourceUrl: detail.sourceUrl ?? '',
        isOriginal: detail.isOriginal,
        externalLink: detail.externalLink ?? '',
        detailTemplate: detail.detailTemplate ?? undefined,
        isTop: detail.isTop,
        topWeight: detail.topWeight,
        topExpireAt: detail.topExpireAt ?? undefined,
        isRecommend: detail.isRecommend,
        isHot: detail.isHot,
        sort: detail.sort,
        tagIds: detail.tagIds ?? [],
        extraChannelIds: detail.extraChannelIds ?? [],
        relatedIds: detail.relatedIds ?? [],
        seoTitle: detail.seoTitle ?? '',
        seoKeywords: detail.seoKeywords ?? '',
        seoDescription: detail.seoDescription ?? '',
        socialImageAlt: detail.socialImageAlt ?? '',
        twitterCreator: detail.twitterCreator ?? '',
        scheduledAt: detail.scheduledAt ?? undefined,
        expireAt: detail.expireAt ?? undefined,
        extend: detail.extend ?? {},
        mediaType: detail.mediaData?.mediaType ?? 'video',
        mediaUrl: detail.mediaData?.mediaUrl ?? '',
        mediaPoster: detail.mediaData?.poster ?? '',
        mediaDuration: detail.mediaData?.duration ?? '',
      }
    : { channelId: channelIdParam, isTop: false, topWeight: 0, isOriginal: false, isRecommend: false, isHot: false, sort: 0, tagIds: [], extraChannelIds: [], relatedIds: [], extend: {}, mediaType: 'video', titleBold: false, titleColor: '' };

  async function save(opts?: { silent?: boolean }): Promise<number | null> {
    if (isPersistentlyLocked) {
      if (!opts?.silent) Toast.warning('内容已被持久锁定，当前页面为只读状态');
      return null;
    }
    if (!siteId) {
      if (!opts?.silent) Toast.error('未指定所属站点，请从内容列表进入编辑页');
      return null;
    }
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch (err) {
      if (!opts?.silent) {
        const issues = flattenFormErrors(err);
        // 出错字段可能藏在未激活的属性面板标签页里，自动切过去
        // （link 型的外链地址在左侧主区域常驻可见，无需切换）
        const firstTab = issues.map(({ field }) => (
          field === 'externalLink'
            ? (contentType === 'link' ? undefined : 'advanced')
            : SIDE_TAB_BY_FIELD[field]
        )).find(Boolean);
        if (firstTab) setSideTab(firstTab);
        const hints = issues.slice(0, 3).map((i) => i.message).join('；');
        Toast.error({
          content: hints ? `请完善必填项：${hints}${issues.length > 3 ? ' 等' : ''}` : '请完善必填项后再保存',
          duration: 4,
        });
      }
      return null;
    }
    const payload: Record<string, unknown> = { ...values, body };
    if (!values.slug) payload.slug = null;
    payload.staticPath = values.staticPath ? String(values.staticPath).trim() : null;
    // 标题样式：两个表单字段合成 titleStyle JSON（都为空时提交空对象，回落主题默认）
    payload.titleStyle = {
      ...(values.titleBold ? { bold: true } : {}),
      ...(values.titleColor ? { color: String(values.titleColor) } : {}),
    };
    delete payload.titleBold;
    delete payload.titleColor;
    payload.attachments = attachments;
    payload.twitterCreator = values.twitterCreator ? String(values.twitterCreator).trim() : null;
    payload.socialImageAlt = values.socialImageAlt ? String(values.socialImageAlt).trim() : null;
    // 模板下拉清空后为 undefined，显式置 null 才能在更新时清除覆盖
    payload.detailTemplate = values.detailTemplate ?? null;
    if (values.scheduledAt instanceof Date) payload.scheduledAt = formatDateTimeForApi(values.scheduledAt);
    if (!values.scheduledAt) payload.scheduledAt = null;
    if (values.expireAt instanceof Date) payload.expireAt = formatDateTimeForApi(values.expireAt);
    if (!values.expireAt) payload.expireAt = null;
    if (values.topExpireAt instanceof Date) payload.topExpireAt = formatDateTimeForApi(values.topExpireAt);
    if (!values.topExpireAt) payload.topExpireAt = null;
    // 内容形态：新建时提交；mediaType 等临时字段组装进 mediaData 后从 payload 移除
    if (!id) payload.contentType = contentType;
    if (contentType === 'album') {
      payload.mediaData = { images: albumImages };
    } else if (contentType === 'media') {
      payload.mediaData = {
        mediaType: (values.mediaType as string) || 'video',
        ...(values.mediaUrl ? { mediaUrl: String(values.mediaUrl) } : {}),
        ...(values.mediaPoster ? { poster: String(values.mediaPoster) } : {}),
        ...(values.mediaDuration ? { duration: String(values.mediaDuration) } : {}),
      };
    } else {
      payload.mediaData = {};
    }
    delete payload.mediaType;
    delete payload.mediaUrl;
    delete payload.mediaPoster;
    delete payload.mediaDuration;
    // 映射内容：正文/扩展字段共享来源，不随保存提交（服务端也会拒绝）
    if (isMapped) {
      delete payload.body;
      delete payload.extend;
    }
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
    if (!id || isPersistentlyLocked) return;
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
  }, [id, isPersistentlyLocked]);

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
    // 新建内容需先落库拿到 id；已存在内容有改动时先静默保存，保证「预览即所见」
    let previewId = id;
    if (!previewId || dirtyRef.current) {
      const savedId = await save(previewId ? { silent: true } : undefined).catch(() => null);
      if (savedId) {
        previewId = savedId;
        if (!id) navigate(`/cms/contents/edit?id=${savedId}&siteId=${siteId}`, { replace: true });
      } else if (previewId) {
        Toast.warning('存在未通过校验的字段，预览将展示最近一次保存的内容');
      } else {
        // 新建且保存未通过：save() 已给出校验反馈，无内容可预览
        return;
      }
    }
    const link = await previewMutation.mutateAsync({ params: { id: previewId } });
    window.open(link.url, '_blank');
  }

  // ─── 词库检查（敏感词 + 易错词）────────────────────────────────────────────
  function collectCheckText(): string {
    const values = formApi.current?.getValues() ?? {};
    const plainBody = body.replace(/<[^>]+>/g, ' ');
    return [values.title, values.subTitle, values.summary, plainBody].filter(Boolean).join('\n');
  }

  async function handleCheckText() {
    const result = await checkMutation.mutateAsync({ body: { text: collectCheckText() } });
    setCheckResult(result);
    setCheckModalVisible(true);
  }

  /** 易错词一键替换：作用于标题/副标题/摘要/正文 */
  function applyCorrection(word: string, correction: string) {
    const api = formApi.current;
    if (!api) return;
    for (const field of ['title', 'subTitle', 'summary'] as const) {
      const v = api.getValue(field);
      if (typeof v === 'string' && v.includes(word)) api.setValue(field, v.replaceAll(word, correction));
    }
    if (body.includes(word)) setBody(body.replaceAll(word, correction));
    dirtyRef.current = true;
    setCheckResult((prev) => prev ? { ...prev, errorProne: prev.errorProne.filter((h) => h.word !== word) } : prev);
    Toast.success(`已替换「${word}」→「${correction}」`);
  }

  const loading = (!!id && detailQuery.isFetching && !detail) || treeQuery.isLoading;
  const diffVersion = (versionsQuery.data ?? []).find((v) => v.id === diffVersionId);

  return (
    <div className="page-container cms-content-edit">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>返回</Button>
        <h3 style={{ margin: 0, flex: 1, minWidth: 200 }}>
          {id ? '编辑内容' : '新增内容'}
          <Tag size="small" color="blue" style={{ marginLeft: 12, verticalAlign: 'middle' }}>{CMS_CONTENT_TYPE_LABELS[contentType]}</Tag>
          {detail ? <span style={{ marginLeft: 12, fontSize: 13, fontWeight: 'normal', color: 'var(--semi-color-text-2)' }}>状态：{CMS_CONTENT_STATUS_LABELS[detail.status]}</span> : null}
          {autoSavedAt ? <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 'normal', color: 'var(--semi-color-text-2)' }}>已自动保存 {autoSavedAt}</span> : null}
        </h3>
        <Button icon={<Save size={14} />} loading={saveMutation.isPending} disabled={isReadOnly} onClick={() => void handleSaveDraft()}>保存</Button>
        <Button icon={<SpellCheck size={14} />} loading={checkMutation.isPending} onClick={() => void handleCheckText()}>内容检查</Button>
        <Button icon={<Eye size={14} />} loading={previewMutation.isPending || saveMutation.isPending} onClick={() => void handlePreview()}>预览</Button>
        {id ? (
          <>
            <Button icon={<History size={14} />} onClick={() => setVersionsVisible(true)}>历史版本</Button>
            <Button icon={<ScrollText size={14} />} onClick={() => setOpLogsVisible(true)}>操作记录</Button>
          </>
        ) : null}
        {hasPermission('cms:content:publish') ? (
          <Button type="primary" icon={<Send size={14} />} loading={actionMutation.isPending} disabled={isReadOnly} onClick={() => void handleSaveAndPublish()}>保存并发布</Button>
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

      {isPersistentlyLocked ? (
        <Banner
          type="danger"
          description={`内容已被持久锁定${detail?.lockedByName ? `（操作人：${detail.lockedByName}）` : ''}${detail?.lockReason ? `：${detail.lockReason}` : ''}。当前仅允许读取、预览和查看历史记录。`}
          style={{ marginBottom: 12 }}
          closeIcon={null}
        />
      ) : null}

      {!canUpdateContent ? (
        <Banner
          type="warning"
          description="当前账号没有内容编辑权限，本页以只读模式打开。"
          style={{ marginBottom: 12 }}
          closeIcon={null}
        />
      ) : null}

      {isMapped ? (
        <Banner
          type="info"
          description={`本内容为映射内容（来源：${detail?.mappingSourceTitle ?? `#${detail?.mappingSourceId}`}）。正文与扩展字段共享来源内容并随其更新，此处不可编辑；如需独立编辑请使用「复制」创建副本。`}
          style={{ marginBottom: 12 }}
          closeIcon={null}
        />
      ) : null}

      {detail?.status === 'rejected' && detail.rejectReason ? (
        <Banner type="danger" description={`驳回原因：${detail.rejectReason}`} style={{ marginBottom: 12 }} closeIcon={null} />
      ) : null}

      <Spin spinning={loading} wrapperClassName="cms-content-edit__spin">
        <Form
          key={`${detail?.id ?? 'new'}-${formEpoch}`}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          disabled={isReadOnly}
          initValues={initValues}
          onValueChange={(values) => {
            dirtyRef.current = true;
            if (values.channelId !== selectedChannelId) setSelectedChannelId(values.channelId as number);
            setExternalLink((values.externalLink as string) ?? '');
          }}
          labelPosition="top"
          className="cms-content-edit__form"
        >
          <div className="cms-content-edit__cols">
            {/* 左：正文主编辑区（宽屏下独立滚动） */}
            <div className="cms-content-edit__main">
              {contentType === 'link' ? (
                <>
                  <Banner type="info" closeIcon={null} style={{ marginBottom: 12 }} description="链接型内容：前台列表点击标题直接跳转，不生成详情页。可手输外链，也可用右侧「内部链接」选择站内内容/栏目（目标改 slug 或换栏目时链接自动跟随）。" />
                  <Form.Input
                    field="externalLink"
                    label="链接地址"
                    size="large"
                    placeholder="https://… 或点右侧「内部链接」选择站内内容/栏目"
                    rules={[{ required: true, message: '链接型内容须填写链接地址' }]}
                    suffix={linkPicker.suffix}
                  />
                  {linkPicker.hint}
                </>
              ) : null}
              {contentType === 'album' && !isMapped ? (
                <Form.Slot label={`图集图片（${albumImages.length}）`}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {albumImages.map((img, i) => (
                      <div key={`${img.url}-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 8, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 8 }}>
                        <img src={img.thumb ?? img.url} alt="" style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-small)', flexShrink: 0 }} />
                        <Input
                          placeholder="图片说明（可选）"
                          value={img.caption ?? ''}
                          disabled={isReadOnly}
                          onChange={(v) => {
                            setAlbumImages((list) => list.map((x, xi) => xi === i ? { ...x, caption: v || null } : x));
                            dirtyRef.current = true;
                          }}
                          style={{ flex: 1 }}
                        />
                        <Button size="small" theme="borderless" disabled={isReadOnly || i === 0}
                          onClick={() => { setAlbumImages((list) => { const next = [...list]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; }); dirtyRef.current = true; }}>上移</Button>
                        <Button size="small" theme="borderless" disabled={isReadOnly || i === albumImages.length - 1}
                          onClick={() => { setAlbumImages((list) => { const next = [...list]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next; }); dirtyRef.current = true; }}>下移</Button>
                        <Button size="small" theme="borderless" type="danger" disabled={isReadOnly}
                          onClick={() => { setAlbumImages((list) => list.filter((_, xi) => xi !== i)); dirtyRef.current = true; }}>删除</Button>
                      </div>
                    ))}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <Upload
                        action=""
                        accept="image/*"
                        multiple
                        limit={20}
                        showUploadList={false}
                        disabled={isReadOnly || !canUploadResources}
                        customRequest={async ({ fileInstance, onSuccess, onError }) => {
                          if (!siteId) { onError?.({ status: 0 }); return; }
                          try {
                            const formData = new FormData();
                            formData.append('file', fileInstance);
                            const res = await uploadCmsImage.mutateAsync({ siteId, formData });
                            setAlbumImages((list) => [...list, { url: res.url, thumb: res.thumbUrl ?? null, caption: null }]);
                            dirtyRef.current = true;
                            onSuccess?.({});
                          } catch {
                            onError?.({ status: 0 });
                          }
                        }}
                      >
                        <Button icon={<ImageUp size={14} />}>上传图片</Button>
                      </Upload>
                      <Button icon={<Images size={14} />} disabled={isReadOnly || !canUploadResources} onClick={() => setAlbumPickerVisible(true)}>媒体库添加</Button>
                    </div>
                  </div>
                </Form.Slot>
              ) : null}
              {contentType === 'media' && !isMapped ? (
                <Form.Section text="音视频">
                  <Row gutter={12}>
                    <Col span={12}>
                      <Form.RadioGroup field="mediaType" label="媒体类型">
                        <Form.Radio value="video">视频</Form.Radio>
                        <Form.Radio value="audio">音频</Form.Radio>
                      </Form.RadioGroup>
                    </Col>
                    <Col span={12}><Form.Input field="mediaDuration" label="时长" placeholder="如 03:45（可选）" /></Col>
                    <Col span={24}>
                      <Form.Input
                        field="mediaUrl"
                        label="媒体地址"
                        placeholder="https://...（发布前必填）"
                        suffix={(
                          <Upload
                            action=""
                            accept="video/*,audio/*"
                            limit={1}
                            showUploadList={false}
                            disabled={isReadOnly || !canUploadResources}
                            customRequest={async ({ fileInstance, onSuccess, onError }) => {
                              try {
                                const uploaded = await uploadMediaMutation.mutateAsync({ formData: (() => { const fd = new FormData(); fd.append('file', fileInstance); return fd; })() });
                                // 多文件上传接口返回数组；此处每次只传一个文件
                                formApi.current?.setValue('mediaUrl', uploaded[0]?.url ?? '');
                                dirtyRef.current = true;
                                Toast.success('上传成功');
                                onSuccess?.({});
                              } catch {
                                onError?.({ status: 0 });
                              }
                            }}
                          >
                            <Button size="small" theme="borderless" icon={<ImageUp size={14} />} loading={uploadMediaMutation.isPending} disabled={isReadOnly || !canUploadResources}>上传</Button>
                          </Upload>
                        )}
                      />
                    </Col>
                    <Col span={24}><Form.Input field="mediaPoster" label="封面海报 URL" placeholder="视频封面（可选，留空用封面图）" /></Col>
                  </Row>
                </Form.Section>
              ) : null}
              {contentType !== 'link' ? (
                <Form.Slot noLabel>
                  {isMapped ? (
                    <div
                      style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', padding: 16, maxHeight: 420, overflow: 'auto', background: 'var(--semi-color-fill-0)' }}
                      dangerouslySetInnerHTML={{ __html: body }}
                    />
                  ) : (
                    <Suspense fallback={editorLoadingFallback}>
                      <RichTextEditor
                        value={body}
                        onChange={(v) => { setBody(v); dirtyRef.current = true; }}
                        readOnly={isReadOnly}
                        height={contentType === 'article' ? 420 : 240}
                        enablePageBreak={contentType === 'article'}
                        placeholder={contentType === 'article' ? '请输入正文内容...' : '图文说明（可选）'}
                        uploadServer={siteId && canUploadResources ? `${appConfig.apiBaseUrl}${cmsImageUploadUrl(siteId)}` : undefined}
                      />
                    </Suspense>
                  )}
                </Form.Slot>
              ) : null}
              {contentType !== 'link' ? (
                <Form.Section text={`附件（${attachments.length}）`}>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {attachments.map((att, i) => (
                      <div key={`${att.url}-${i}`} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <Tag size="small">{att.ext ? att.ext.toUpperCase() : '文件'}</Tag>
                        <Input
                          size="small"
                          placeholder="附件显示名称"
                          value={att.name}
                          disabled={isReadOnly}
                          onChange={(v) => {
                            setAttachments((list) => list.map((x, xi) => xi === i ? { ...x, name: v } : x));
                            dirtyRef.current = true;
                          }}
                          style={{ flex: 1, minWidth: 180 }}
                        />
                        <Typography.Text type="tertiary" size="small" style={{ flexShrink: 0 }}>
                          {att.size > 0 ? formatBytes(att.size) : '—'}
                        </Typography.Text>
                        <Button size="small" theme="borderless" disabled={i === 0 || isReadOnly}
                          onClick={() => { setAttachments((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n.map((x, xi) => ({ ...x, sort: xi })); }); dirtyRef.current = true; }}>上移</Button>
                        <Button size="small" theme="borderless" disabled={i === attachments.length - 1 || isReadOnly}
                          onClick={() => { setAttachments((l) => { const n = [...l]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n.map((x, xi) => ({ ...x, sort: xi })); }); dirtyRef.current = true; }}>下移</Button>
                        <Button size="small" theme="borderless" type="danger" disabled={isReadOnly}
                          onClick={() => { setAttachments((l) => l.filter((_, xi) => xi !== i).map((x, xi) => ({ ...x, sort: xi }))); dirtyRef.current = true; }}>删除</Button>
                      </div>
                    ))}
                    <div>
                      <Upload
                        action=""
                        multiple
                        limit={20}
                        showUploadList={false}
                        disabled={isReadOnly || !canUploadResources}
                        customRequest={async ({ fileInstance, onSuccess, onError }) => {
                          if (!siteId) { onError?.({ status: 0 }); return; }
                          try {
                            const uploaded = await uploadResourceMutation.mutateAsync({ siteId, file: fileInstance });
                            setAttachments((list) => [...list, {
                              name: fileInstance.name,
                              url: uploaded.url ?? '',
                              size: fileInstance.size ?? 0,
                              ext: (fileInstance.name.split('.').pop() ?? '').toLowerCase(),
                              sort: list.length,
                            }]);
                            dirtyRef.current = true;
                            onSuccess?.({});
                          } catch {
                            onError?.({ status: 0 });
                          }
                        }}
                      >
                        <Button icon={<Paperclip size={14} />} loading={uploadResourceMutation.isPending} disabled={isReadOnly || !canUploadResources}>上传附件</Button>
                      </Upload>
                    </div>
                  </div>
                </Form.Section>
              ) : null}
              {modelFields.length > 0 && !isMapped ? (
                <Form.Section text={`模型字段（${currentModel?.name}）`}>
                  <Row gutter={16}>
                    {modelFields.map((f) => (
                      <Col key={f.name} span={f.fieldType === 'textarea' || f.fieldType === 'richtext' ? 24 : 12}>
                        <ModelFieldControl field={f} applyDefault={!detail} canUpload={canUploadResources} />
                      </Col>
                    ))}
                  </Row>
                </Form.Section>
              ) : null}
            </div>
            {/* 右：基本信息面板 —— 横向标签页分组（宽屏下独立滚动） */}
            <div className="cms-content-edit__side">
              <Tabs type="line" size="small" collapsible="auto" activeKey={sideTab} onChange={setSideTab}>
                <TabPane tab="基础信息" itemKey="basic">
                  <Form.TreeSelect
                    field="channelId"
                    label="所属栏目"
                    size="small"
                    style={{ width: '100%' }}
                    treeData={channelsToSelectTree(treeQuery.data ?? [])}
                    rules={[{ required: true, message: '请选择栏目' }]}
                  />
                  <Form.Input
                    field="title" label="标题" size="small"
                    rules={[{ required: true, message: '请输入标题' }]}
                    onBlur={() => void checkTitleDuplicate()}
                  />
                  <Form.Slot label="标题样式">
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                      <Form.Switch field="titleBold" noLabel size="small" />
                      <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>加粗</span>
                      <Form.Select field="titleColor" noLabel size="small" showClear style={{ width: 132 }} placeholder="默认色"
                        optionList={CMS_TITLE_STYLE_COLORS.map((c) => ({ value: c, label: c }))}
                        renderSelectedItem={(o: { value?: unknown }) => (
                          <Space spacing={6}>
                            <i style={{ width: 10, height: 10, borderRadius: 'var(--semi-border-radius-small)', background: String(o.value) }} />
                            {String(o.value)}
                          </Space>
                        )}
                        renderOptionItem={({ value, onClick, selected }) => (
                          <div
                            role="option"
                            aria-selected={selected}
                            onClick={onClick}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer',
                              background: selected ? 'var(--semi-color-primary-light-default)' : undefined,
                            }}
                          >
                            <i style={{ width: 12, height: 12, borderRadius: 'var(--semi-border-radius-small)', background: String(value) }} />
                            <span style={{ color: String(value) }}>{String(value)}</span>
                          </div>
                        )}
                      />
                    </div>
                  </Form.Slot>
                  <Form.Input field="subTitle" label="副标题" size="small" placeholder="可选" />
                  <Form.Input field="shortTitle" label="短标题" size="small" placeholder="列表窄位展示（可选）" />
                  <Form.TextArea field="summary" label="摘要" rows={2} placeholder="留空时前台自动截取正文" />
                  <Form.Select
                    field="tagIds"
                    label="标签"
                    multiple
                    size="small"
                    style={{ width: '100%' }}
                    optionList={(tags ?? []).map((t) => ({ value: t.id, label: t.name }))}
                  />
                  <Form.Input
                    field="coverImage"
                    label="封面图 URL"
                    size="small"
                    placeholder="https://... 或从媒体库选择"
                    suffix={(
                      <Space spacing={2}>
                        <Button size="small" theme="borderless" icon={<Images size={14} />} disabled={isReadOnly || !canUploadResources} onClick={() => setCoverPickerVisible(true)}>媒体库</Button>
                        <Upload
                          action=""
                          accept="image/*"
                          limit={1}
                          showUploadList={false}
                          disabled={isReadOnly || !canUploadResources}
                          customRequest={async ({ fileInstance, onSuccess, onError }) => {
                            if (!siteId) { onError?.({ status: 0 }); return; }
                            try {
                              const formData = new FormData();
                              formData.append('file', fileInstance);
                              const res = await uploadCmsImage.mutateAsync({ siteId, formData });
                              formApi.current?.setValue('coverImage', res.url);
                              dirtyRef.current = true;
                              Toast.success(res.watermarked ? '上传成功（已加水印）' : '上传成功');
                              onSuccess?.({});
                            } catch {
                              onError?.({ status: 0 });
                            }
                          }}
                        >
                          <Button size="small" theme="borderless" icon={<ImageUp size={14} />} disabled={isReadOnly || !canUploadResources}>上传</Button>
                        </Upload>
                      </Space>
                    )}
                  />
                  <Row gutter={12}>
                    <Col span={6}><Form.Switch field="isTop" label="置顶" size="small" /></Col>
                    <Col span={6}><Form.Switch field="isOriginal" label="原创" size="small" /></Col>
                    <Col span={6}><Form.Switch field="isRecommend" label="推荐" size="small" /></Col>
                    <Col span={6}><Form.Switch field="isHot" label="热门" size="small" /></Col>
                  </Row>
                </TabPane>
                <TabPane tab="归属与来源" itemKey="attribution">
                  <Form.TreeSelect
                    field="extraChannelIds"
                    label="副栏目（一文多栏目）"
                    multiple
                    size="small"
                    style={{ width: '100%' }}
                    treeData={channelsToSelectTree(treeQuery.data ?? [])}
                    placeholder="同时展示在其他栏目（可选）"
                  />
                  <Form.Select
                    field="relatedIds"
                    label="相关文章"
                    multiple
                    filter
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="手动指定相关阅读（不足自动按标签补齐）"
                    optionList={(relatedCandidatesQuery.data?.list ?? [])
                      .filter((c) => c.id !== id)
                      .map((c) => ({ value: c.id, label: c.title }))}
                  />
                  <Form.Input field="author" label="作者" size="small" />
                  <Form.Input field="editor" label="责任编辑" size="small" />
                  <Form.Input field="source" label="来源" size="small" />
                  <Form.Input field="sourceUrl" label="来源链接" size="small" placeholder="https://（可选）" />
                </TabPane>
                <TabPane tab="SEO" itemKey="seo">
                  <div style={{ marginTop: 8, fontSize: 12, color: 'var(--semi-color-text-2)' }}>留空则继承栏目/站点设置</div>
                  <Form.Input field="seoTitle" label="SEO 标题" size="small" />
                  <Form.Input field="seoKeywords" label="SEO 关键词" size="small" />
                  <Form.TextArea field="seoDescription" label="SEO 描述" rows={2} />
                  <Form.Input field="socialImageAlt" label="社交图片说明" size="small" maxLength={255} placeholder="用于 og:image:alt / twitter:image:alt" />
                  <Form.Input field="twitterCreator" label="Twitter/X 作者" size="small" maxLength={100} placeholder="@creator" />
                </TabPane>
                <TabPane tab="发布计划" itemKey="schedule">
                  <Form.InputNumber field="topWeight" label="置顶权重" min={0} max={9999} size="small" style={{ width: '100%' }} />
                  <Form.DatePicker
                    field="topExpireAt"
                    label="置顶到期"
                    type="dateTime"
                    density="compact"
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="到期自动取消置顶"
                  />
                  <Form.InputNumber field="sort" label="排序权重" size="small" style={{ width: '100%' }} />
                  <Form.DatePicker
                    field="scheduledAt"
                    label="定时发布"
                    type="dateTime"
                    density="compact"
                    size="small"
                    style={{ width: '100%' }}
                    disabled={!hasPermission('cms:content:publish')}
                    placeholder={hasPermission('cms:content:publish') ? '到期自动发布（每分钟检查）' : '需要内容发布权限'}
                  />
                  <Form.DatePicker
                    field="expireAt"
                    label="过期下线"
                    type="dateTime"
                    density="compact"
                    size="small"
                    style={{ width: '100%' }}
                    placeholder="到期自动下线（留空永不过期）"
                  />
                </TabPane>
                <TabPane tab="高级设置" itemKey="advanced">
                  <Form.Input field="slug" label="自定义 URL 标识" size="small" placeholder="留空使用 ID" />
                  <Form.Input
                    field="staticPath"
                    label="自定义静态路径"
                    size="small"
                    placeholder="留空按栏目 + URL 标识生成"
                    extraText="站内唯一，形如 news/2026/hello.html，仅支持 .html"
                  />
                  {contentType !== 'link' ? (
                    <>
                      <Form.Input
                        field="externalLink"
                        label="跳转链接"
                        size="small"
                        placeholder="填写后点击标题直接跳转"
                        suffix={linkPicker.suffix}
                      />
                      {linkPicker.hint}
                    </>
                  ) : null}
                  <Form.Slot noLabel>
                    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
                      <div style={{ flex: 1 }}>
                        <Form.Select field="detailTemplate" label="详情模板" size="small" style={{ width: '100%' }} showClear
                          placeholder="跟随栏目/站点默认"
                          optionList={(themeTemplates?.detail ?? []).map((t) => ({ value: t.name, label: t.label }))} />
                      </div>
                      <Button size="small" style={{ marginBottom: 12 }} icon={<Eye size={14} />} title="以当前选中模板试穿预览本文（不影响线上）"
                        onClick={handleTemplateTryOn}>试穿</Button>
                    </div>
                  </Form.Slot>
                </TabPane>
              </Tabs>
            </div>
          </div>
        </Form>
      </Spin>

      {/* 内部链接选择弹窗 */}
      {linkPicker.modals}

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

      {/* 图集媒体库添加 */}
      <MediaPickerModal
        visible={albumPickerVisible}
        imageOnly
        onCancel={() => setAlbumPickerVisible(false)}
        onSelect={(file) => {
          setAlbumImages((list) => [...list, { url: file.url ?? '', thumb: null, caption: null }]);
          dirtyRef.current = true;
          setAlbumPickerVisible(false);
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
                      confirmDanger({
                        title: `回滚到 v${v.version}？`,
                        content: '当前内容将自动留档后被该版本覆盖',
                        onOk: async () => {
                          pendingFormResetRef.current = true;
                          await restoreMutation.mutateAsync({ params: { id: id!, versionId: v.id } });
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

      {/* 操作记录抽屉 */}
      <SideSheet title="操作记录" visible={opLogsVisible} onCancel={() => setOpLogsVisible(false)} width={420}>
        {opLogsQuery.data && opLogsQuery.data.length > 0 ? (
          <Timeline>
            {opLogsQuery.data.map((log) => (
              <Timeline.Item key={log.id} time={log.createdAt}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b>{log.actionLabel}</b>
                  <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{log.operatorName}</span>
                </div>
                {log.detail ? <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)' }}>{log.detail}</div> : null}
              </Timeline.Item>
            ))}
          </Timeline>
        ) : (
          <div style={{ color: 'var(--semi-color-text-2)', padding: 24, textAlign: 'center' }}>
            {opLogsQuery.isFetching ? '加载中…' : '暂无操作记录'}
          </div>
        )}
      </SideSheet>

      {/* 词库检查结果 */}
      <Modal
        title="内容检查结果"
        visible={checkModalVisible}
        onCancel={() => setCheckModalVisible(false)}
        footer={null}
        width={560}
        closeOnEsc
      >
        {checkResult && checkResult.sensitive.length === 0 && checkResult.errorProne.length === 0 ? (
          <Banner type="success" description="未发现敏感词与易错词" closeIcon={null} />
        ) : checkResult ? (
          <div style={{ maxHeight: '60vh', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
            {checkResult.sensitive.length > 0 ? (
              <div>
                <Typography.Title heading={6} style={{ marginBottom: 8 }}>敏感词（{checkResult.sensitive.length}）</Typography.Title>
                {checkResult.sensitive.map((hit) => (
                  <div key={hit.word} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--semi-color-border)' }}>
                    <Typography.Text type="danger" strong>{hit.word}</Typography.Text>
                    <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', flex: 1 }}>
                      命中 {hit.count} 次 · {hit.replaceWith ? `提交时将被替换为「${hit.replaceWith}」` : '拦截词，请删除后再提交'}
                    </span>
                  </div>
                ))}
              </div>
            ) : null}
            {checkResult.errorProne.length > 0 ? (
              <div>
                <div style={{ display: 'flex', alignItems: 'center', marginBottom: 8 }}>
                  <Typography.Title heading={6} style={{ margin: 0, flex: 1 }}>易错词（{checkResult.errorProne.length}）</Typography.Title>
                  <Button
                    size="small"
                    onClick={() => {
                      for (const hit of checkResult.errorProne) applyCorrection(hit.word, hit.correction);
                    }}
                  >
                    全部替换
                  </Button>
                </div>
                {checkResult.errorProne.map((hit) => (
                  <div key={hit.word} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 0', borderBottom: '1px solid var(--semi-color-border)' }}>
                    <Typography.Text type="warning" strong>{hit.word}</Typography.Text>
                    <span style={{ fontSize: 12 }}>→ {hit.correction}</span>
                    <span style={{ fontSize: 12, color: 'var(--semi-color-text-2)', flex: 1 }}>命中 {hit.count} 次</span>
                    <Button size="small" theme="borderless" onClick={() => applyCorrection(hit.word, hit.correction)}>一键替换</Button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </div>
  );
}
