import { Select } from '@douyinfe/semi-ui';
import { useEffect } from 'react';
import { useAllCmsSites } from '@/hooks/queries/cms';

interface CmsSiteSelectProps {
  value: number | undefined;
  onChange: (siteId: number) => void;
  width?: number;
}

/** CMS 各管理页共用的站点切换器：自动选中默认/首个站点 */
export function CmsSiteSelect({ value, onChange, width = 200 }: Readonly<CmsSiteSelectProps>) {
  const { data: sites } = useAllCmsSites();

  useEffect(() => {
    if (value === undefined && sites && sites.length > 0) {
      const preferred = sites.find((s) => s.isDefault) ?? sites[0];
      onChange(preferred.id);
    }
  }, [value, sites, onChange]);

  return (
    <Select
      placeholder="选择站点"
      value={value}
      onChange={(v) => onChange(v as number)}
      style={{ width }}
      optionList={(sites ?? []).map((s) => ({ value: s.id, label: s.name }))}
    />
  );
}

/** 生成站点前台预览地址（无域名绑定时走 /__cms/{code} 预览前缀） */
export function cmsPreviewUrl(siteCode: string, path = ''): string {
  return `/__cms/${siteCode}/${path.replace(/^\/+/, '')}`;
}
