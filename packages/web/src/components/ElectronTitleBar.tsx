import { useState, useEffect } from 'react';
import { Minus, Square, X } from 'lucide-react';

// 声明 Electron 预加载脚本暴露的 API 类型
declare global {
  interface Window {
    electronAPI?: {
      minimize: () => void;
      maximize: () => void;
      close: () => void;
      onMaximizeChange: (cb: (isMaximized: boolean) => void) => () => void;
      isElectron: boolean;
    };
  }
}

/**
 * Electron 自定义标题栏
 * 仅在 Electron 环境下渲染，提供拖拽区、最小化/最大化/关闭按钮
 */
export default function ElectronTitleBar() {
  const [isMaximized, setIsMaximized] = useState(false);
  const api = globalThis.window?.electronAPI;

  useEffect(() => {
    if (!api) return;
    const cleanup = api.onMaximizeChange(setIsMaximized);
    return cleanup;
  }, [api]);

  // 非 Electron 环境不渲染
  if (!api?.isElectron) return null;

  // macOS 使用系统原生红绿灯，无需自定义按钮
  if (navigator.userAgent.includes('Mac OS')) return null;

  return (
    <div
      className="electron-titlebar"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height: 32,
        background: 'var(--color-layout-bg, #f5f5f5)',
        borderBottom: '1px solid var(--semi-color-border)',
        userSelect: 'none',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        WebkitAppRegion: 'drag' as any,
        flexShrink: 0,
        zIndex: 100,
      } as React.CSSProperties}
    >
      {/* 应用名称 */}
      <span style={{ paddingLeft: 12, fontSize: 12, color: 'var(--semi-color-text-1)', fontWeight: 500 }}>
        Zenith Admin
      </span>

      {/* 窗口控制按钮 */}
      <div
        style={{
          display: 'flex',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        WebkitAppRegion: 'no-drag' as any,
      } as React.CSSProperties}
      >
        {[
          { icon: <Minus size={12} />, action: api.minimize, label: '最小化', hoverBg: 'var(--semi-color-fill-1)' },
          {
            icon: isMaximized ? <Square size={10} /> : <Square size={12} />,
            action: api.maximize,
            label: isMaximized ? '还原' : '最大化',
            hoverBg: 'var(--semi-color-fill-1)',
          },
          { icon: <X size={12} />, action: api.close, label: '关闭', hoverBg: '#e81123', hoverColor: '#fff' },
        ].map(({ icon, action, label, hoverBg, hoverColor }) => (
          <button
            key={label}
            type="button"
            title={label}
            onClick={action}
            style={{
              width: 46,
              height: 32,
              border: 'none',
              background: 'transparent',
              color: 'var(--semi-color-text-1)',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'background 0.15s, color 0.15s',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = hoverBg;
              if (hoverColor) e.currentTarget.style.color = hoverColor;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = 'transparent';
              e.currentTarget.style.color = 'var(--semi-color-text-1)';
            }}
          >
            {icon}
          </button>
        ))}
      </div>
    </div>
  );
}
