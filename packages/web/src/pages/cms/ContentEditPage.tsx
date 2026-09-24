import CmsWorkbenchPreview from './CmsWorkbenchPreview';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import CmsValueDiff from './CmsValueDiff';
import CmsContentConflictView from './CmsContentConflictView';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Divider, Form, Spin, Toast, Row, Col, Banner, SideSheet, Space, Timeline, Modal, Upload, Typography, Tag, Input, Tabs, TabPane, withField, Pagination } from '@douyinfe/semi-ui';
import EntityRelationButton from '@/components/entity-relations/EntityRelationButton';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ArrowLeft, Save, Send, History, ImageUp, Eye, GitCompare, Images, Paperclip, SpellCheck, ScrollText, Workflow } from 'lucide-react';
import { useDebouncedCallback } from '@tanstack/react-pacer';
import { formatDateTimeForApi } from '@/utils/date';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { config as appConfig } from '@/config';
import { confirmDanger } from '@/utils/confirm';
import {
  useCmsContentWorkflowRecord, useCmsChannelTree, useAllCmsModels, useAllCmsTags,
  useSaveCmsContent, useCmsContentAction, useCmsContentVersions, useCmsContentVersion, useRestoreCmsContentVersion,
  useCmsVersionDiff, useCmsPreviewLink, useRevokeCmsPreviewLink, acquireCmsEditLock, releaseCmsEditLock, useCmsContentApprovalDetail,
  useAllCmsSites, useCmsThemeTemplates, useCmsContentOpLogs, useCmsCheckText, useUploadCmsResource,
  useCheckCmsContentTitle, useUploadCmsImage, cmsImageUploadUrl,
  useCmsContentWorkflowPreview, useCmsContentWorkflowContext,
} from '@/hooks/queries/cms';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { CMS_CONTENT_STATUS_LABELS, CMS_CONTENT_TYPE_LABELS, CMS_CONTENT_TYPES, CMS_TITLE_STYLE_COLORS, CMS_RESOURCE_URI_PREFIX } from '@zenith/shared/cms';
import type { CmsContent, CmsPreviewLink, CmsModelField, CmsEditLock, CmsTextCheckResult, CmsContentType, CmsAlbumImage, CmsContentAttachment, CmsResource } from '@zenith/shared/cms';
import { useCmsLinkPicker } from './CmsLinkInput';
import { formatBytes } from '@zenith/shared/core';
import { channelsToSelectTree } from './channel-tree';
import { CmsModelFieldControl } from './model-field-renderer';
import { ContentApprovalDetails } from './ContentApprovalView';
import { ContentRevisionViewer } from './ContentRevisionViewer';
import CmsContentReferenceInput from './CmsContentReferenceInput';
import { useCmsEditorRecovery } from './useCmsEditorRecovery';
import { useCmsEditorBaseline } from './useCmsEditorBaseline';
import CmsModelMediaField from './CmsModelMediaField';
import { CmsAssetField } from './components/CmsAssetField';
import { CmsResourcePicker } from './components/CmsResourcePicker';
import CmsContentMediaFields from './components/CmsContentMediaFields';
import { adoptCmsSavedResourceValues, createCmsResourceSelections } from './cms-resource-selections';
import { CMS_EDITORIAL_STATUS_LABELS, CMS_EDITORIAL_STATUS_COLORS } from './cms-content-view-state';
import CmsEditorialPanel from './CmsEditorialPanel';
import { useAllUsers } from '@/hooks/queries/users';
import { ApiError } from '@/lib/query';
import { copyTextWithToast } from '@/utils/clipboard';
import { INSTANCE_STATUS_MAP } from '@/components/workflow/workflow-runtime';
import './ContentEditPage.css';

// 富文本引擎（wangeditor）压缩后约 266 KB。静态导入会阻塞整个编辑页 chunk 的加载，
// 且「链接」类型内容不渲染正文编辑器；改为懒加载后表单先出，编辑器再补。
const RichTextEditor = lazy(() => import('@/components/RichTextEditor'));
const FormContentReference = withField(CmsContentReferenceInput);
const FormCmsAsset = withField(CmsAssetField);
const BusinessWorkflowPanel = lazy(() => import('@/components/workflow/BusinessWorkflowPanel'));
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

const AUTO_SAVE_INTERVAL_MS = 5_000;
const EDIT_LOCK_HEARTBEAT_MS = 30_000;

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
function ModelFieldControl({ field, applyDefault, canUpload, siteId, onResourceChange }: Readonly<{ field: CmsModelField; applyDefault?: boolean; canUpload: boolean; siteId?: number; onResourceChange?: (resource: CmsResource | null) => void }>) {
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
  return (
    <CmsModelFieldControl
      field={field}
      common={common}
      siteId={siteId}
      richtext={{ rows: 5, placeholder: field.placeholder ?? '支持 HTML' }}
      media={<CmsModelMediaField field={field} canUpload={canUpload} siteId={siteId} onResourceChange={onResourceChange} />}
    />
  );
}

