/** 文件属性 SideSheet：基础元数据 + 目录大小按需计算 + 文件校验和（MD5/SHA1/SHA256） */
import React, { useEffect, useState } from 'react';
import { Button, Input, SideSheet, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { Icon } from '@iconify/react';
import { useTerminalChecksum, useTerminalDirSize } from '@/hooks/queries/terminal-files';
import { getFileIcon, getFolderIcon } from '@/utils/fileIcons';
import { copyTextWithToast } from '@/utils/clipboard';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { permStringToOctal } from '../fs-utils';
import type { FsEntry } from '../types';
import { formatBytes } from '@zenith/shared/core';

type ChecksumAlgo = 'md5' | 'sha1' | 'sha256';

interface FmPropsSheetProps {
  readonly entry: FsEntry | null;
  readonly onClose: () => void;
  /** 外部（右键菜单「校验和」）请求打开时预选的算法 */
  readonly initialChecksumAlgo?: ChecksumAlgo | null;
}

export default function FmPropsSheet({ entry, onClose, initialChecksumAlgo }: Readonly<FmPropsSheetProps>) {
  const [algo, setAlgo] = useState<ChecksumAlgo | undefined>(undefined);
  const [dirSizeRequested, setDirSizeRequested] = useState(false);

  // 切换条目时重置：校验和算法回到入口预选值，目录大小恢复按需
  useEffect(() => {
    setAlgo(entry?.type === 'file' ? initialChecksumAlgo ?? undefined : undefined);
    setDirSizeRequested(false);
  }, [entry, initialChecksumAlgo]);

  const checksumQuery = useTerminalChecksum(entry?.path, algo, entry?.type === 'file');
  const dirSizeQuery = useTerminalDirSize(entry?.path, dirSizeRequested && entry?.type === 'dir');
  const dirSize = dirSizeQuery.data;

  const checksumText = (() => {
    if (!algo) return null;
    if (checksumQuery.isFetching) return '计算中…';
    if (checksumQuery.isError) return '计算失败';
    return checksumQuery.data?.hash ?? '';
  })();

  return (
    <SideSheet
      title={
        entry ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <Icon
              icon={entry.type === 'dir' ? getFolderIcon(entry.name, false) : getFileIcon(entry.name)}
              width={18}
              height={18}
            />
            <Typography.Text strong ellipsis={{ showTooltip: true }} style={{ maxWidth: 200 }}>
              {entry.name}
            </Typography.Text>
          </div>
        ) : '属性'
      }
      visible={!!entry}
      onCancel={onClose}
      width={320}
      closeOnEsc
      mask={false}
    >
      {entry && (() => {
        const isDir = entry.type === 'dir';
        const ext = !isDir && entry.name.includes('.') ? entry.name.split('.').pop()?.toUpperCase() : undefined;
        const octal = entry.permissions ? permStringToOctal(entry.permissions) : undefined;
        const rows: { label: string; value: React.ReactNode }[] = [
          {
            label: '类型',
            value: isDir
              ? <Tag size="small" color="blue">文件夹</Tag>
              : <Tag size="small" color="green">{ext ? `${ext} 文件` : '文件'}</Tag>,
          },
          {
            label: '路径',
            value: (
              <Typography.Text
                size="small"
                copyable
                style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}
              >
                {entry.path}
              </Typography.Text>
            ),
          },
          ...(!isDir ? [{ label: '大小', value: `${formatBytes(entry.size)}  (${entry.size.toLocaleString()} 字节)` }] : []),
          ...(isDir ? [{
            label: '大小',
            value: (() => {
              if (!dirSizeRequested) {
                return (
                  <Button size="small" theme="light" onClick={() => setDirSizeRequested(true)}>
                    计算大小
                  </Button>
                );
              }
              if (dirSizeQuery.isFetching) return <Typography.Text size="small" type="tertiary">计算中…</Typography.Text>;
              if (dirSizeQuery.isError || !dirSize) {
                return (
                  <Button size="small" theme="light" onClick={() => void dirSizeQuery.refetch()}>
                    计算失败，重试
                  </Button>
                );
              }
              return (
                <Typography.Text size="small">
                  {formatBytes(dirSize.size)}（{dirSize.files.toLocaleString()} 个文件，{dirSize.dirs.toLocaleString()} 个目录{dirSize.truncated ? '，已达统计上限' : ''}）
                </Typography.Text>
              );
            })(),
          }] : []),
          { label: '修改时间', value: entry.mtime },
          ...(entry.permissions
            ? [{
              label: '权限',
              value: (
                <Tag size="small" color="grey" style={{ fontFamily: 'monospace' }}>
                  {entry.permissions}{octal ? ` (${octal})` : ''}
                </Tag>
              ),
            }]
            : []),
          ...(entry.uid !== undefined
            ? [{ label: 'UID / GID', value: `${entry.uid} / ${entry.gid ?? EMPTY_PLACEHOLDER}` }]
            : []),
        ];
        return (
          <div>
            {rows.map((r) => (
              <div
                key={r.label}
                style={{ display: 'flex', alignItems: 'flex-start', padding: '9px 0', borderBottom: '1px solid var(--semi-color-fill-1)' }}
              >
                <Typography.Text
                  type="tertiary"
                  size="small"
                  style={{ width: 72, flexShrink: 0, paddingTop: 1 }}
                >
                  {r.label}
                </Typography.Text>
                <div style={{ flex: 1, minWidth: 0 }}>
                  {typeof r.value === 'string'
                    ? <Typography.Text size="small">{r.value}</Typography.Text>
                    : r.value}
                </div>
              </div>
            ))}
            {!isDir && (
              <div style={{ paddingTop: 14 }}>
                <Typography.Text
                  type="tertiary"
                  size="small"
                  style={{ display: 'block', marginBottom: 8 }}
                >
                  校验和
                </Typography.Text>
                <Space spacing={4} style={{ marginBottom: 8 }}>
                  {(['md5', 'sha1', 'sha256'] as const).map((a) => (
                    <Button
                      key={a}
                      size="small"
                      theme={algo === a ? 'solid' : 'light'}
                      type={algo === a ? 'primary' : 'tertiary'}
                      onClick={() => { if (algo === a) void checksumQuery.refetch(); else setAlgo(a); }}
                    >
                      {a.toUpperCase()}
                    </Button>
                  ))}
                </Space>
                {checksumText !== null && (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <Input
                      readOnly
                      value={checksumText}
                      style={{ fontFamily: 'monospace', fontSize: 11 }}
                      size="small"
                    />
                    <Button
                      size="small"
                      disabled={checksumQuery.isFetching || !checksumQuery.data?.hash}
                      onClick={() => {
                        void copyTextWithToast(checksumQuery.data?.hash ?? '');
                      }}
                    >
                      复制
                    </Button>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })()}
    </SideSheet>
  );
}
