/**
 * 工作流统一抽屉外壳
 *
 * 发起抽屉与审批/详情抽屉共用，统一宽度 / 内边距 / 标题 / footer 布局。
 * footer 采用「左侧次要操作 + 右侧主操作」两段式：
 *   - footerLeft：如「在新页签打开」
 *   - footerRight：如「取消 / 保存草稿 / 提交」或「同意 / 拒绝 / 转办 …」
 * 两者皆为空时不渲染 footer。
 */
import type { ReactNode } from 'react';
import { SideSheet } from '@douyinfe/semi-ui';

const DEFAULT_WIDTH = 760;
const SPLIT_WIDTH = 1080;

interface Props {
  title: ReactNode;
  visible: boolean;
  onCancel: () => void;
  width?: number;
  /** 'split'：两栏布局——body 去内边距并撑满高度，供 WorkflowProcessLayout 使用 */
  variant?: 'default' | 'split';
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  children: ReactNode;
}

export default function WorkflowSideSheet({
  title,
  visible,
  onCancel,
  width,
  variant = 'default',
  footerLeft,
  footerRight,
  children,
}: Readonly<Props>) {
  const hasFooter = footerLeft != null || footerRight != null;
  const isSplit = variant === 'split';
  const resolvedWidth = width ?? (isSplit ? SPLIT_WIDTH : DEFAULT_WIDTH);
  return (
    <SideSheet
      title={title}
      visible={visible}
      onCancel={onCancel}
      width={resolvedWidth}
      bodyStyle={isSplit
        ? { padding: 0, height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }
        : { padding: 16 }}
      footer={hasFooter ? (
        <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>{footerLeft}</div>
          <div>{footerRight}</div>
        </div>
      ) : undefined}
    >
      {isSplit
        ? <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>{children}</div>
        : children}
    </SideSheet>
  );
}