/** 版本差异值展示（布尔/对象友好化） */

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
  // useEditModal 例外：整页内容编辑器；仅采用服务端基线时更新 formEpoch，首次创建切换 id 不重挂表单
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

  const [formRecord, setFormRecord] = useState<CmsContent>();
  const detailQuery = useCmsContentWorkflowRecord(id);
  // The first POST response is already the complete record. Keep it available
  // while the new id route fetches, so media shape and editability never fall back.
  const detail = detailQuery.data ?? (formRecord?.id === id ? formRecord : undefined);
  const siteId = detail?.siteId ?? siteIdParam;

  const treeQuery = useCmsChannelTree(siteId);
  const { data: models } = useAllCmsModels(siteId);
  const { data: tags } = useAllCmsTags(siteId);
  const saveMutation = useSaveCmsContent();
  const actionMutation = useCmsContentAction();
  const previewMutation = useCmsPreviewLink();
  const revokePreviewMutation = useRevokeCmsPreviewLink();
  const [workbenchPreviewId, setWorkbenchPreviewId] = useState<number>();
  const [lastPreview, setLastPreview] = useState<CmsPreviewLink | null>(null);
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
  const [selectedModelId, setSelectedModelId] = useState<number | null | undefined>(undefined);
  const { data: users } = useAllUsers();
  const [selectedChannelId, setSelectedChannelId] = useState<number | undefined>(channelIdParam);
  const [activeTab, setActiveTab] = useUrlTabState(['content', 'workflow', 'collaboration', 'snapshot'] as const, 'content');
  const [selectedWorkflowInstanceId, setSelectedWorkflowInstanceId] = useState<number>();
  const [workflowTitle, setWorkflowTitle] = useState<string>();
  const scheduleWorkflowTitle = useDebouncedCallback((title: string) => setWorkflowTitle(title), { wait: 500 });
  const workflowContextQuery = useCmsContentWorkflowContext(id, selectedWorkflowInstanceId);
  const workflowPreviewQuery = useCmsContentWorkflowPreview({
    siteId: siteId ?? 0,
    channelId: selectedChannelId ?? detail?.channelId ?? 0,
    title: workflowTitle ?? detail?.title,
  });
  const workflowContext = workflowContextQuery.data;
  const approvalQuery = useCmsContentApprovalDetail(id, workflowContext?.instance?.id);
  const workflowPreview = workflowPreviewQuery.data;
  // 本次提交使用当前站点的有效审核配置；往次实例只影响记录展示。
  const workflowMode = !!workflowPreview?.definition;
  const workflowBusy = workflowPreviewQuery.isLoading || workflowContextQuery.isLoading;

  useEffect(() => {
    setSelectedWorkflowInstanceId(undefined);
    setWorkflowTitle(undefined);
  }, [id]);
  // 链接字段的镜像值：仅用于回显解析出的内部链接目标名（真值仍在 Form 里）
  const [externalLink, setExternalLink] = useState('');
  const contentType: CmsContentType = detail?.contentType ?? formRecord?.contentType ?? newContentType;
  // 图集图片（受控管理，保存时并入 mediaData.images）
  const [albumImages, setAlbumImages] = useState<CmsAlbumImage[]>([]);
  // 正文附件（受控管理，保存时随 payload.attachments 提交）
  const [attachments, setAttachments] = useState<CmsContentAttachment[]>([]);
  const [albumPickerVisible, setAlbumPickerVisible] = useState(false);
  const [versionsVisible, setVersionsVisible] = useState(false);
  const [versionsPage, setVersionsPage] = useState(1);
  const versionsQuery = useCmsContentVersions(id, versionsVisible, versionsPage);
  const restoreMutation = useRestoreCmsContentVersion();
  const [viewVersionId, setViewVersionId] = useState<number | undefined>(undefined);
  const viewedVersionQuery = useCmsContentVersion(id, viewVersionId);
  const [diffVersionId, setDiffVersionId] = useState<number | undefined>(undefined);
  const diffQuery = useCmsVersionDiff(id, diffVersionId);
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
  const isReadOnly = isPersistentlyLocked || !canUpdateContent || (!!id && (!detail || detail.id !== id));

  const linkPicker = useCmsLinkPicker({
    siteId,
    value: externalLink,
    disabled: isPersistentlyLocked,
    excludeContentId: id,
    onPick: (next) => {
      formApi.current?.setValue('externalLink', next);
      setExternalLink(next);
      markDirty();
    },
  });

  // ─── 编辑锁 / 乐观锁 / 自动保存状态 ─────────────────────────────────────────
  const [lockHolder, setLockHolder] = useState<CmsEditLock['holder']>(null);
  const [autoSavedAt, setAutoSavedAt] = useState<string | null>(null);
  const dirtyRef = useRef(false);
  const editSequenceRef = useRef(0);
  const applyingSavedResources = useRef(false);
  const editorTouchedRef = useRef(false);
  const versionRef = useRef<number | undefined>(undefined);
  const savingRef = useRef<Promise<number | null> | null>(null);
  const createdIdRef = useRef<number | undefined>(id);
  const [saveState, setSaveState] = useState<'saved' | 'dirty' | 'saving' | 'error' | 'conflict'>('saved');
  const [saveError, setSaveError] = useState('');
  const [conflictVisible, setConflictVisible] = useState(false);
  const baseDraftRef = useRef<Record<string, unknown>>({});
  const [resourceSelections] = useState(createCmsResourceSelections);
  const recovery = useCmsEditorRecovery({
    key: `${siteId ?? 0}:${id ?? `new-${contentType}-${channelIdParam ?? 0}`}`,
    dirty: dirtyRef,
    getDraft: () => ({ values: formApi.current?.getValues() ?? {}, body, albumImages, attachments, version: versionRef.current, refreshResourceIds: resourceSelections.ids() }),
  });
  function markDirty() {
    if (!editorTouchedRef.current || applyingSavedResources.current) return;
    dirtyRef.current = true;
    editSequenceRef.current += 1;
    setSaveState((state) => state === 'conflict' ? state : 'dirty');
    recovery.checkpoint();
  }
  function selectResource(resource: CmsResource | null) {
    if (resource) resourceSelections.select(resource.id);
    markDirty();
  }
  function restoreLocalDraft() {
    const draft = recovery.pending;
    if (!draft) return;
    formApi.current?.setValues(draft.values);
    setBody(draft.body);
    setAlbumImages(draft.albumImages ?? []);
    setAttachments(draft.attachments ?? []);
    if (draft.version !== undefined) versionRef.current = draft.version;
    resourceSelections.reset(draft.refreshResourceIds ?? []);
    recovery.dismiss();
    editorTouchedRef.current = true;
    markDirty();
  }
  const displayedRecordId = useRef<number | undefined>(undefined);
  const [formEpoch, setFormEpoch] = useState(0);
  const baseline = useCmsEditorBaseline({
    record: detail, dirty: dirtyRef, saving: savingRef, saveState,
    onAdopt: (record) => {
      if (displayedRecordId.current !== record.id) {
        setLastPreview(null);
        setVersionsPage(1);
        setViewVersionId(undefined);
        setDiffVersionId(undefined);
      }
      displayedRecordId.current = record.id;
      versionRef.current = record.version;
      baseDraftRef.current = { ...record };
      dirtyRef.current = false;
      resourceSelections.reset();
      editorTouchedRef.current = false;
      setFormRecord(record);
      setFormEpoch((value) => value + 1);
      setBody(record.body ?? '');
      setSelectedChannelId(record.channelId);
      setSelectedModelId(record.modelId);
      setExternalLink(record.externalLink ?? '');
      setAlbumImages(record.mediaData.images?.map((image) => ({ ...image })) ?? []);
      setAttachments(record.attachments.map((attachment) => ({ ...attachment })));
      setSaveError('');
      setSaveState('saved');
    },
    onConflict: () => {
      setSaveState('conflict');
      setSaveError('服务器已有新的工作稿。你的本地修改已保留，请比较后再保存。');
      setConflictVisible(true);
      recovery.persist();
    },
  });

  const hasDetail = !!detail;
  // 编辑锁：进入抢占 + 30s 心跳续期，离开释放（软锁，保存冲突由乐观锁兜底）
  useEffect(() => {
    if (!id || !hasDetail || isPersistentlyLocked) return;
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
  }, [id, hasDetail, isPersistentlyLocked]);

  const { data: allSites } = useAllCmsSites();
  const selectedSite = allSites?.find((site) => site.id === siteId);
  const siteTheme = selectedSite?.effectiveTheme ?? selectedSite?.theme;
  const { data: themeTemplates } = useCmsThemeTemplates(siteTheme, siteId || undefined);
  const currentModel = useMemo(
    () => (models ?? []).find((m) => m.id === (selectedModelId ?? detail?.modelId)),
    [models, selectedModelId, detail],
  );
  const modelFields = formRecord?.modelFields ?? detail?.modelFields ?? currentModel?.fields ?? [];

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

  const initValues = formRecord
    ? {
        channelId: formRecord.channelId,
        modelId: formRecord.modelId ?? undefined,
        ownerId: formRecord.ownerId ?? undefined,
        locale: formRecord.locale,
        dueAt: formRecord.dueAt ?? undefined,
        title: formRecord.title,
        subTitle: formRecord.subTitle ?? '',
        shortTitle: formRecord.shortTitle ?? '',
        slug: formRecord.slug ?? '',
        staticPath: formRecord.staticPath ?? '',
        titleBold: formRecord.titleStyle?.bold ?? false,
        titleColor: formRecord.titleStyle?.color ?? '',
        summary: formRecord.summary ?? '',
        coverImage: formRecord.coverImage ?? '',
        author: formRecord.author ?? '',
        editor: formRecord.editor ?? '',
        source: formRecord.source ?? '',
        sourceUrl: formRecord.sourceUrl ?? '',
        isOriginal: formRecord.isOriginal,
        externalLink: formRecord.externalLink ?? '',
        detailTemplate: formRecord.detailTemplate ?? undefined,
        isTop: formRecord.isTop,
        topWeight: formRecord.topWeight,
        topExpireAt: formRecord.topExpireAt ?? undefined,
        isRecommend: formRecord.isRecommend,
        isHot: formRecord.isHot,
        sort: formRecord.sort,
        tagIds: formRecord.tagIds ?? [],
        extraChannelIds: formRecord.extraChannelIds ?? [],
        relatedIds: formRecord.relatedIds ?? [],
        seoTitle: formRecord.seoTitle ?? '',
        seoKeywords: formRecord.seoKeywords ?? '',
        seoDescription: formRecord.seoDescription ?? '',
        socialImageAlt: formRecord.socialImageAlt ?? '',
        twitterCreator: formRecord.twitterCreator ?? '',
        scheduledAt: formRecord.scheduledAt ?? undefined,
        expireAt: formRecord.expireAt ?? undefined,
        extend: formRecord.extend ?? {},
        mediaType: formRecord.mediaData?.mediaType ?? 'video',
        mediaUrl: formRecord.mediaData?.mediaUrl ?? '',
        mediaPoster: formRecord.mediaData?.poster ?? '',
        mediaDuration: formRecord.mediaData?.duration ?? '',
      }
    : { channelId: channelIdParam, locale: 'zh-CN', isTop: false, topWeight: 0, isOriginal: false, isRecommend: false, isHot: false, sort: 0, tagIds: [], extraChannelIds: [], relatedIds: [], extend: {}, mediaType: 'video', titleBold: false, titleColor: '' };

  async function performSave(opts?: { silent?: boolean }): Promise<number | null> {
    const recordId = id ?? createdIdRef.current;
    if (isReadOnly) {
      if (!opts?.silent) Toast.warning('内容已被持久锁定，当前页面为只读状态');
      return null;
    }
    if (!siteId) {
      if (!opts?.silent) Toast.error('未指定所属站点，请从内容列表进入编辑页');
      return null;
    }
    let values: Record<string, unknown>;
    try {
      values = opts?.silent ? { ...formApi.current?.getValues() } : (await formApi.current?.validate()) ?? {};
      if (!values.channelId) return null;
      if (!String(values.title ?? '').trim()) values.title = '未命名内容';
    } catch (err) {
      if (!opts?.silent) {
        setActiveTab('content');
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
    const payload: Record<string, unknown> = { ...values, body, saveMode: opts?.silent ? 'autosave' : 'manual' };
    if (values.dueAt instanceof Date) payload.dueAt = formatDateTimeForApi(values.dueAt);
    if (!values.dueAt) payload.dueAt = null;
    payload.ownerId = values.ownerId ?? null;
    if (!recordId) payload.modelId = selectedModelId ?? values.modelId ?? null;
    else delete payload.modelId;
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
    if (!recordId) payload.contentType = contentType;
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
    if (!recordId) payload.siteId = siteId;
    if (recordId) payload.expectedVersion = versionRef.current;
    const submittedValues = structuredClone(values);
    const submittedAlbumImages = structuredClone(albumImages);
    const selectedResources = resourceSelections.capture(payload);
    if (recordId && selectedResources.size) payload.refreshResourceIds = [...selectedResources.keys()];
    const wasDirty = dirtyRef.current;
    const savingSequence = editSequenceRef.current;
    setSaveState('saving');
    setSaveError('');
    try {
      const saved = await saveMutation.mutateAsync({ id: recordId, values: payload });
      createdIdRef.current = saved.id;
      versionRef.current = saved.version;
      baseDraftRef.current = { ...saved };
      resourceSelections.acknowledge(selectedResources);
      const pendingResourceIds = new Set(resourceSelections.ids());
      const currentValues = formApi.current?.getValues() ?? {};
      const adoptedValues = adoptCmsSavedResourceValues(currentValues, submittedValues, {
        ...saved, mediaUrl: saved.mediaData.mediaUrl, mediaPoster: saved.mediaData.poster,
      }, pendingResourceIds);
      if (adoptedValues !== currentValues) {
        applyingSavedResources.current = true;
        try { formApi.current?.setValues(adoptedValues); } finally { applyingSavedResources.current = false; }
      }
      setAlbumImages((current) => adoptCmsSavedResourceValues(current, submittedAlbumImages, saved.mediaData.images ?? [], pendingResourceIds));
      dirtyRef.current = editSequenceRef.current !== savingSequence;
      // 自己的保存已由当前输入组成，不重挂编辑器，避免自动保存打断光标。
      setFormRecord(saved);
      baseline.acknowledge(saved, false);
      setSaveState(dirtyRef.current ? 'dirty' : 'saved');
      setAutoSavedAt(new Date().toTimeString().slice(0, 8));
      if (!dirtyRef.current) recovery.clear();
      if (!id) {
        recovery.promote(`${siteId}:${saved.id}`);
        recovery.navigateSaved(() => navigate(`/cms/contents/edit?id=${saved.id}&siteId=${siteId}`, { replace: true }));
      }
      return saved.id;
    } catch (err) {
      dirtyRef.current = dirtyRef.current || wasDirty;
      const conflict = err instanceof ApiError && err.code === 409;
      setSaveState(conflict ? 'conflict' : 'error');
      setSaveError(err instanceof Error ? err.message : '保存失败，请重试');
      recovery.persist();
      if (conflict) { setConflictVisible(true); void detailQuery.refetch(); }
      return null;
    }
  }

  async function save(opts?: { silent?: boolean }): Promise<number | null> {
    if (savingRef.current) {
      const saved = await savingRef.current;
      if (opts?.silent || !dirtyRef.current) return saved;
    }
    const pending = performSave(opts);
    savingRef.current = pending;
    try { return await pending; } finally { if (savingRef.current === pending) savingRef.current = null; }
  }
  const saveRef = useRef(save);
  saveRef.current = save;
  const canAutosave = !isReadOnly && saveState !== 'conflict' && !recovery.pending;
  useEffect(() => {
    if (!canAutosave) return;
    const timer = setInterval(() => {
      if (dirtyRef.current && !savingRef.current) void saveRef.current({ silent: true });
    }, AUTO_SAVE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [canAutosave]);

  async function handleSaveDraft() {
    const savedId = await save();
    if (savedId) {
      Toast.success('保存成功');
    }
  }

  async function handleSaveAndPublish(prepareOnly = false) {
    const savedId = await save();
    if (savedId) {
      await actionMutation.mutateAsync({ id: savedId, action: prepareOnly ? 'preparePublication' : 'publish', expectedVersion: versionRef.current! });
      Toast.success(prepareOnly ? '修订已批准，可在发布中心与专题页面组合发布' : '已提交发布任务，生效结果请在发布中心查看');
    }
  }

  async function handleSaveAndSubmit() {
    const savedId = await save();
    if (!savedId) return;
    // 新建成功后先进入该记录，后续提审失败仍可在已保存的草稿上重试，不会重复创建。
    await actionMutation.mutateAsync({ id: savedId, action: 'submit', expectedVersion: versionRef.current! });
    setSelectedWorkflowInstanceId(undefined);
    setActiveTab('workflow');
    Toast.success('已保存并提交审核');
  }

  async function handlePreview(share = false) {
    // 新建内容需先落库拿到 id；已存在内容有改动时先静默保存，保证「预览即所见」
    let previewId = id;
    if (!previewId || dirtyRef.current) {
      const savedId = await save(previewId ? { silent: true } : undefined).catch(() => null);
      if (savedId) {
        previewId = savedId;
      } else if (previewId) {
        Toast.warning('存在未通过校验的字段，预览将展示最近一次保存的内容');
      } else {
        // 新建且保存未通过：save() 已给出校验反馈，无内容可预览
        return;
      }
    }
    if (!share) { setWorkbenchPreviewId(previewId); return; }
    const link = await previewMutation.mutateAsync({ params: { id: previewId } });
    setLastPreview(link);
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
    markDirty();
    setCheckResult((prev) => prev ? { ...prev, errorProne: prev.errorProne.filter((h) => h.word !== word) } : prev);
    Toast.success(`已替换「${word}」→「${correction}」`);
  }

  const loading = (!!id && detailQuery.isFetching && !detail) || treeQuery.isLoading;
  const diffVersion = (versionsQuery.data?.list ?? []).find((v) => v.id === diffVersionId);
  const viewedVersion = viewedVersionQuery.data;

  return (
    <div className="page-container page-tabs-page cms-content-edit" onInputCapture={() => { editorTouchedRef.current = true; }} onKeyDownCapture={() => { editorTouchedRef.current = true; }} onPointerDownCapture={() => { editorTouchedRef.current = true; }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 16, flexWrap: 'wrap' }}>
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>返回</Button>
        <h3 style={{ margin: 0, flex: 1, minWidth: 200 }}>
          {id ? '编辑内容' : '新增内容'}
          <Tag size="small" color="blue" style={{ marginLeft: 12, verticalAlign: 'middle' }}>{CMS_CONTENT_TYPE_LABELS[contentType]}</Tag>
          {detail ? <Space spacing={8}><Tag>{detail.status === 'published' ? '线上已发布' : CMS_CONTENT_STATUS_LABELS[detail.status]}</Tag><Tag color={CMS_EDITORIAL_STATUS_COLORS[detail.editorialStatus]}>{CMS_EDITORIAL_STATUS_LABELS[detail.editorialStatus]}</Tag>{detail.hasUnpublishedChanges ? <Tag color="orange">有未发布修改</Tag> : null}</Space> : null}
          {autoSavedAt ? <span style={{ marginLeft: 12, fontSize: 12, fontWeight: 'normal', color: 'var(--semi-color-text-2)' }}>已自动保存 {autoSavedAt}</span> : null}
        </h3>
        <Button icon={<Save size={14} />} loading={saveMutation.isPending} disabled={isReadOnly || actionMutation.isPending} onClick={() => void handleSaveDraft()}>保存</Button>
        <Button icon={<SpellCheck size={14} />} loading={checkMutation.isPending} onClick={() => void handleCheckText()}>内容检查</Button>
        <Button icon={<Eye size={14} />} loading={previewMutation.isPending || saveMutation.isPending} onClick={() => void handlePreview()}>工作稿预览</Button>
        <Button loading={previewMutation.isPending} onClick={() => void handlePreview(true)}>生成分享预览</Button>
        {id ? (
          <>
            <EntityRelationButton entityRef={{ type: 'cms.content', key: String(id) }} />
            <Button icon={<History size={14} />} onClick={() => setVersionsVisible(true)}>历史版本</Button>
            <Button icon={<ScrollText size={14} />} onClick={() => setOpLogsVisible(true)}>操作记录</Button>
          </>
        ) : null}
        {workflowMode ? (
          <Button type="primary" icon={<Send size={14} />} loading={saveMutation.isPending || actionMutation.isPending}
            disabled={isReadOnly || workflowBusy || !!workflowPreviewQuery.error || (detail?.editorialStatus === 'pending') || !hasPermission('cms:content:update')}
            onClick={() => void handleSaveAndSubmit()}>保存并提交审核</Button>
        ) : hasPermission('cms:content:publish') ? (<>
          <Button loading={actionMutation.isPending} disabled={isReadOnly || saveMutation.isPending || workflowBusy || !workflowPreview || !!workflowPreviewQuery.error} onClick={() => void handleSaveAndPublish(true)}>保存并批准待发布</Button>
          <Button type="primary" icon={<Send size={14} />} loading={actionMutation.isPending}
            disabled={isReadOnly || saveMutation.isPending || workflowBusy || !workflowPreview || !!workflowPreviewQuery.error}
            onClick={() => void handleSaveAndPublish()}>保存并申请发布</Button>
        </>) : null}
      </div>

      {lastPreview ? <Banner type="info" closeIcon={null} description={<Space wrap><span>预览固定修订 #{lastPreview.revisionId} · 有效至 {lastPreview.expiresAt}</span><Button size="small" onClick={() => void copyTextWithToast(new URL(lastPreview.url, window.location.href).href)}>复制预览链接</Button><Button size="small" disabled={isReadOnly} loading={revokePreviewMutation.isPending} onClick={async () => { await revokePreviewMutation.mutateAsync({ params: { id: id ?? createdIdRef.current!, grantId: lastPreview.grantId } }); setLastPreview(null); Toast.success('预览链接已撤销'); }}>撤销链接</Button></Space>} /> : null}
      {saveError ? <Banner type="danger" description={saveError} closeIcon={null} /> : null}
      {recovery.storageError ? <Banner type="warning" description="浏览器无法保存恢复副本，请及时手动保存到服务器。" /> : null}
      {recovery.pending ? <Banner type="warning" closeIcon={null} description={<Space wrap><span>发现本浏览器在 {new Date(recovery.pending.savedAt).toLocaleString()} 保留的未保存工作稿。</span><Button size="small" onClick={restoreLocalDraft}>恢复修改</Button><Button size="small" onClick={recovery.clear}>丢弃副本</Button></Space>} /> : null}
      <div className="cms-content-edit__workflow-summary">
        <Space spacing={8} wrap>
          <Tag color={saveState === 'error' || saveState === 'conflict' ? 'red' : saveState === 'saved' ? 'green' : 'orange'}>{({ saved: '已保存工作稿', dirty: '有未保存修改', saving: '正在保存', error: '保存失败', conflict: '版本冲突' })[saveState]}</Tag>
          <Typography.Text type="tertiary">保存不改变线上内容；提审会冻结当前修订。</Typography.Text>
          {saveState === 'error' ? <Button size="small" onClick={() => void handleSaveDraft()}>重试保存</Button> : null}
          {saveState === 'conflict' ? <Button size="small" onClick={() => setConflictVisible(true)}>处理冲突</Button> : null}
          <Divider layout="vertical" />
          <Workflow size={15} />
          <Typography.Text strong>审批流程</Typography.Text>
          {workflowContext?.instance ? (
            <>
              <Typography.Text>{workflowContext.instance.definitionName}</Typography.Text>
              <Tag color={INSTANCE_STATUS_MAP[workflowContext.instance.status]?.color}>
                {INSTANCE_STATUS_MAP[workflowContext.instance.status]?.text ?? workflowContext.instance.status}
              </Tag>
              {workflowContext.instance.currentNodeNames?.length ? (
                <Typography.Text type="tertiary">当前节点：{workflowContext.instance.currentNodeNames.join('、')}</Typography.Text>
              ) : null}
            </>
          ) : (
            <Typography.Text type="tertiary">
              {workflowBusy ? '正在加载审批流程…'
                : workflowPreviewQuery.error || workflowContextQuery.error ? '审批流程加载失败'
                : workflowPreview?.definition ? `${workflowPreview.definition.name} · 本次提审预览`
                : !selectedChannelId ? '选择栏目后查看审批流程'
                : '本站采用普通内容审核'}
            </Typography.Text>
          )}
        </Space>
        <Button theme="borderless" onClick={() => setActiveTab('workflow')}>查看流程</Button>
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
          description={`本内容为映射内容（来源：${detail?.mappingSourceTitle ?? `#${detail?.mappingSourceId}`}）。来源更新将形成待合并差异。当前工作稿可独立编辑，请在「协作与质量」中逐字段处理来源与目标冲突。`}
          style={{ marginBottom: 12 }}
          closeIcon={null}
        />
      ) : null}

      {detail?.editorialStatus === 'rejected' && detail.rejectReason ? (
        <Banner type="danger" description={`驳回原因：${detail.rejectReason}`} style={{ marginBottom: 12 }} closeIcon={null} />
      ) : null}

      <Tabs collapsible="auto" className="cms-content-edit__tabs" activeKey={activeTab}
        onChange={(tab) => setActiveTab(tab as 'content' | 'workflow' | 'collaboration' | 'snapshot')} keepDOM>
      <TabPane tab="内容" itemKey="content">
      <Spin spinning={loading} wrapperClassName="cms-content-edit__spin">
        <Form
          key={formEpoch}
          getFormApi={(api) => { formApi.current = api; }}
          allowEmpty
          disabled={isReadOnly || saveMutation.isPending}
          initValues={initValues}
          onValueChange={(values) => {
            markDirty();
            if (values.channelId !== selectedChannelId) setSelectedChannelId(values.channelId as number);
            setExternalLink((values.externalLink as string) ?? '');
            scheduleWorkflowTitle(String(values.title ?? ''));
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
              {contentType === 'album' ? (
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
                            markDirty();
                          }}
                          style={{ flex: 1 }}
                        />
                        <Button size="small" theme="borderless" disabled={isReadOnly || i === 0}
                          onClick={() => { setAlbumImages((list) => { const next = [...list]; [next[i - 1], next[i]] = [next[i], next[i - 1]]; return next; }); markDirty(); }}>上移</Button>
                        <Button size="small" theme="borderless" disabled={isReadOnly || i === albumImages.length - 1}
                          onClick={() => { setAlbumImages((list) => { const next = [...list]; [next[i], next[i + 1]] = [next[i + 1], next[i]]; return next; }); markDirty(); }}>下移</Button>
                        <Button size="small" theme="borderless" type="danger" disabled={isReadOnly}
                          onClick={() => { setAlbumImages((list) => list.filter((_, xi) => xi !== i)); markDirty(); }}>删除</Button>
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
                            markDirty();
                            onSuccess?.({});
                          } catch {
                            onError?.({ status: 0 });
                          }
                        }}
                      >
                        <Button icon={<ImageUp size={14} />}>上传图片</Button>
                      </Upload>
                      <Button icon={<Images size={14} />} disabled={isReadOnly || !hasPermission('cms:resource:list')} onClick={() => setAlbumPickerVisible(true)}>媒体库添加</Button>
                    </div>
                  </div>
                </Form.Slot>
              ) : null}
              {contentType === 'media' ? <CmsContentMediaFields siteId={siteId} disabled={isReadOnly} allowUpload={canUploadResources} onResourceChange={selectResource} /> : null}
              {contentType !== 'link' ? (
                <Form.Slot noLabel>
                  <Suspense fallback={editorLoadingFallback}>
                      <RichTextEditor
                        value={body}
                        onChange={(v) => { setBody(v); markDirty(); }}
                        readOnly={isReadOnly || saveMutation.isPending}
                        height={contentType === 'article' ? 420 : 240}
                        enablePageBreak={contentType === 'article'}
                        placeholder={contentType === 'article' ? '请输入正文内容...' : '图文说明（可选）'}
                        uploadServer={siteId && canUploadResources ? `${appConfig.apiBaseUrl}${cmsImageUploadUrl(siteId)}` : undefined}
                      />
                  </Suspense>
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
                            markDirty();
                          }}
                          style={{ flex: 1, minWidth: 180 }}
                        />
                        <Typography.Text type="tertiary" size="small" style={{ flexShrink: 0 }}>
                          {att.size > 0 ? formatBytes(att.size) : EMPTY_PLACEHOLDER}
                        </Typography.Text>
                        <Button size="small" theme="borderless" disabled={i === 0 || isReadOnly}
                          onClick={() => { setAttachments((l) => { const n = [...l]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n.map((x, xi) => ({ ...x, sort: xi })); }); markDirty(); }}>上移</Button>
                        <Button size="small" theme="borderless" disabled={i === attachments.length - 1 || isReadOnly}
                          onClick={() => { setAttachments((l) => { const n = [...l]; [n[i], n[i + 1]] = [n[i + 1], n[i]]; return n.map((x, xi) => ({ ...x, sort: xi })); }); markDirty(); }}>下移</Button>
                        <Button size="small" theme="borderless" type="danger" disabled={isReadOnly}
                          onClick={() => { setAttachments((l) => l.filter((_, xi) => xi !== i).map((x, xi) => ({ ...x, sort: xi }))); markDirty(); }}>删除</Button>
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
                            markDirty();
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
              {modelFields.length > 0 ? (
                <Form.Section text={`模型字段（${currentModel?.name}）`}>
                  <Row gutter={16}>
                    {modelFields.map((f) => (
                      <Col key={f.name} span={f.fieldType === 'textarea' || f.fieldType === 'richtext' ? 24 : 12}>
                        <ModelFieldControl field={f} applyDefault={!detail} canUpload={canUploadResources} siteId={siteId} onResourceChange={selectResource} />
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
                  <Form.Select field="modelId" label="内容模型" disabled={!!id} showClear optionList={(models ?? []).map((model) => ({ value: model.id, label: model.name }))} onChange={(value) => setSelectedModelId(value == null ? null : Number(value))} style={{ width: '100%' }} extraText={id ? '类型转换在协作面板中预览字段映射后执行' : '内容类型独立于栏目，移动栏目不会改变模型'} />
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
                  <FormCmsAsset field="coverImage" label="内容封面" siteId={siteId} type="image" disabled={isReadOnly} allowUpload={canUploadResources} onResourceChange={selectResource} />
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
                  <FormContentReference field="relatedIds" label="相关文章" siteId={siteId} multiple />
                  <Form.Select field="ownerId" label="内容负责人" showClear filter optionList={(users ?? []).map((user) => ({ value: user.id, label: user.nickname || user.username }))} style={{ width: '100%' }} />
                  <Form.Input field="locale" label="内容语言" placeholder="zh-CN / en-US" />
                  <Form.DatePicker field="dueAt" label="审稿截止时间" type="dateTime" density="compact" style={{ width: '100%' }} showClear />
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
      </TabPane>
      <TabPane tab="审批流程" itemKey="workflow" className="cms-content-edit__workflow-pane">
        {activeTab === 'workflow' ? (
          <Suspense fallback={<Spin />}>
            <BusinessWorkflowPanel
              preview={workflowPreview}
              context={workflowContext}
              selectedInstanceId={selectedWorkflowInstanceId}
              onSelectInstance={setSelectedWorkflowInstanceId}
              loading={workflowBusy || approvalQuery.isLoading}
              error={approvalQuery.error ?? workflowContextQuery.error ?? (workflowContext?.instance ? null : workflowPreviewQuery.error)}
              onRetry={() => { if (id) void workflowContextQuery.refetch(); if (workflowContext?.instance) void approvalQuery.refetch(); void workflowPreviewQuery.refetch(); }}
              formContent={approvalQuery.data && workflowContext?.instance ? <ContentApprovalDetails content={approvalQuery.data} /> : (
                <div>
                  <Typography.Title heading={6}>本次提审预览</Typography.Title>
                  <Typography.Paragraph>{workflowTitle ?? detail?.title ?? '新增内容'}</Typography.Paragraph>
                  <Typography.Paragraph type="tertiary">审批流程根据当前站点和栏目确定。内容保存后提交审核，审批期间可在这里查看进度与处理记录。</Typography.Paragraph>
                  <Button onClick={() => setActiveTab('content')}>返回编辑内容</Button>
                </div>
              )}
            />
          </Suspense>
        ) : null}
      </TabPane>
      <TabPane tab="协作与质量" itemKey="collaboration"><div className="cms-content-edit__scroll-pane"><CmsEditorialPanel content={detail} disabled={saveState !== 'saved'} models={models ?? []} onChanged={() => { dirtyRef.current = false; recovery.clear(); void detailQuery.refetch().then(() => baseline.adoptLatest()); }} onOpen={(contentId) => navigate(`/cms/contents/edit?id=${contentId}&siteId=${siteId}`)} /></div></TabPane>
      <TabPane tab="已保存稿件" itemKey="snapshot"><div className="cms-content-edit__scroll-pane">{detail ? <ContentRevisionViewer content={detail} fields={modelFields} heading="已保存工作稿" /> : <Typography.Text>保存后可查看完整稿件。</Typography.Text>}</div></TabPane>
      </Tabs>

      {/* 内部链接选择弹窗 */}
      {linkPicker.modals}

      {/* 图集媒体库添加（支持复选框多选、跨翻页累计） */}
      <CmsResourcePicker
        siteId={siteId}
        visible={albumPickerVisible}
        type="image"
        disabled={isReadOnly}
        allowUpload={canUploadResources}
        onCancel={() => setAlbumPickerVisible(false)}
        multiple
        onMultiSelect={(files) => {
          setAlbumImages((list) => [...list, ...files.map((file) => ({ url: `${CMS_RESOURCE_URI_PREFIX}${file.id}`, thumb: file.thumbUrl ?? file.url, caption: null }))]);
          files.forEach(selectResource);
          setAlbumPickerVisible(false);
        }}
        onSelect={(file) => {
          setAlbumImages((list) => [...list, { url: `${CMS_RESOURCE_URI_PREFIX}${file.id}`, thumb: file.thumbUrl ?? file.url, caption: null }]);
          selectResource(file);
          setAlbumPickerVisible(false);
        }}
      />

      <Modal title="工作稿版本冲突" visible={conflictVisible} onCancel={() => setConflictVisible(false)} footer={null} width={960}>
        <Banner type="warning" description="服务器已有更新。下面保留原始基稿、服务器最新稿与本地修改；核对后可采用最新版本作为基线继续编辑。" />
        <CmsContentConflictView base={baseDraftRef.current} server={detail}
          local={{ ...formApi.current?.getValues(), body, attachments, albumImages }} fields={modelFields}
          channels={treeQuery.data} models={models} users={users} tags={tags} />
        <Space wrap style={{ marginTop: 16 }}>
          <Button onClick={() => void detailQuery.refetch()}>刷新服务器稿</Button>
          <Button onClick={() => { if (!detail) return; versionRef.current = detail.version; baseDraftRef.current = { ...detail }; baseline.acknowledge(detail, false); setSaveState('dirty'); setSaveError(''); setConflictVisible(false); }}>保留本地修改，以最新版本为基线</Button>
          <Button type="warning" onClick={() => { dirtyRef.current = false; recovery.clear(); setSaveError(''); setConflictVisible(false); baseline.adoptLatest(); }}>采用服务器稿</Button>
        </Space>
      </Modal>
      {/* 版本历史抽屉 */}
      <SideSheet title="历史版本" visible={versionsVisible} onCancel={() => setVersionsVisible(false)} width={420}>
        {versionsQuery.data && versionsQuery.data.list.length > 0 ? (
          <Timeline>
            {versionsQuery.data.list.map((v) => (
              <Timeline.Item key={v.id} time={v.createdAt}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b>v{v.version}</b>
                  <span style={{ flex: 1, minWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.title}</span>
                  <Button size="small" theme="borderless" onClick={() => setViewVersionId(v.id)}>查看完整修订</Button>
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
                    disabled={isReadOnly}
                    onClick={() => {
                      confirmDanger({
                        title: `将 v${v.version} 恢复为工作稿？`,
                        content: '恢复完整字段与关系到工作稿，后续仍需审核和发布。',
                        onOk: async () => {
                          const restored = await restoreMutation.mutateAsync({ params: { id: id!, versionId: v.id }, body: { expectedVersion: versionRef.current! } });
                          dirtyRef.current = false;
                          baseline.acknowledge(restored, true);
                          recovery.clear();
                          Toast.success('历史修订已恢复为工作稿');
                          setVersionsVisible(false);
                        },
                      });
                    }}
                  >
                    恢复为工作稿
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
            {versionsQuery.isFetching ? '加载中…' : '暂无历史修订（手动保存、提审和发布会建立里程碑）'}
          </div>
        )}
        <Pagination currentPage={versionsPage} pageSize={30} total={versionsQuery.data?.total ?? 0} onPageChange={setVersionsPage} />
      </SideSheet>

      <SideSheet title="历史修订" visible={viewVersionId !== undefined} onCancel={() => setViewVersionId(undefined)} width={900}>
        {viewedVersionQuery.isFetching ? <Spin /> : null}
        {viewedVersion && detail ? <ContentRevisionViewer content={{ ...detail, ...viewedVersion.snapshot, tags: undefined, channelName: undefined, modelFields: Array.isArray(viewedVersion.snapshot.modelFields) ? viewedVersion.snapshot.modelFields : [], revisionId: viewedVersion.id, contentHash: viewedVersion.hash } as CmsContent} heading={`历史修订 v${viewedVersion.version}`} /> : null}
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
                  <CmsValueDiff before={d.before} after={d.after} html={d.field === 'body'} />
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
      <CmsWorkbenchPreview visible={!!workbenchPreviewId} onClose={() => setWorkbenchPreviewId(undefined)} siteId={siteId} initialPath={workbenchPreviewId ? `/@content/${workbenchPreviewId}` : '/'} selection={{ contentIds: workbenchPreviewId ? [workbenchPreviewId] : [] }} />
    </div>
  );
}
