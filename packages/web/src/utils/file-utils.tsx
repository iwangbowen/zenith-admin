import { File, FileAudio, FileArchive, FileCode, FileImage, FilePen, FileSpreadsheet, FileText, FileType, FileVideo } from 'lucide-react';
import { TOKEN_KEY } from '@zenith/shared';
import { config } from '@/config';

/** 将字节数格式化为可读字符串（B / KB / MB / GB）*/
export function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
  return `${(size / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

/** 将相对路径拼接为完整可访问 URL */
export function getFileFullUrl(url: string): string {
  if (/^https?:\/\//.test(url)) return url;
  const base = config.apiBaseUrl || globalThis.location.origin;
  return `${base}${url}`;
}

/** 根据 MIME 类型返回对应的 lucide-react 文件图标 */
export function getFileTypeIcon(mimeType?: string | null) {
  const color = 'var(--semi-color-text-2)';
  const size = 15;
  if (!mimeType) return <File size={size} color={color} />;
  // 图片（含 SVG）
  if (mimeType.startsWith('image/')) return <FileImage size={size} color="var(--semi-color-primary)" />;
  // 视频
  if (mimeType.startsWith('video/')) return <FileVideo size={size} color="var(--semi-color-warning)" />;
  // 音频
  if (mimeType.startsWith('audio/')) return <FileAudio size={size} color="var(--semi-color-success)" />;
  // PDF
  if (mimeType === 'application/pdf') return <FileText size={size} color="#e54d2e" />;
  // Word 文档
  if (mimeType.includes('msword') || mimeType.includes('wordprocessingml')) return <FileText size={size} color="#2b579a" />;
  // PowerPoint 演示文稿
  if (mimeType.includes('presentationml') || mimeType.includes('powerpoint')) return <FilePen size={size} color="#c43e1c" />;
  // Excel / 表格（含 CSV）
  if (mimeType.includes('spreadsheetml') || mimeType.includes('excel') || mimeType === 'text/csv') return <FileSpreadsheet size={size} color="#1a7f37" />;
  // 压缩包（zip、rar、7z、tar、gz、bz2）
  if (
    mimeType.includes('zip') || mimeType.includes('archive') ||
    mimeType.includes('gzip') || mimeType.includes('tar') ||
    mimeType.includes('x-rar') || mimeType.includes('x-7z') ||
    mimeType.includes('x-bzip')
  ) return <FileArchive size={size} color={color} />;
  // 字体文件
  if (mimeType.startsWith('font/') || mimeType.includes('ttf') || mimeType.includes('woff') || mimeType.includes('opentype')) return <FileType size={size} color={color} />;
  // 代码 / 配置文件（JSON、JS、HTML、CSS、XML、YAML、Shell 等）
  if (
    mimeType.includes('json') || mimeType.includes('javascript') ||
    mimeType.includes('html') || mimeType.includes('css') ||
    mimeType.includes('xml') || mimeType.includes('yaml') ||
    mimeType === 'application/x-sh' || mimeType === 'text/x-shellscript'
  ) return <FileCode size={size} color="var(--semi-color-tertiary)" />;
  // 纯文本 / Markdown / 文档
  if (mimeType.startsWith('text/') || mimeType.includes('document')) return <FileText size={size} color={color} />;
  return <File size={size} color={color} />;
}

/** 使用当前登录 token 获取受保护的文件内容，返回 Blob */
export async function fetchProtectedFile(url: string): Promise<Blob> {
  const token = localStorage.getItem(TOKEN_KEY);
  const response = await fetch(`${config.apiBaseUrl}${url}`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!response.ok) {
    throw new Error('文件读取失败');
  }
  return response.blob();
}
