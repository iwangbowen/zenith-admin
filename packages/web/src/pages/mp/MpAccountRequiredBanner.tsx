import type { CSSProperties } from 'react';
import { Banner } from '@douyinfe/semi-ui';

interface MpAccountRequiredBannerProps {
  /** 公众号列表加载中（加载期间不提示，避免闪现） */
  loading: boolean;
  accountCount: number;
  /** 缺省与下方内容留 12px 间距；嵌在工具栏行内时传 `{}` */
  style?: CSSProperties;
}

/** 公众号模块各页共用的「尚未配置公众号」提示：列表为空且加载完成时显示 */
export function MpAccountRequiredBanner({ loading, accountCount, style = { marginBottom: 12 } }: Readonly<MpAccountRequiredBannerProps>) {
  if (loading || accountCount > 0) return null;
  return <Banner type="warning" fullMode={false} description="尚未配置公众号，请先在「公众号账号」中添加公众号。" style={style} />;
}

export default MpAccountRequiredBanner;
