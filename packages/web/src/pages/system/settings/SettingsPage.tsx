import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Button, Empty, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { ExternalLink, Save, Settings2 } from 'lucide-react';
import { emptyIllustration } from '@/components/EmptyIllustration';
import {
  CAPTCHA_COMPLEXITY_LABELS,
  SETTINGS_MODULES,
  isSettingsModuleKey,
  type SettingsModuleKey,
  type SettingsModuleMeta,
} from '@zenith/shared/settings';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { NavListItem, NavListPanel } from '@/components/NavListPanel';
import { SchemaForm } from '@/components/settings/SchemaForm';
import { useUrlSelectionState } from '@/hooks/useUrlSelectionState';
import { useSaveSettings, useSettings, useSettingsModules } from '@/hooks/queries/settings';
import { ApiError } from '@/lib/query';

const { Text, Title } = Typography;

/** 枚举字段展示文案（键 = 字段路径）；有专用页面的模块不经通用表单，这里只登记通用页会渲染的 */
const ENUM_LABELS: Record<string, Record<string, string>> = {
  captchaComplexity: CAPTCHA_COMPLEXITY_LABELS,
};

const SCOPE_LABELS = { platform: '平台级', tenant: '租户级' } as const;

/**
 * 通用设置页：左侧模块清单（按权限 / License 过滤），右侧由模块 Zod schema 驱动的表单。
 * 有专用页面的模块（身份安全 / 网盘 / 知识库 / IP 访问控制）在右侧只给跳转入口。
 * 页面级全局配置表单，不走 useEditModal（无弹窗、保存后不关闭）。
 */
export default function SettingsPage() {
  const modulesQuery = useSettingsModules();
  const modules = useMemo(() => modulesQuery.data ?? [], [modulesQuery.data]);
  const [selectedKey, setSelectedKey] = useUrlSelectionState('module');
  // 窄屏单栏下若沿用桌面端「默认选中首项」会直接落到详情，列表反而要点返回才能看到；
  // 布局形态参与选中派生，故用 state
  const [isNarrowLayout, setIsNarrowLayout] = useState(false);

  // URL 深链值优先；无深链时桌面端回退首项（默认选中不入 URL），窄屏不自动选中
  const explicitMeta = selectedKey !== null && isSettingsModuleKey(selectedKey)
    ? modules.find((m) => m.module === selectedKey) ?? null
    : null;
  const activeMeta = explicitMeta ?? (isNarrowLayout ? null : modules[0] ?? null);
  const activeKey: SettingsModuleKey | null = activeMeta?.module ?? null;

  // 清单不分页且无详情接口兜底：等数据落定再判定深链目标不存在（非法 key / 无权限）并清参，避免在途误清
  useEffect(() => {
    if (selectedKey === null || explicitMeta !== null) return;
    if (modulesQuery.data && !modulesQuery.isFetching) setSelectedKey(null);
  }, [selectedKey, explicitMeta, modulesQuery.data, modulesQuery.isFetching, setSelectedKey]);

  return (
    <div className="page-container page-container--stretch">
      <MasterDetailLayout
        defaultSize={260}
        minSize={200}
        maxSize={400}
        persistKey="system-settings"
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        showDetail={activeKey !== null}
        onBack={() => setSelectedKey(null)}
        onResponsiveChange={setIsNarrowLayout}
        master={(
          <NavListPanel<SettingsModuleMeta>
            title="设置模块"
            loading={modulesQuery.isLoading}
            emptyText="没有可访问的设置模块"
            dataSource={modules}
            renderItem={(item) => (
              <NavListItem
                key={item.module}
                active={item.module === activeKey}
                onClick={() => setSelectedKey(item.module)}
                icon={<Settings2 size={16} />}
                primary={item.title}
                meta={(
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                    <Tag size="small" color={item.scope === 'tenant' ? 'blue' : 'grey'}>{SCOPE_LABELS[item.scope]}</Tag>
                    {item.overriddenCount > 0 ? <Tag size="small" color="orange">{item.overriddenCount} 项覆盖</Tag> : null}
                    {item.page ? <Tag size="small">专用页面</Tag> : null}
                  </span>
                )}
              />
            )}
          />
        )}
        detail={activeKey && activeMeta ? <ModuleDetail key={activeKey} module={activeKey} meta={activeMeta} /> : (
          <div style={{ padding: 48 }}>
            <Empty {...emptyIllustration('NoContent', 120)} description="选择左侧模块查看或修改设置" />
          </div>
        )}
      />
    </div>
  );
}

