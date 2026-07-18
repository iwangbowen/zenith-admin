import { useState, useEffect } from 'react';
import type { CSSProperties } from 'react';
import { Tree, Spin, Toast, Tag } from '@douyinfe/semi-ui';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { FolderOpen } from 'lucide-react';
import { Icon } from '@iconify/react';
import JSZip from 'jszip';
import { formatFileSize } from '@/utils/file-utils';
import { getFileIcon } from '@/utils/fileIcons';

interface ZipPreviewPanelProps {
  readonly blob: Blob;
  readonly style?: CSSProperties;
}

interface ZipEntry {
  path: string;
  isDir: boolean;
  size: number;
  compressedSize: number;
}

/**
 * ZIP 文件内容预览面板：使用 JSZip 解析 ZIP 包，以 Semi Design Tree 目录树展示。
 * 支持搜索、文件数量/总大小统计，仅展示文件结构，不解压内容。
 */
export function ZipPreviewPanel({ blob, style }: ZipPreviewPanelProps) {
  const [treeData, setTreeData] = useState<TreeNodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasError, setHasError] = useState(false);
  const [stats, setStats] = useState({ fileCount: 0, totalSize: 0, compressedSize: 0 });

  useEffect(() => {
    setLoading(true);
    JSZip.loadAsync(blob)
      .then((zip) => {
        const entries: ZipEntry[] = [];
        zip.forEach((relativePath, zipEntry) => {
          entries.push({
            path: relativePath,
            isDir: zipEntry.dir,
            size: (zipEntry as unknown as { _data?: { uncompressedSize?: number } })
              ._data?.uncompressedSize ?? 0,
            compressedSize: (zipEntry as unknown as { _data?: { compressedSize?: number } })
              ._data?.compressedSize ?? 0,
          });
        });

        const fileEntries = entries.filter((e) => !e.isDir);
        setStats({
          fileCount: fileEntries.length,
          totalSize: fileEntries.reduce((s, e) => s + e.size, 0),
          compressedSize: fileEntries.reduce((s, e) => s + e.compressedSize, 0),
        });

        setTreeData(buildTree(entries));
      })
      .catch(() => {
        Toast.error('ZIP 文件解析失败');
        setHasError(true);
      })
      .finally(() => setLoading(false));
  }, [blob]);

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--semi-color-bg-0)',
        overflow: 'hidden',
        ...style,
      }}
    >
      {/* 统计信息栏 */}
      {!loading && !hasError && (
        <div
          style={{
            display: 'flex',
            gap: 6,
            padding: '6px 16px',
            borderBottom: '1px solid var(--semi-color-border)',
            background: 'var(--semi-color-bg-1)',
            flexShrink: 0,
          }}
        >
          <Tag size="small" color="grey">{stats.fileCount} 个文件</Tag>
          <Tag size="small" color="grey">{formatFileSize(stats.totalSize)}</Tag>
        </div>
      )}

      {/* 文件树 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', padding: '12px 8px' }}>
        {(() => {
          if (loading) {
            return (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200 }}>
                <Spin tip="解析 ZIP..." />
              </div>
            );
          }
          if (hasError) {
            return (
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: 200, color: 'var(--semi-color-text-2)' }}>
                ZIP 文件解析失败
              </div>
            );
          }
          return (
          <Tree
            treeData={treeData}
            directory
            filterTreeNode
            showFilteredOnly
            searchPlaceholder="搜索文件..."
            expandAll
            motion={false}
            style={{ height: '100%' }}
            renderLabel={(label, data) => {
              const entry = data as TreeNodeData & { _size?: number; _isDir?: boolean };
              return (
                <span
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 4,
                    fontSize: 13,
                    color: 'var(--semi-color-text-0)',
                  }}
                >
                  {entry._isDir ? (
                    <FolderOpen size={13} style={{ color: 'var(--semi-color-warning)', flexShrink: 0 }} />
                  ) : (
                    <Icon icon={getFileIcon(typeof label === 'string' ? label : '')} width={13} height={13} style={{ flexShrink: 0 }} />
                  )}
                  <span>{typeof label === 'string' ? label : ''}</span>
                  {!entry._isDir && entry._size ? (
                    <span style={{ color: 'var(--semi-color-text-2)', fontSize: 11, marginLeft: 4 }}>
                      {formatFileSize(entry._size)}
                    </span>
                  ) : null}
                </span>
              );
            }}
          />
        );
        })()}
      </div>
    </div>
  );
}

export default ZipPreviewPanel;

// ─── 工具函数 ─────────────────────────────────────────────────────────────────

/**
 * 将路径列表转换为 Semi Design Tree 所需的 TreeNodeData 结构。
 * e.g. ["a/b/c.txt", "a/b/d.txt", "a/e.txt"] → 三级树
 */
function buildTree(entries: ZipEntry[]): TreeNodeData[] {
  // 使用 Map 存储每个路径对应的树节点
  const nodeMap = new Map<string, TreeNodeData & { _size?: number; _isDir?: boolean }>();
  const roots: (TreeNodeData & { _size?: number; _isDir?: boolean })[] = [];

  // 按路径排序：目录在前，文件在后
  const sorted = [...entries].sort((a, b) => {
    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
    return a.path.localeCompare(b.path);
  });

  for (const entry of sorted) {
    // 去掉末尾斜杠（目录）
    const normalPath = entry.path.endsWith('/') ? entry.path.slice(0, -1) : entry.path;
    if (!normalPath) continue;

    const segments = normalPath.split('/');

    // 确保所有父路径节点存在
    for (let depth = 1; depth <= segments.length; depth++) {
      const pathKey = segments.slice(0, depth).join('/');
      if (nodeMap.has(pathKey)) continue;

      const isLastSegment = depth === segments.length;
      const isDir = entry.isDir || !isLastSegment;
      const name = segments[depth - 1];
      const parentPath = depth > 1 ? segments.slice(0, depth - 1).join('/') : null;

      const node: TreeNodeData & { _size?: number; _isDir?: boolean } = {
        key: pathKey,
        label: name,
        value: pathKey,
        _isDir: isDir,
        _size: isLastSegment && !entry.isDir ? entry.size : undefined,
        children: isDir ? [] : undefined,
      };

      nodeMap.set(pathKey, node);

      if (parentPath) {
        const parent = nodeMap.get(parentPath);
        if (parent?.children) {
          parent.children.push(node);
        }
      } else {
        roots.push(node);
      }
    }
  }

  // 递归排序：目录在前，文件在后，同类型按名称排序
  function sortChildren(nodes: TreeNodeData[]): void {
    nodes.sort((a, b) => {
      const na = a as typeof a & { _isDir?: boolean };
      const nb = b as typeof b & { _isDir?: boolean };
      if (na._isDir !== nb._isDir) return na._isDir ? -1 : 1;
      return (typeof na.label === 'string' ? na.label : '').localeCompare(
        typeof nb.label === 'string' ? nb.label : ''
      );
    });
    nodes.forEach((n) => {
      if (n.children?.length) sortChildren(n.children);
    });
  }
  sortChildren(roots);

  return roots;
}
