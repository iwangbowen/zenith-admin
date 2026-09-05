/**
 * 站点编辑 SideSheet（8 个 Tab：基础信息 / SEO 与推送 / 审核与 Webhook / 扩展模型 /
 * 内容策略 / 主题与图片 / 模板与主题 / 备案与备注）。
 *
 * 组件常驻挂载（visible 控制显隐），与拆分前 Form 生命周期一致：
 * keepDOM 保证非激活 Tab 字段仍挂载，切换标签不丢值、validate 全量生效。
 * settings JSONB ⇄ 表单字段的映射在 site-form-mapping.ts（有单测锁定）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { Banner, Button, Col, Form, Input, InputNumber, Modal, Row, Select, SideSheet, Switch, Tabs, TabPane, TextArea, Toast, Typography, Upload } from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { ImageUp } from 'lucide-react';
import { usePermission } from '@/hooks/usePermission';
import {
  useAllCmsModels, useAllCmsSites, useCmsSiteTemplateHealth, useCmsStaticBuild,
  useCmsThemeSettingsSchema, useCmsThemeTemplates, useCmsThemes, useSaveCmsSite,
  useUploadCmsImage,
} from '@/hooks/queries/cms';
import { useCmsWidgetRenderers, useCmsWidgetSlots, usePublishedCmsWidgets, useSaveCmsWidgetSlot } from '@/hooks/queries/cms-widgets';
import { useWorkflowDefinitionList } from '@/hooks/queries/workflow-definitions';
import { CMS_STATIC_MODES, CMS_STATIC_MODE_LABELS, CMS_TWITTER_CARDS, CMS_TWITTER_CARD_LABELS } from '@zenith/shared/cms';
import type { CmsInvalidTemplateRef, CmsModelField, CmsSite, CmsThemeSettingField, CmsWidgetRendererKey } from '@zenith/shared/cms';
import {
  EMPTY_TEMPLATE_DEFAULTS, SITE_FORM_CREATE_DEFAULTS, buildSiteFormInitValues, buildSiteSavePayload,
  templateDefaultsFromSettings,
} from './site-form-mapping';
import type { TemplateDefaultsState } from './site-form-mapping';
import { siteIndentOptions } from './site-tree-utils';
import { FormSliderInput } from '@/components/SliderInput';

/** 失效模板引用的人类可读描述（健康检查 Banner 用） */
function describeInvalidRef(ref: CmsInvalidTemplateRef): string {
  const prefix = ref.source === 'channel' && ref.channelName ? `栏目「${ref.channelName}」` : '';
  const suffix = ref.source === 'content' && ref.count ? `（${ref.count} 条内容）` : '';
  return `${prefix}${ref.location}「${ref.template}」${suffix}`;
}

/** 站点扩展模型字段控件（值写入 extend.{name}，与内容编辑页保持一致的渲染规则） */
function SiteModelFieldControl({ field }: Readonly<{ field: CmsModelField }>) {
  const f = `extend.${field.name}`;
  const rules = field.required ? [{ required: true, message: `请填写${field.label}` }] : undefined;
  const common = { field: f, label: field.label, labelWidth: 140, rules, placeholder: field.placeholder ?? undefined };
  // 字典来源的选项由服务端解析进 resolvedOptions，前端不重复判断来源
  const options = field.resolvedOptions ?? field.options ?? [];
  switch (field.fieldType) {
    case 'textarea':
    case 'richtext':
      return <Form.TextArea {...common} rows={3} />;
    case 'number':
      return <Form.InputNumber {...common} style={{ width: '100%' }} />;
    case 'date':
      return <Form.DatePicker {...common} type="date" density="compact" style={{ width: '100%' }} />;
    case 'datetime':
      return <Form.DatePicker {...common} type="dateTime" density="compact" style={{ width: '100%' }} />;
    case 'select':
      return <Form.Select {...common} style={{ width: '100%' }} optionList={options} showClear />;
    case 'radio':
      return (
        <Form.RadioGroup {...common}>
          {options.map((o) => <Form.Radio key={o.value} value={o.value}>{o.label}</Form.Radio>)}
        </Form.RadioGroup>
      );
    case 'checkbox':
      return <Form.CheckboxGroup {...common} options={options} direction="horizontal" />;
    case 'switch':
      return <Form.Switch {...common} />;
    default:
      return <Form.Input {...common} />;
  }
}

interface SiteEditSheetProps {
  readonly open: boolean;
  /** 编辑中的站点；null = 新建 */
  readonly site: CmsSite | null;
  readonly onClose: () => void;
}

