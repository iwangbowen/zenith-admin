/**
 * 表格「文件名」单元格统一组件
 *
 * 图标固定宽度、名称占满剩余列宽并在列边界省略，悬停 Tooltip 展示完整名称。
 * 需配合列定义 `ellipsis: { showTitle: false }` 使用（表格切为 fixed 布局并关闭原生 title）。
 *
 * - 默认按 mimeType/文件名推断托管文件图标；
 * - `icon` 可传入自定义图标（如 iconify 扩展名图标、文件夹图标）；
 * - `onClick` 存在时整体渲染为可点击按钮（如文件夹进入目录）。
 */
import type { ReactNode } from 'react';
import { Tooltip } from '@douyinfe/semi-ui';
import { getFileTypeIcon } from '@/utils/file-utils';
import './FileNameCell.css';

interface FileNameCellProps {
  name: string;
  /** 自定义图标；缺省时按 mimeType/文件名推断 */
  icon?: ReactNode;
  mimeType?: string | null;
  /** 提供时整行渲染为可点击按钮 */
  onClick?: () => void;
}

export function FileNameCell({ name, icon, mimeType, onClick }: Readonly<FileNameCellProps>) {
  const content = (
    <>
      <span className="file-name-cell__icon">{icon ?? getFileTypeIcon(mimeType, 16, name)}</span>
      <Tooltip content={name}>
        <span className="file-name-cell__text">{name}</span>
      </Tooltip>
    </>
  );

  if (onClick) {
    return (
      <button type="button" className="file-name-cell file-name-cell--button" onClick={onClick}>
        {content}
      </button>
    );
  }
  return <div className="file-name-cell">{content}</div>;
}