function ModuleDetail({ module, meta }: { readonly module: SettingsModuleKey; readonly meta: SettingsModuleMeta }) {
  const def = SETTINGS_MODULES[module];
  const query = useSettings(module);
  const save = useSaveSettings(module);
  const envelope = query.data;
  const [draft, setDraft] = useState<Record<string, unknown> | null>(null);
  useEffect(() => { setDraft(null); }, [envelope?.version]);
  const value = useMemo(() => (draft ?? (envelope?.effective as Record<string, unknown> | undefined) ?? null), [draft, envelope]);
  const dirty = draft !== null && JSON.stringify(draft) !== JSON.stringify(envelope?.effective);

  async function handleSave() {
    if (!envelope || !value) return;
    const parsed = def.schema.safeParse(value);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      Toast.error(`${issue.path.join('.') || '表单'}：${issue.message}`);
      return;
    }
    try {
      await save.mutateAsync({ body: { version: envelope.version, data: parsed.data } });
      setDraft(null);
      Toast.success('设置已保存');
    } catch (err) {
      // 409 = 他人已修改：请求层已弹出服务端文案，这里只丢弃草稿并重载最新值
      if (err instanceof ApiError && err.code === 409) {
        setDraft(null);
        void query.refetch();
      }
    }
  }

  return (
    <MasterDetailLayout.Body padding={24}>
      <div style={{ maxWidth: 760 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 8 }}>
          <div>
            <Title heading={5} style={{ margin: 0 }}>{def.title}</Title>
            <Text type="tertiary">{def.description}</Text>
          </div>
          {!meta.page && meta.canWrite ? (
            <Button theme="solid" icon={<Save size={14} />} loading={save.isPending} disabled={!dirty} onClick={() => void handleSave()}>保存</Button>
          ) : null}
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
          <Tag color={meta.scope === 'tenant' ? 'blue' : 'grey'}>{SCOPE_LABELS[meta.scope]}</Tag>
          {meta.feature ? <Tag>License 特性：{meta.feature}</Tag> : null}
          {envelope ? <Tag>版本 {envelope.version}</Tag> : null}
          {envelope?.updatedAt ? <Text type="tertiary" size="small">最后修改 {envelope.updatedAt}</Text> : null}
        </div>

        {meta.page ? (
          <Banner
            type="info"
            closeIcon={null}
            description={(
              <span>
                该模块有专用设置页面，请前往
                <Link to={meta.page} style={{ margin: '0 4px', display: 'inline-flex', alignItems: 'center', gap: 4 }}>{def.title}<ExternalLink size={12} /></Link>
                修改。
              </span>
            )}
          />
        ) : null}
        {!meta.page && !meta.canWrite ? (
          <Banner type="warning" closeIcon={null} description={meta.scope === 'platform' ? '平台级设置仅平台管理员可修改，当前为只读。' : '当前账号没有修改权限，当前为只读。'} />
        ) : null}

        <Spin spinning={query.isLoading}>
          {envelope && value ? (
            <SchemaForm
              schema={def.schema}
              value={value}
              inheritedValue={envelope.inherited as Record<string, unknown>}
              onChange={setDraft}
              disabled={Boolean(meta.page) || !meta.canWrite}
              enumLabels={ENUM_LABELS}
            />
          ) : null}
        </Spin>
      </div>
    </MasterDetailLayout.Body>
  );
}
