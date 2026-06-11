import { useCallback, useEffect, useRef, useState } from 'react';
import { Tree, Button, Upload, Toast, Typography, Tooltip } from '@douyinfe/semi-ui';
import { Upload as UploadIcon, RotateCcw } from 'lucide-react';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree';
import { request } from '@/utils/request';

interface FileEntry {
  name: string;
  path: string;
  type: 'dir' | 'file';
  size: number;
  mtime: string;
}

interface DirListing {
  path: string;
  parent: string | null;
  entries: FileEntry[];
}

/** Semi Tree 节点（附带 fileType 自定义字段） */
interface FileNode {
  label: string;
  value: string;
  key: string;
  isLeaf: boolean;
  fileType: 'dir' | 'file';
  children?: FileNode[];
}

function entryToNode(e: FileEntry): FileNode {
  return {
    label: e.name,
    value: e.path,
    key: e.path,
    isLeaf: e.type === 'file',
    fileType: e.type,
  };
}

/** 递归为指定 key 的节点设置子节点 */
function setChildren(nodes: FileNode[], key: string, children: FileNode[]): FileNode[] {
  return nodes.map((n) => {
    if (n.key === key) return { ...n, children };
    if (n.children) return { ...n, children: setChildren(n.children, key, children) };
    return n;
  });
}

interface FileExplorerProps {
  readonly active: boolean;
}

export default function FileExplorer({ active }: FileExplorerProps) {
  const [treeData, setTreeData] = useState<FileNode[]>([]);
  const [rootPath, setRootPath] = useState('');
  const [selectedDir, setSelectedDir] = useState('');
  const [loading, setLoading] = useState(false);
  const loadedRef = useRef(false);

  const loadRoot = useCallback(async () => {
    setLoading(true);
    const res = await request.get<DirListing>('/api/terminal-files/list');
    setLoading(false);
    if (res.code === 0 && res.data) {
      setRootPath(res.data.path);
      setSelectedDir(res.data.path);
      setTreeData(res.data.entries.map(entryToNode));
    }
  }, []);

  // 侧边栏首次显示时加载根目录
  useEffect(() => {
    if (active && !loadedRef.current) {
      loadedRef.current = true;
      void loadRoot();
    }
  }, [active, loadRoot]);

  // 懒加载子目录
  const loadData = useCallback((node?: TreeNodeData) => {
    if (!node) return Promise.resolve();
    const dir = String(node.value);
    const key = String(node.key);
    return request
      .get<DirListing>(`/api/terminal-files/list?path=${encodeURIComponent(dir)}`)
      .then((res) => {
        if (res.code === 0 && res.data) {
          setTreeData((prev) => setChildren(prev, key, res.data!.entries.map(entryToNode)));
        }
      });
  }, []);

  // 选中：文件 → 下载；目录 → 设为上传目标
  const handleSelect = (_value: string, _selected: boolean, node: TreeNodeData) => {
    const fileType = (node as FileNode).fileType;
    const value = String(node.value);
    if (fileType === 'file') {
      const fileName = value.split(/[\\/]/).pop() ?? 'download';
      request
        .download(`/api/terminal-files/download?path=${encodeURIComponent(value)}`, fileName)
        .catch(() => undefined);
    } else {
      setSelectedDir(value);
    }
  };

  return (
    <div
      style={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-layout-bg)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 4,
          padding: '6px 8px',
          borderBottom: '1px solid var(--semi-color-border)',
          flexShrink: 0,
        }}
      >
        <Typography.Text strong size="small" style={{ flex: 1 }}>文件</Typography.Text>
        <Upload
          action=""
          showUploadList={false}
          customRequest={({ file, onSuccess, onError }) => {
            const fd = new FormData();
            fd.append('path', selectedDir || rootPath);
            const inst = (file as unknown as { fileInstance: File }).fileInstance;
            fd.append('file', inst);
            request
              .postForm<FileEntry>('/api/terminal-files/upload', fd)
              .then((res) => {
                if (res.code === 0) {
                  Toast.success('上传成功');
                  onSuccess?.(res.data ?? {});
                  void loadRoot();
                } else {
                  onError?.({ status: 0 });
                }
              })
              .catch(() => onError?.({ status: 0 }));
          }}
        >
          <Tooltip content={`上传到：${selectedDir || rootPath || '主目录'}`}>
            <Button size="small" theme="borderless" type="tertiary" icon={<UploadIcon size={14} />} />
          </Tooltip>
        </Upload>
        <Tooltip content="刷新">
          <Button
            size="small"
            theme="borderless"
            type="tertiary"
            icon={<RotateCcw size={14} />}
            loading={loading}
            onClick={() => void loadRoot()}
          />
        </Tooltip>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '4px 0' }}>
        <Tree
          treeData={treeData}
          loadData={loadData}
          onSelect={handleSelect}
          expandAction="click"
          directory
          motion={false}
          emptyContent="暂无文件"
          style={{ width: '100%' }}
        />
      </div>

      <div style={{ padding: '4px 8px', borderTop: '1px solid var(--semi-color-border)', flexShrink: 0 }}>
        <Typography.Text size="small" type="tertiary" ellipsis={{ showTooltip: true }} style={{ display: 'block' }}>
          {selectedDir || rootPath}
        </Typography.Text>
      </div>
    </div>
  );
}