export default function SiteEditSheet({ open, site, onClose }: Readonly<SiteEditSheetProps>) {
  const { hasPermission } = usePermission();
  const formApi = useRef<FormApi | null>(null);
  const uploadCmsImage = useUploadCmsImage();
  const [activeTab, setActiveTab] = useState('basic');
  // 模板下拉跟随表单里实时选中的主题（Form 值不具备响应性，用 state 镜像）
  const [selectedTheme, setSelectedTheme] = useState('default');
  const [templateDefaults, setTemplateDefaults] = useState<TemplateDefaultsState>(EMPTY_TEMPLATE_DEFAULTS);
  // 主题参数编辑态（settings.themeConfig；动态字段名不走 Form，受控管理）
  const [themeConfig, setThemeConfig] = useState<Record<string, unknown>>({});
  // 站点扩展模型：跟随表单里实时选中的模型（Form 值不具备响应性，用 state 镜像）
  const [selectedModelId, setSelectedModelId] = useState<number | undefined>(undefined);
  const [homeSidebarWidgetId, setHomeSidebarWidgetId] = useState<number | null>(null);
  const [homeSidebarRenderer, setHomeSidebarRenderer] = useState<CmsWidgetRendererKey>('list-sidebar');

  const { data: allSites } = useAllCmsSites();
  const { data: themes } = useCmsThemes(site?.id);
  const { data: themeTemplates } = useCmsThemeTemplates(open ? selectedTheme : undefined, site?.id);
  const { data: themeSettingsSchema } = useCmsThemeSettingsSchema(open ? selectedTheme : undefined);
  const widgetSlotsQuery = useCmsWidgetSlots(site?.id, open && !!site);
  const widgetOptionsQuery = usePublishedCmsWidgets(site?.id, open && !!site);
  const widgetRenderersQuery = useCmsWidgetRenderers(site?.id, 'manual-list', open && !!site);
  const saveWidgetSlotMutation = useSaveCmsWidgetSlot();
  const { data: allModels } = useAllCmsModels(site?.id);
  const siteModel = (allModels ?? []).find((m) => m.id === selectedModelId);
  const siteModelFields = siteModel?.fields ?? [];
  // 模板健康检查：按当前选中主题扫描栏目/内容级失效引用（切主题即预检）
  const { data: templateHealth } = useCmsSiteTemplateHealth(site?.id, selectedTheme, open);
  const { data: defsPage } = useWorkflowDefinitionList({ page: 1, pageSize: 100, status: 'published' });
  const publishedDefs = defsPage?.list;
  const saveMutation = useSaveCmsSite();
  const staticBuildMutation = useCmsStaticBuild();

  // 打开时按站点（或新建默认值）初始化编辑态。
  // 用 render 期受控重置（React「adjusting state when props change」模式）而非 useEffect：
  // 保证本 commit 内后续 effect（如下方失效模板清理）读到的已是新站点的值，
  // 复现拆分前「openEdit 先设状态、再开弹窗」的时序。
  const [lastOpenKey, setLastOpenKey] = useState<string | null>(null);
  const openKey = open ? String(site?.id ?? 'new') : null;
  if (openKey !== lastOpenKey) {
    setLastOpenKey(openKey);
    if (openKey !== null) {
      setActiveTab('basic');
      if (site) {
        setSelectedTheme(site.theme);
        setSelectedModelId(site.modelId ?? undefined);
        setTemplateDefaults(templateDefaultsFromSettings(site.settings as Record<string, unknown>));
        setThemeConfig({ ...((site.settings as Record<string, unknown>)?.themeConfig as Record<string, unknown> ?? {}) });
      } else {
        setSelectedTheme('default');
        setSelectedModelId(undefined);
        setTemplateDefaults(EMPTY_TEMPLATE_DEFAULTS);
        setThemeConfig({});
      }
    }
  }

  // 主题模板清单加载后，自动清理本地编辑态中在该主题下失效的站点级模板引用（保存即生效，后端也会校验拦截）
  useEffect(() => {
    if (!open || !themeTemplates) return;
    const validList = new Set(themeTemplates.list.map((t) => t.name));
    const validDetail = new Set(themeTemplates.detail.map((t) => t.name));
    const removed: string[] = [];
    const detailByModel = Object.fromEntries(
      Object.entries(templateDefaults.detailByModel).filter(([model, v]) => {
        if (!v || validDetail.has(v)) return true;
        removed.push(`${model} 详情模板「${v}」`);
        return false;
      }),
    );
    if (templateDefaults.list && !validList.has(templateDefaults.list)) removed.push(`列表模板「${templateDefaults.list}」`);
    if (templateDefaults.detail && !validDetail.has(templateDefaults.detail)) removed.push(`详情模板「${templateDefaults.detail}」`);
    if (removed.length > 0) {
      setTemplateDefaults({
        list: templateDefaults.list && validList.has(templateDefaults.list) ? templateDefaults.list : null,
        detail: templateDefaults.detail && validDetail.has(templateDefaults.detail) ? templateDefaults.detail : null,
        detailByModel,
      });
      Toast.warning({ content: `已清除 ${removed.length} 项在主题「${selectedTheme}」下失效的默认模板配置：${removed.join('、')}（保存后生效）`, duration: 6 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅在主题清单变化时清理，避免编辑操作反复触发
  }, [themeTemplates, open]);

  useEffect(() => {
    const slot = widgetSlotsQuery.data?.find((item) => item.key === 'home.sidebar');
    setHomeSidebarWidgetId(slot?.binding?.widgetId ?? null);
    setHomeSidebarRenderer(slot?.binding?.rendererKey ?? 'list-sidebar');
  }, [widgetSlotsQuery.data]);

  async function handleSave() {
    let values: Record<string, unknown>;
    try {
      values = (await formApi.current?.validate()) ?? {};
    } catch {
      // 必填项（站点名称/标识）都在基础信息页，校验失败跳回该页
      setActiveTab('basic');
      return;
    }
    const { payload, themeConfigChanged, themeChanged } = buildSiteSavePayload({ values, editingRecord: site, templateDefaults, themeConfig });
    let saved: CmsSite;
    try {
      saved = await saveMutation.mutateAsync({ id: site?.id, values: payload });
    } catch {
      return; // 错误提示由请求层统一 Toast
    }
    Toast.success(site ? '更新成功' : '创建成功');
    onClose();
    // 主题或主题参数变更 + 非纯动态站点 → 保存后提示重新生成静态页
    if ((themeChanged || themeConfigChanged) && saved.staticMode !== 'dynamic') {
      Modal.confirm({
        title: '重新生成静态页？',
        content: themeChanged
          ? '站点主题已切换，已生成的静态页仍是旧主题样式。是否立即提交全站静态化任务？'
          : '主题参数已变更，已生成的静态页仍是旧样式。是否立即提交全站静态化任务？',
        okText: '立即生成',
        cancelText: '稍后手动',
        onOk: async () => {
          await staticBuildMutation.mutateAsync({ body: { siteId: saved.id } });
          Toast.success('静态化任务已提交，可在任务中心查看进度');
        },
      });
    }
  }

  const formInitValues = site ? buildSiteFormInitValues(site) : SITE_FORM_CREATE_DEFAULTS;

  const listTplOptions = (themeTemplates?.list ?? []).map((t) => ({ value: t.name, label: t.label }));
  const detailTplOptions = (themeTemplates?.detail ?? []).map((t) => ({ value: t.name, label: t.label }));

  // 栏目/内容级失效引用（站点级由本地自动清理负责；这两级存在其他表，仅提示不阻断保存）
  const externalInvalidRefs = (templateHealth?.invalidRefs ?? []).filter((r) => r.source !== 'site');

  /**
   * 站点默认模板配置面板。
   *
   * 走 Form.Slot 而非自绘 label：字段名是动态的（模型 code），进不了 Form 的受控字段，
   * 但 label 列必须与同一 Tab 内其他 Form 字段对齐，Slot 会继承 Form 的 labelPosition/labelWidth。
   */
  const renderTemplateDefaults = () => {
    const cfg = templateDefaults;
    const patch = (p: Partial<TemplateDefaultsState>) => setTemplateDefaults((s) => ({ ...s, ...p }));
    return (
      <>
        <Form.Slot label="列表模板">
          <Select
            placeholder="跟随主题默认"
            value={cfg.list ?? undefined}
            onChange={(v) => patch({ list: (v as string) ?? null })}
            showClear
            style={{ width: '100%' }}
            optionList={listTplOptions}
          />
        </Form.Slot>
        <Form.Slot label="详情模板">
          <Select
            placeholder="跟随主题默认"
            value={cfg.detail ?? undefined}
            onChange={(v) => patch({ detail: (v as string) ?? null })}
            showClear
            style={{ width: '100%' }}
            optionList={detailTplOptions}
          />
        </Form.Slot>
        {(allModels ?? []).map((m) => (
          <Form.Slot label={`${m.name}详情模板`} key={m.id}>
            <Select
              placeholder="跟随详情页默认"
              value={cfg.detailByModel[m.code] ?? undefined}
              onChange={(v) => patch({ detailByModel: { ...cfg.detailByModel, [m.code]: (v as string) ?? null } })}
              showClear
              style={{ width: '100%' }}
              optionList={detailTplOptions}
            />
          </Form.Slot>
        ))}
      </>
    );
  };

  // ─── 主题参数动态表单（settingsSchema 驱动，值存 settings.themeConfig）────────
  const themeConfigPatch = (name: string, value: unknown) =>
    setThemeConfig((c) => ({ ...c, [name]: value }));

  const renderThemeSettingControl = (field: CmsThemeSettingField) => {
    const value = themeConfig[field.name];
    switch (field.fieldType) {
      case 'switch':
        return (
          <Switch
            checked={typeof value === 'boolean' ? value : field.defaultValue === true}
            onChange={(v) => themeConfigPatch(field.name, v)}
          />
        );
      case 'number':
        return (
          <InputNumber
            value={typeof value === 'number' ? value : undefined}
            placeholder={field.placeholder ?? (field.defaultValue !== undefined ? `默认 ${field.defaultValue}` : undefined)}
            onChange={(v) => themeConfigPatch(field.name, typeof v === 'number' ? v : undefined)}
            style={{ width: 320 }}
          />
        );
      case 'select':
        return (
          <Select
            value={typeof value === 'string' ? value : undefined}
            placeholder={field.placeholder ?? '请选择'}
            showClear
            onChange={(v) => themeConfigPatch(field.name, v ?? undefined)}
            optionList={(field.options ?? []).map((o) => ({ value: o.value, label: o.label }))}
            style={{ width: 320 }}
          />
        );
      case 'textarea':
        return (
          <TextArea
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            rows={3}
            onChange={(v) => themeConfigPatch(field.name, v)}
            style={{ width: 480, maxWidth: '100%' }}
          />
        );
      case 'color': {
        const text = typeof value === 'string' ? value : '';
        const swatch = /^#[0-9a-fA-F]{3,8}$/.test(text) ? text : '#1f6feb';
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Input
              value={text}
              placeholder={field.placeholder ?? '如 #1f6feb'}
              showClear
              onChange={(v) => themeConfigPatch(field.name, v)}
              style={{ width: 240 }}
            />
            <input
              type="color"
              value={swatch}
              onChange={(e) => themeConfigPatch(field.name, e.target.value)}
              style={{ width: 32, height: 32, padding: 0, border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', cursor: 'pointer', background: 'transparent' }}
              aria-label={`${field.label}取色`}
            />
          </div>
        );
      }
      case 'image': {
        const url = typeof value === 'string' ? value : '';
        return (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: 480, maxWidth: '100%' }}>
            <div style={{ display: 'flex', gap: 8 }}>
              <Input
                value={url}
                placeholder={field.placeholder ?? '图片 URL，或点击上传'}
                showClear
                onChange={(v) => themeConfigPatch(field.name, v)}
                style={{ flex: 1 }}
              />
              <Upload
                action=""
                accept="image/*"
                showUploadList={false}
                disabled={!site}
                customRequest={async ({ fileInstance, onSuccess, onError }) => {
                  if (!site) { onError?.({ status: 0 }); return; }
                  try {
                    const formData = new FormData();
                    formData.append('file', fileInstance);
                    const res = await uploadCmsImage.mutateAsync({ siteId: site.id, formData });
                    themeConfigPatch(field.name, res.url);
                    onSuccess?.({});
                  } catch {
                    onError?.({ status: 0 });
                  }
                }}
              >
                <Button icon={<ImageUp size={14} />} disabled={!site}
                  title={site ? undefined : '保存站点后可上传，也可直接粘贴 URL'}>上传</Button>
              </Upload>
            </div>
            {url ? <img src={url} alt={field.label} style={{ maxWidth: 320, maxHeight: 120, borderRadius: 'var(--semi-border-radius-medium)', objectFit: 'cover', border: '1px solid var(--semi-color-border)' }} /> : null}
          </div>
        );
      }
      default:
        return (
          <Input
            value={typeof value === 'string' ? value : ''}
            placeholder={field.placeholder}
            showClear
            onChange={(v) => themeConfigPatch(field.name, v)}
            style={{ width: 320 }}
          />
        );
    }
  };

  /** 主题参数按 group 分组渲染（无 schema 的主题不显示该区域） */
  const renderThemeSettingsSections = () => {
    const schema = themeSettingsSchema ?? [];
    if (schema.length === 0) return null;
    const groups = new Map<string, CmsThemeSettingField[]>();
    for (const field of schema) {
      const key = field.group ?? '通用';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(field);
    }
    const rowStyle = { display: 'flex', alignItems: 'flex-start', gap: 12 } as const;
    const labelStyle = { width: 140, flexShrink: 0, textAlign: 'right', fontSize: 14, color: 'var(--semi-color-text-0)', lineHeight: '32px' } as const;
    return [...groups.entries()].map(([group, fields]) => (
      <Form.Section key={group} text={`主题专属参数 — ${group}`}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, paddingTop: 4 }}>
          {fields.map((field) => (
            <div style={rowStyle} key={field.name}>
              <span style={labelStyle}>{field.label}</span>
              <div style={{ flex: 1 }}>
                {renderThemeSettingControl(field)}
                {field.description ? (
                  <div style={{ fontSize: 12, color: 'var(--semi-color-text-2)', marginTop: 4 }}>{field.description}</div>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </Form.Section>
    ));
  };

  const renderWidgetSlotSection = () => {
    if (!site) return null;
    const slot = widgetSlotsQuery.data?.find((item) => item.key === 'home.sidebar');
    if (!slot) return null;
    return (
      <Form.Section text="页面部件插槽 — 首页侧栏">
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <Select
            value={homeSidebarWidgetId ?? undefined}
            placeholder="不绑定页面部件"
            showClear
            filter
            loading={widgetOptionsQuery.isFetching}
            optionList={(widgetOptionsQuery.data ?? []).map((widget) => ({
              value: widget.id,
              label: `${widget.name}（${widget.code}）`,
            }))}
            onChange={(value) => setHomeSidebarWidgetId(value == null ? null : Number(value))}
            style={{ width: 320 }}
          />
          <Select
            value={homeSidebarRenderer}
            optionList={(widgetRenderersQuery.data ?? []).map((renderer) => ({
              value: renderer.key,
              label: renderer.label,
            }))}
            onChange={(value) => setHomeSidebarRenderer(value as CmsWidgetRendererKey)}
            style={{ width: 180 }}
          />
          <Button
            type="primary"
            loading={saveWidgetSlotMutation.isPending}
            disabled={!hasPermission('cms:widget:bind')}
            onClick={async () => {
              await saveWidgetSlotMutation.mutateAsync({
                params: { slotKey: 'home.sidebar' },
                body: {
                  siteId: site.id,
                  widgetId: homeSidebarWidgetId,
                  rendererKey: homeSidebarRenderer,
                },
              });
              Toast.success('首页侧栏页面部件已更新');
            }}
          >
            保存插槽
          </Button>
        </div>
        <Typography.Text type="tertiary" size="small">
          Header/Footer 仍由主题 Layout 统一负责；这里只配置首页侧栏的可选页面部件。
        </Typography.Text>
      </Form.Section>
    );
  };

  return (
    <SideSheet
      title={site ? '编辑站点' : '新增站点'}
      visible={open}
      onCancel={onClose}
      width={720}
      closeOnEsc
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="tertiary" onClick={onClose}>取消</Button>
          <Button type="primary" theme="solid" loading={saveMutation.isPending} onClick={() => void handleSave()}>保存</Button>
        </div>
      )}
    >
      <Form
        key={site?.id ?? 'new'}
        getFormApi={(api) => { formApi.current = api; }}
        allowEmpty
        initValues={formInitValues}
        labelPosition="left"
        labelWidth={100}
        onValueChange={(vals) => {
          const t = (vals as { theme?: string }).theme;
          if (t && t !== selectedTheme) setSelectedTheme(t);
        }}
      >
        {/* keepDOM（默认）保证非激活页字段仍挂载，切换标签不丢值、validate 全量生效 */}
        <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={setActiveTab}>
          <TabPane tab="基础信息" itemKey="basic">
            <Row gutter={16} style={{ paddingTop: 16 }}>
              <Col span={12}>
                <Form.Input field="name" label="站点名称" rules={[{ required: true, message: '请输入站点名称' }]} />
              </Col>
              <Col span={12}>
                <Form.Input field="code" label="站点标识" disabled={!!site} placeholder="小写字母/数字/中划线" rules={[{ required: true, message: '请输入站点标识' }]} />
              </Col>
              {!site && hasPermission('cms:site:hierarchy') ? (
                <Col span={12}>
                  <Form.Select
                    field="parentId"
                    label="父级站点"
                    showClear
                    placeholder="留空创建根站点"
                    style={{ width: '100%' }}
                    optionList={siteIndentOptions(allSites ?? [])}
                  />
                </Col>
              ) : null}
              <Col span={12}>
                <Form.Input field="domain" label="绑定域名" placeholder="如 www.example.com" />
              </Col>
              <Col span={12}>
                <Form.TagInput field="aliasDomains" label="别名域名" placeholder="回车添加" />
              </Col>
              <Col span={12}>
                <Form.Select field="theme" label="主题" style={{ width: '100%' }}
                  optionList={(themes ?? []).map((t) => ({ value: t.code, label: t.label }))} />
              </Col>
              <Col span={12}>
                <Form.Select field="staticMode" label="静态化模式" style={{ width: '100%' }}
                  optionList={CMS_STATIC_MODES.map((m) => ({ value: m, label: CMS_STATIC_MODE_LABELS[m] }))} />
              </Col>
              <Col span={12}>
                <Form.Switch field="isDefault" label="默认站点" extraText="未匹配到域名的请求兜底到默认站点" />
              </Col>
              <Col span={12}>
                <Form.RadioGroup field="status" label="状态">
                  <Form.Radio value="enabled">启用</Form.Radio>
                  <Form.Radio value="disabled">停用</Form.Radio>
                </Form.RadioGroup>
              </Col>
            </Row>
          </TabPane>
          <TabPane tab="SEO 与推送" itemKey="seo">
            <div style={{ paddingTop: 16 }}>
              <Form.Input field="title" label="SEO 标题" labelWidth={140} placeholder="站点默认 title" />
              <Form.Input field="keywords" label="SEO 关键词" labelWidth={140} placeholder="逗号分隔" />
              <Form.TextArea field="description" label="SEO 描述" labelWidth={140} rows={2} />
              <Form.TextArea field="robots" label="robots.txt" labelWidth={140} rows={3} placeholder="留空使用默认规则（Allow all + Sitemap）" />
              <Form.Section text="搜索推送（配置后发布内容自动推送搜索引擎）">
                <Form.Input field="baiduPushToken" type="password" label="百度推送 Token" labelWidth={140} placeholder="留空或保留掩码表示不修改" />
                {site && <Form.Checkbox field="clearBaiduPushToken" noLabel>清除已配置的百度推送 Token</Form.Checkbox>}
                <Form.Input field="indexNowKey" type="password" label="IndexNow Key" labelWidth={140} placeholder="留空或保留掩码表示不修改" />
                {site && <Form.Checkbox field="clearIndexNowKey" noLabel>清除已配置的 IndexNow Key</Form.Checkbox>}
              </Form.Section>
              <Form.Section text="Social SEO">
                <Form.Input field="twitterSite" label="Twitter/X 站点账号" labelWidth={140} placeholder="@site" />
                <Form.Select field="twitterCard" label="Twitter Card" labelWidth={140} style={{ width: '100%' }}
                  optionList={CMS_TWITTER_CARDS.map((value) => ({ value, label: CMS_TWITTER_CARD_LABELS[value] }))} />
                <Form.Input field="socialImageAlt" label="默认社交图片说明" labelWidth={140} maxLength={255} />
              </Form.Section>
            </div>
          </TabPane>
          <TabPane tab="审核与 Webhook" itemKey="integration">
            <div style={{ paddingTop: 16 }}>
              <Form.Section text="内容审核">
                <Form.Select field="auditMode" label="审核方式" labelWidth={140} style={{ width: '100%' }}
                  optionList={[
                    { value: 'simple', label: '简单审核（审核 Tab 通过/驳回）' },
                    { value: 'workflow', label: '工作流审核（提交后走审批流程）' },
                  ]} />
                <Form.Select field="auditWorkflowDefinitionId" label="审核流程" labelWidth={140} style={{ width: '100%' }} showClear
                  placeholder="留空使用「CMS 内容审核」流程"
                  optionList={(publishedDefs ?? []).map((d) => ({ value: d.id, label: d.name }))} />
              </Form.Section>
              <Form.Section text="Webhook（内容发布/下线/回收时向外部系统推送事件）">
                <Form.Input field="webhookUrl" label="回调地址" labelWidth={140} placeholder="https://... 留空不推送" />
                <Form.Input field="webhookSecret" type="password" label="签名密钥" labelWidth={140} placeholder="留空或保留掩码表示不修改" />
                {site && <Form.Checkbox field="clearWebhookSecret" noLabel>清除已配置的 Webhook 签名密钥</Form.Checkbox>}
              </Form.Section>
              <Form.Section text="前台防护">
                <Form.Switch field="captchaEnabled" label="图形验证码" labelWidth={140} extraText="开启后前台游客提交评论/自定义表单需完成算术验证码（登录会员免验证）" />
              </Form.Section>
              <Form.Section text="CDN 刷新（静态页更新后向 purge webhook 推送变更路径）">
                <Form.Input field="cdnPurgeUrl" label="刷新回调地址" labelWidth={140} placeholder="https://... 留空不启用" />
                <Form.Input field="cdnPurgeToken" label="鉴权令牌" labelWidth={140} placeholder="可选；Authorization: Bearer 携带" />
                {site && <Form.Checkbox field="clearCdnPurgeToken" noLabel>清除已配置的 CDN 鉴权令牌</Form.Checkbox>}
              </Form.Section>
              <Form.Section text="多语言站点关联（前台输出 hreflang 与语言切换）">
                <Form.Input field="language" label="本站语言" labelWidth={140} placeholder="如 zh-CN；留空不启用" />
                <Form.TextArea field="langLinksText" label="关联站点" labelWidth={140} rows={3}
                  placeholder={'每行一条：语言代码=站点标识\n如 en-US=en-site'} />
              </Form.Section>
            </div>
          </TabPane>
          <TabPane tab="扩展模型" itemKey="extendModel">
            <div style={{ paddingTop: 16 }}>
              <Form.Section text="站点扩展模型">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Select field="modelId" label="绑定模型" labelWidth={140} showClear style={{ width: '100%' }}
                      placeholder="不绑定"
                      onChange={(value) => setSelectedModelId(value == null ? undefined : Number(value))}
                      optionList={(allModels ?? []).map((m) => ({ value: m.id, label: `${m.name}（${m.code}）` }))}
                      extraText="绑定后可为站点维护自定义字段，主题通过 site.extend.{字段标识} 读取" />
                  </Col>
                </Row>
              </Form.Section>
              {siteModelFields.length > 0 ? (
                <Form.Section text={`扩展字段（${siteModel?.name}）`}>
                  <Row gutter={16}>
                    {siteModelFields.map((f) => (
                      <Col key={f.name} span={f.fieldType === 'textarea' || f.fieldType === 'richtext' ? 24 : 12}>
                        <SiteModelFieldControl field={f} />
                      </Col>
                    ))}
                  </Row>
                </Form.Section>
              ) : (
                <Typography.Text type="tertiary">
                  {siteModel ? '该模型未配置扩展字段，请先到「内容模型」中添加。' : '选择模型后在此维护站点自定义字段。'}
                </Typography.Text>
              )}
            </div>
          </TabPane>
          <TabPane tab="内容策略" itemKey="contentPolicy">
            <div style={{ paddingTop: 16 }}>
              <Form.Section text="编辑与回收站">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Switch field="publishedContentEditable" label="已发布内容可编辑" labelWidth={160}
                      extraText="关闭后已发布内容需先下线才能修改" />
                  </Col>
                  <Col span={12}>
                    <Form.InputNumber field="recycleKeepDays" label="回收站保留天数" labelWidth={160} min={0} max={3650}
                      style={{ width: '100%' }} extraText="超期由每日周期任务彻底删除；0 = 永久保留" />
                  </Col>
                </Row>
              </Form.Section>
              <Form.Section text="发布性能">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.InputNumber field="maxPageOnContentPublish" label="重建列表页数上限" labelWidth={160} min={0} max={1000}
                      style={{ width: '100%' }} extraText="单条内容发布时最多重建栏目前 N 页；0 = 全部重建" />
                  </Col>
                </Row>
              </Form.Section>
              <Form.Section text="开放 API 发布">
                <Form.Switch
                  field="openApiPublishEnabled"
                  label="允许开放 API 直接发布"
                  labelWidth={160}
                  extraText="开启后仍需应用具备 cms:publish scope 且授权行允许直接发布"
                />
              </Form.Section>
              <Form.Section text="保存时自动处理">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Switch field="autoReplaceSensitiveWords" label="自动替换敏感词" labelWidth={160}
                      extraText="按敏感词库替换标题/摘要/正文；命中拦截词仍会拒绝保存" />
                  </Col>
                  <Col span={12}>
                    <Form.Switch field="autoReplaceErrorProneWords" label="自动替换易错词" labelWidth={160}
                      extraText="按易错词库将常见错词替换为正确写法" />
                  </Col>
                  <Col span={12}>
                    <Form.Switch field="autoCoverFromBody" label="正文首图作封面" labelWidth={160}
                      extraText="未填写封面图时，保存自动提取正文第一张图片" />
                  </Col>
                </Row>
              </Form.Section>
            </div>
          </TabPane>
          <TabPane tab="主题与图片" itemKey="appearance">
            <div style={{ paddingTop: 16 }}>
              <Form.Section text="主题参数">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Input field="themePrimary" label="主题色" labelWidth={140} placeholder="如 #1f6feb，留空用主题默认" />
                  </Col>
                  <Col span={12}>
                    <Form.Select field="themeDark" label="暗色模式" labelWidth={140} style={{ width: '100%' }}
                      optionList={[
                        { value: 'light', label: '仅浅色' },
                        { value: 'auto', label: '跟随系统（带切换按钮）' },
                        { value: 'dark', label: '支持切换（带切换按钮）' },
                      ]} />
                  </Col>
                </Row>
              </Form.Section>
              {renderThemeSettingsSections()}
              {renderWidgetSlotSection()}
              <Form.Section text="图片处理（编辑器/封面上传时生效）">
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.InputNumber field="imageMaxWidth" label="最大宽度(px)" labelWidth={140} min={0} style={{ width: '100%' }} extraText="超宽等比压缩，0 = 不限制" />
                  </Col>
                  <Col span={12}>
                    <Form.Switch field="thumbEnabled" label="生成缩略图" labelWidth={140} />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.InputNumber field="thumbWidth" label="缩略图宽度(px)" labelWidth={140} min={0} style={{ width: '100%' }} extraText="开启缩略图后生效" />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Switch field="watermarkEnabled" label="文字水印" labelWidth={140} />
                  </Col>
                  <Col span={12}>
                    <Form.Input field="watermarkText" label="水印文字" labelWidth={140} placeholder="如站点名称" />
                  </Col>
                </Row>
                <Row gutter={16}>
                  <Col span={12}>
                    <Form.Select field="watermarkPosition" label="水印位置" labelWidth={140} style={{ width: '100%' }}
                      optionList={[
                        { value: 'northwest', label: '左上' }, { value: 'north', label: '上中' }, { value: 'northeast', label: '右上' },
                        { value: 'west', label: '左中' }, { value: 'center', label: '居中' }, { value: 'east', label: '右中' },
                        { value: 'southwest', label: '左下' }, { value: 'south', label: '下中' }, { value: 'southeast', label: '右下' },
                      ]} />
                  </Col>
                  <Col span={12}>
                    <FormSliderInput
                      field="watermarkOpacity"
                      label="水印不透明度(%)"
                      labelWidth={140}
                      min={0}
                      max={100}
                      step={1}
                      suffix="%"
                      showBoundary
                      aria-label="水印不透明度"
                      getAriaValueText={(value) => `${value}%`}
                    />
                  </Col>
                </Row>
              </Form.Section>
            </div>
          </TabPane>
          <TabPane tab="模板与主题" itemKey="templates">
            <div style={{ paddingTop: 16 }}>
              {externalInvalidRefs.length > 0 && (
                <Banner
                  type="warning"
                  closeIcon={null}
                  style={{ marginBottom: 16 }}
                  description={(
                    <div>
                      主题「{selectedTheme}」下存在 {externalInvalidRefs.length} 处失效模板引用；内置主题会回退默认模板，签名 DSL 主题将明确渲染失败：
                      <ul style={{ margin: '4px 0 0', paddingLeft: 20 }}>
                        {externalInvalidRefs.slice(0, 8).map((ref, i) => (
                          <li key={i}>{describeInvalidRef(ref)}</li>
                        ))}
                        {externalInvalidRefs.length > 8 && <li>等共 {externalInvalidRefs.length} 处…</li>}
                      </ul>
                      请到栏目管理 / 内容编辑中调整对应模板配置。
                    </div>
                  )}
                />
              )}
              <Form.Section text="默认模板（栏目/内容未指定模板时的站点级兜底；留空 = 主题默认）">
                {renderTemplateDefaults()}
              </Form.Section>
            </div>
          </TabPane>
          <TabPane tab="备案与备注" itemKey="misc">
            <div style={{ paddingTop: 16 }}>
              <Row gutter={16}>
                <Col span={12}>
                  <Form.Input field="icp" label="ICP 备案号" />
                </Col>
                <Col span={12}>
                  <Form.Input field="copyright" label="版权信息" />
                </Col>
              </Row>
              <Form.Input field="remark" label="备注" />
            </div>
          </TabPane>
        </Tabs>
      </Form>
    </SideSheet>
  );
}
