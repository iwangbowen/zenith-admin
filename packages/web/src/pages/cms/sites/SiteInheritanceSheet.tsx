/**
 * 继承配置 SideSheet：逐字段切换「沿父级链继承 / 本站覆盖」，
 * 展示有效值来源（继承自哪个父级 / 本站）与继承链。
 */
import { useEffect, useState } from 'react';
import { Banner, Button, SideSheet, Space, Switch, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { useCmsSiteEffectiveConfig, useCmsSiteInheritanceChain, useUpdateCmsSiteInheritance } from '@/hooks/queries/cms';
import { CMS_SITE_INHERITABLE_FIELD_LABELS, CMS_SITE_INHERITABLE_FIELDS } from '@zenith/shared/cms';
import type { CmsSite, CmsSiteInheritanceFlags } from '@zenith/shared/cms';
import { displayEffectiveValue } from './site-tree-utils';

const { Text } = Typography;

const EMPTY_INHERITANCE: CmsSiteInheritanceFlags = {
  seoTitle: false,
  seoKeywords: false,
  seoDescription: false,
  staticMode: false,
  reviewMode: false,
  webhook: false,
  cdn: false,
  theme: false,
  themeConfig: false,
  templates: false,
};

interface SiteInheritanceSheetProps {
  readonly site: CmsSite | null;
  readonly onClose: () => void;
}

export default function SiteInheritanceSheet({ site, onClose }: Readonly<SiteInheritanceSheetProps>) {
  const [draft, setDraft] = useState<CmsSiteInheritanceFlags>(EMPTY_INHERITANCE);
  const effectiveConfigQuery = useCmsSiteEffectiveConfig(site?.id, !!site);
  const inheritanceChainQuery = useCmsSiteInheritanceChain(site?.id, !!site);
  const updateInheritanceMutation = useUpdateCmsSiteInheritance();

  // 打开时先用站点记录初始化，有效配置返回后以服务端 inheritance 为准刷新
  useEffect(() => {
    if (!site) return;
    const flags = effectiveConfigQuery.data?.inheritance ?? site.inheritance;
    setDraft({ ...EMPTY_INHERITANCE, ...(flags ?? {}) });
  }, [effectiveConfigQuery.data?.inheritance, site]);

  async function handleSave() {
    if (!site) return;
    const result = await updateInheritanceMutation.mutateAsync({
      params: { id: site.id },
      body: draft,
    });
    Toast.success(`继承策略已保存，影响 ${result.affectedSiteIds.length} 个站点`);
    onClose();
  }

  return (
    <SideSheet
      title={site ? `继承配置 —「${site.name}」` : '继承配置'}
      visible={!!site}
      onCancel={onClose}
      width={760}
      closeOnEsc
      footer={(
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
          <Button type="tertiary" onClick={onClose}>取消</Button>
          <Button
            type="primary"
            loading={updateInheritanceMutation.isPending}
            disabled={site?.parentId == null}
            onClick={() => void handleSave()}
          >
            保存继承策略
          </Button>
        </div>
      )}
    >
      <Banner
        type="info"
        closeIcon={null}
        description="开关开启表示该项沿父级链解析；关闭表示使用本站覆盖值。Webhook/CDN 密钥仅显示掩码，继承不会回显父级明文。"
        style={{ marginBottom: 16 }}
      />
      <div style={{ marginBottom: 16 }}>
        <b>继承链：</b>
        {(inheritanceChainQuery.data ?? []).map((chainSite, index) => (
          <span key={chainSite.id}>
            {index > 0 ? ' → ' : ''}
            {chainSite.name}
          </span>
        ))}
      </div>
      <div style={{ border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', overflow: 'hidden' }}>
        {CMS_SITE_INHERITABLE_FIELDS.map((field, index) => {
          const source = effectiveConfigQuery.data?.sources[field];
          const value = effectiveConfigQuery.data
            ? displayEffectiveValue(field, effectiveConfigQuery.data.resolved as unknown as Record<string, unknown>)
            : '-';
          return (
            <div
              key={field}
              style={{
                display: 'grid',
                gridTemplateColumns: '130px 110px 150px minmax(0, 1fr)',
                gap: 12,
                alignItems: 'center',
                padding: '12px 14px',
                borderTop: index ? '1px solid var(--semi-color-border)' : undefined,
              }}
            >
              <b>{CMS_SITE_INHERITABLE_FIELD_LABELS[field]}</b>
              <Space spacing={8}>
                <Switch
                  checked={draft[field]}
                  disabled={site?.parentId == null}
                  onChange={(checked) => setDraft((value) => ({ ...value, [field]: checked }))}
                />
                <Text size="small" type="tertiary">{draft[field] ? '继承' : '覆盖'}</Text>
              </Space>
              <Tag color={source?.kind === 'inherited' ? 'blue' : 'green'} size="small">
                {source?.kind === 'inherited'
                  ? `继承：${source.siteName ?? '受限父级'}`
                  : '本站'}
              </Tag>
              <span style={{ color: 'var(--semi-color-text-1)', overflowWrap: 'anywhere' }}>{value}</span>
            </div>
          );
        })}
      </div>
    </SideSheet>
  );
}
