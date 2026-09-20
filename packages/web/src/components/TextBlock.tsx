import type { CSSProperties, ReactNode } from 'react';

interface TextBlockProps {
  readonly children: ReactNode;
  /** 超出后内部滚动；不传则由内容决定高度 */
  readonly maxHeight?: number | string;
  readonly style?: CSSProperties;
}

/**
 * 扁平只读文本块：错误信息、堆栈、请求 / 响应体、差异等诊断文本的通用容器。
 *
 * 样式只有一处定义（`global.css` 的 `.zx-text-block`），页面不要再就地写
 * `background: var(--semi-color-fill-0) + borderRadius` 的卡片外观——那会把详情页
 * 切成一个个盒子，与「zx-panel 无卡片面板」的全局语言相反。
 *
 * 多行结构化数据（JSON）用 `JsonBlock`，需要工具栏的日志 / 终端输出用 `CommandOutputPanel`。
 */
export function TextBlock({ children, maxHeight, style }: TextBlockProps) {
  return (
    <pre className="zx-text-block" style={maxHeight === undefined ? style : { maxHeight, ...style }}>
      {children}
    </pre>
  );
}

export default TextBlock;
