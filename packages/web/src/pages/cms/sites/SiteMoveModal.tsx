/** 移动站点弹窗：整棵子树随迁；排除自身后代防环，服务端另有环与层深校验 */
import { useEffect, useMemo, useState } from 'react';
import { Banner, Select, Toast } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import { useAllCmsSites, useMoveCmsSite } from '@/hooks/queries/cms';
import type { CmsSite } from '@zenith/shared/cms';
import { collectFlatSiteDescendantIds, siteIndentOptions } from './site-tree-utils';

interface SiteMoveModalProps {
  readonly site: CmsSite | null;
  readonly onClose: () => void;
}

export default function SiteMoveModal({ site, onClose }: Readonly<SiteMoveModalProps>) {
  const [parentId, setParentId] = useState<number | null>(null);
  const { data: allSites } = useAllCmsSites();
  const moveSiteMutation = useMoveCmsSite();

  // 打开时以当前父级为初值
  useEffect(() => {
    setParentId(site?.parentId ?? null);
  }, [site]);

  const parentOptions = useMemo(() => {
    const sites = allSites ?? [];
    const excluded = site ? collectFlatSiteDescendantIds(sites, site.id) : new Set<number>();
    return siteIndentOptions(sites.filter((s) => !excluded.has(s.id)));
  }, [allSites, site]);

  async function handleOk() {
    if (!site) return;
    const result = await moveSiteMutation.mutateAsync({ params: { id: site.id }, body: { parentId } });
    Toast.success(`移动成功，已为 ${result.affectedSiteIds.length} 个受影响站点提交重建`);
    onClose();
  }

  return (
    <AppModal
      title={site ? `移动站点「${site.name}」` : '移动站点'}
      visible={!!site}
      onOk={handleOk}
      onCancel={onClose}
      okButtonProps={{ loading: moveSiteMutation.isPending }}
      width={520}
      closeOnEsc
    >
      <Banner
        type="warning"
        closeIcon={null}
        style={{ marginBottom: 16 }}
        description="移动会保留整棵子树；系统会阻止环与超过 8 层的移动，并为受影响站点提交 fenced 重建任务。"
      />
      <div style={{ marginBottom: 8 }}>新父级站点</div>
      <Select
        showClear
        filter
        placeholder="留空移动为根站点"
        value={parentId ?? undefined}
        onChange={(value) => setParentId(typeof value === 'number' ? value : null)}
        optionList={parentOptions}
        style={{ width: '100%' }}
      />
    </AppModal>
  );
}
