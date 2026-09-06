import { TreeSelect } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { useEffect, useMemo, useRef } from 'react';
import { useAllCmsSites } from '@/hooks/queries/cms';
import type { CmsSite } from '@zenith/shared/cms';

interface CmsSiteSelectProps {
  value: number | undefined;
  onChange: (siteId: number) => void;
  width?: number | string;
}

/** 当前站点选择的持久化 key：全部 CMS 管理页共享同一份 */
const CMS_SITE_STORAGE_KEY = 'zenith_cms_site';

function readStoredSiteId(): number | undefined {
  try {
    const raw = localStorage.getItem(CMS_SITE_STORAGE_KEY);
    const id = raw ? Number(raw) : Number.NaN;
    return Number.isInteger(id) && id > 0 ? id : undefined;
  } catch {
    return undefined;
  }
}

function storeSiteId(id: number): void {
  try {
    localStorage.setItem(CMS_SITE_STORAGE_KEY, String(id));
  } catch {
    // storage 不可用时静默降级为页面内状态
  }
}

/** 平铺站点 → 树节点（站群父子层级）；父级不可见（越权/被删）的节点挂到根，避免站点凭空消失 */
function buildSiteTree(sites: CmsSite[]): TreeNodeData[] {
  const visible = new Set(sites.map((s) => s.id));
  const children = new Map<number | null, CmsSite[]>();
  for (const site of sites) {
    const parent = site.parentId != null && visible.has(site.parentId) ? site.parentId : null;
    children.set(parent, [...(children.get(parent) ?? []), site]);
  }
  const toNode = (site: CmsSite): TreeNodeData => ({
    key: `site-${site.id}`,
    value: site.id,
    label: site.name,
    children: (children.get(site.id) ?? []).map(toNode),
  });
  return (children.get(null) ?? []).map(toNode);
}

/**
 * CMS 各管理页共用的站点切换器（树形展示站群父子层级）。
 *
 * 「当前站点」为全 CMS 模块共享上下文：任一页面切换站点即写入 localStorage，
 * 其余页面（以及 F5 刷新后）挂载时自动恢复同一站点。
 * 恢复优先级：已存储站点（仍有权限可见）→ 默认站点 → 首个站点。
 *
 * onChange 经 ref 消费，调用方无需为引用稳定包 useCallback。
 */
export function CmsSiteSelect({ value, onChange, width = 200 }: Readonly<CmsSiteSelectProps>) {
  const { data: sites } = useAllCmsSites();
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const treeData = useMemo(() => buildSiteTree(sites ?? []), [sites]);

  useEffect(() => {
    if (value === undefined && sites && sites.length > 0) {
      const stored = readStoredSiteId();
      const preferred = sites.find((s) => s.id === stored)
        ?? sites.find((s) => s.isDefault)
        ?? sites[0];
      onChangeRef.current(preferred.id);
    }
  }, [value, sites]);

  return (
    <TreeSelect
      placeholder="选择站点"
      value={value}
      onChange={(v) => {
        if (typeof v !== 'number') return;
        storeSiteId(v);
        onChangeRef.current(v);
      }}
      style={{ width }}
      dropdownStyle={{ maxHeight: 360, overflow: 'auto' }}
      treeData={treeData}
      expandAll
      filterTreeNode
      searchPosition="trigger"
      showClear={false}
    />
  );
}

/** 生成站点前台预览地址（无域名绑定时走 /__cms/{code} 预览前缀） */
export function cmsPreviewUrl(siteCode: string, path = ''): string {
  return `/__cms/${siteCode}/${path.replace(/^\/+/, '')}`;
}
