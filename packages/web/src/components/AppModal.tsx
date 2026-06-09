import { useState } from 'react';
import { Modal } from '@douyinfe/semi-ui';
import type { ModalReactProps } from '@douyinfe/semi-ui/lib/es/modal';
import { Maximize2, Minimize2, X } from 'lucide-react';
import './AppModal.css';

export interface AppModalProps extends Omit<ModalReactProps, 'header' | 'closable' | 'closeIcon' | 'fullScreen'> {
  /** 是否显示全屏切换按钮，默认 true */
  fullscreenable?: boolean;
  /**
   * 受控全屏状态。传入时 AppModal 进入受控模式，全屏由外部管理。
   * 必须与 onToggleFullscreen 配合使用。
   */
  fullscreen?: boolean;
  /** 受控模式下的全屏切换回调 */
  onToggleFullscreen?: () => void;
}

/**
 * 带全屏切换能力的 Modal 封装。
 * 右上角同时展示「全屏/还原」按钮和「关闭」按钮。
 * 所有 Semi Modal props（width、footer、onOk 等）均透传。
 *
 * 支持两种全屏控制模式：
 * - 非受控（默认）：组件内部维护 fullscreen 状态，适合普通表单弹窗
 * - 受控：传入 `fullscreen` + `onToggleFullscreen`，适合需要外部感知全屏变化的场景（如文件预览）
 */
export function AppModal({
  title,
  onCancel,
  fullscreenable = true,
  fullscreen: controlledFullscreen,
  onToggleFullscreen,
  children,
  ...rest
}: Readonly<AppModalProps>) {
  const [internalFullscreen, setInternalFullscreen] = useState(false);

  // 受控模式：外部传入 fullscreen；非受控模式：使用内部 state
  const isControlled = controlledFullscreen !== undefined;
  const fullscreen = isControlled ? controlledFullscreen : internalFullscreen;

  const handleToggle = () => {
    if (isControlled) {
      onToggleFullscreen?.();
    } else {
      setInternalFullscreen((s) => !s);
    }
  };

  const header = (
    <div className="app-modal-header">
      <span className="app-modal-title">{title}</span>
      <div className="app-modal-actions">
        {fullscreenable && (
          <button
            type="button"
            className="app-modal-icon-btn"
            aria-label={fullscreen ? '还原' : '全屏'}
            onClick={handleToggle}
          >
            {fullscreen ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        )}
        <button
          type="button"
          className="app-modal-icon-btn"
          aria-label="关闭"
          onClick={(e) => onCancel?.(e)}
        >
          <X size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <Modal
      header={header}
      closable={false}
      fullScreen={fullscreen}
      onCancel={onCancel}
      {...rest}
    >
      {children}
    </Modal>
  );
}

export default AppModal;
