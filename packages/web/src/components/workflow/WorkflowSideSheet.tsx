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

interface Props {
  title: ReactNode;
  visible: boolean;
  onCancel: () => void;
  width?: number;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  children: ReactNode;
}

export default function WorkflowSideSheet({
  title,
  visible,
  onCancel,
  width = DEFAULT_WIDTH,
  footerLeft,
  footerRight,
  children,
}: Readonly<Props>) {
  const hasFooter = footerLeft != null || footerRight != null;
  return (
    <SideSheet
      title={title}
      visible={visible}
      onCancel={onCancel}
      width={width}
      bodyStyle={{ padding: 16 }}
      footer={hasFooter ? (
        <div style={{ display: 'flex', width: '100%', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>{footerLeft}</div>
          <div>{footerRight}</div>
        </div>
      ) : undefined}
    >
      {children}
    </SideSheet>
  );
}
