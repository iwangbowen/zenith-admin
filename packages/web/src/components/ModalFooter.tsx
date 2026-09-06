import type { ReactNode } from 'react';
import { Button } from '@douyinfe/semi-ui';

export interface ModalFooterProps {
  onCancel: () => void;
  /** 确认动作；返回 Promise 时由调用方（如 `useEditModal`）负责 loading 状态 */
  onOk: () => unknown;
  /** 默认「确定」；表单弹窗一般传「保存」 */
  okText?: ReactNode;
  cancelText?: ReactNode;
  loading?: boolean;
  disabled?: boolean;
  okType?: 'primary' | 'danger' | 'warning';
  /** 靠左的次要动作（重置 / 下载模板 / 删除…），与右侧取消 / 确认两端对齐 */
  extra?: ReactNode;
}

/**
 * 弹窗 / 侧滑抽屉底部的「取消 + 确认」操作区。
 * 全站 `SideSheet` / `Modal` 自定义 footer 统一用它，保证按钮顺序、主次样式与间距一致；
 * 配合 `useEditModal` 直接展开：`<ModalFooter {...modal.footerProps} okText="保存" />`。
 */
export function ModalFooter({
  onCancel,
  onOk,
  okText = '确定',
  cancelText = '取消',
  loading,
  disabled,
  okType = 'primary',
  extra,
}: Readonly<ModalFooterProps>) {
  return (
    <div style={{ display: 'flex', justifyContent: extra ? 'space-between' : 'flex-end', alignItems: 'center', gap: 8 }}>
      {extra ? <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{extra}</div> : null}
      <div style={{ display: 'flex', gap: 8 }}>
        <Button type="tertiary" onClick={onCancel}>{cancelText}</Button>
        <Button type={okType} theme="solid" loading={loading} disabled={disabled} onClick={() => { void onOk(); }}>
          {okText}
        </Button>
      </div>
    </div>
  );
}

export default ModalFooter;
