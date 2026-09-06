import type { ReactNode } from 'react';
import { Icon } from '@iconify/react';
import { File, Folder } from 'lucide-react';
import { getFileIcon } from '@/utils/fileIcons';

/**
 * 紧凑文件树（SFTP / Docker 容器）的条目图标：目录用警示色文件夹，文件按扩展名取 iconify 图标，
 * 未识别的扩展名退回通用文件图标。本机文件树使用 16px 的文件夹图标集，另有实现。
 */
export function fileIcon(name: string, type: string, size = 14): ReactNode {
  if (type === 'dir') return <Folder size={size} style={{ color: 'var(--semi-color-warning)', flexShrink: 0 }} />;
  const iconId = getFileIcon(name);
  if (iconId) return <Icon icon={iconId} width={size} height={size} style={{ flexShrink: 0 }} />;
  return <File size={size} style={{ color: 'var(--semi-color-text-3)', flexShrink: 0 }} />;
}
