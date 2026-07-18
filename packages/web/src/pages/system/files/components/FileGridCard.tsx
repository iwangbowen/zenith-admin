import { useState } from 'react';
import { Checkbox, Dropdown, Modal, Spin, Tooltip } from '@douyinfe/semi-ui';
import type { ManagedFile } from '@zenith/shared';
import { formatFileSize, getFileTypeIcon, canPreviewFile } from '@/utils/file-utils';
import '../FilesPage.css';

export interface FileGridCardProps {
  file: ManagedFile;
  selected: boolean;
  canSelect: boolean;
  onSelect: (id: string, checked: boolean) => void;
  onPreview: (file: ManagedFile) => void;
  onDownload: (file: ManagedFile) => void;
  onDelete: (file: ManagedFile) => void;
  onDetail: (file: ManagedFile) => void;
  onCopyUrl: (file: ManagedFile) => void;
  canDelete: boolean;
  previewLoading: boolean;
}

export function FileGridCard({
  file, selected, canSelect, onSelect,
  onPreview, onDownload, onDelete, onDetail, onCopyUrl,
  canDelete, previewLoading,
}: Readonly<FileGridCardProps>) {
  const [ctxPos, setCtxPos] = useState<{ x: number; y: number } | null>(null);
  const isPreviewable = canPreviewFile(file.mimeType);
  const ext = file.originalName.includes('.') ? file.originalName.split('.').pop()?.toUpperCase() : '';
  return (
    <>
      <div
        className={`files-grid-card${selected ? ' files-grid-card--selected' : ''}`}
      >
        <button
          type="button"
          className="files-grid-card__preview-btn"
          aria-label={isPreviewable ? `预览 ${file.originalName}` : file.originalName}
          style={{ cursor: isPreviewable ? 'pointer' : 'default' }}
          onClick={(e) => {
            if (canSelect && (e.ctrlKey || e.metaKey || e.shiftKey)) {
              onSelect(file.id, !selected);
              return;
            }
            if (isPreviewable) onPreview(file);
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            setCtxPos({ x: e.clientX, y: e.clientY });
          }}
        />
        {canSelect && (
          <div className="files-grid-card__checkbox">
            <Checkbox
              checked={selected}
              onChange={() => onSelect(file.id, !selected)}
            />
          </div>
        )}
        <div className="files-grid-card__media-wrap">
          <div className="files-grid-card__media">
            <span className="files-grid-card__icon">
              {getFileTypeIcon(file.mimeType, 34, file.originalName)}
            </span>
            {ext && <span className="files-grid-card__type-badge">{ext}</span>}
            {previewLoading && (
              <div className="files-grid-card__media-overlay">
                <Spin />
              </div>
            )}
          </div>
        </div>
        <div className="files-grid-card__info">
          <Tooltip content={file.originalName} position="top">
            <div className="files-grid-card__name">{file.originalName}</div>
          </Tooltip>
          <div className="files-grid-card__meta">
            <span>{formatFileSize(file.size)}</span>
          </div>
        </div>
      </div>
      {ctxPos && (
        <Dropdown
          trigger="click"
          visible
          clickToHide
          position="bottomLeft"
          onVisibleChange={(v) => { if (!v) setCtxPos(null); }}
          render={
            <Dropdown.Menu>
              {isPreviewable && <Dropdown.Item onClick={() => onPreview(file)}>预览</Dropdown.Item>}
              <Dropdown.Item onClick={() => onDownload(file)}>下载</Dropdown.Item>
              <Dropdown.Item onClick={() => onDetail(file)}>详情</Dropdown.Item>
              <Dropdown.Item onClick={() => onCopyUrl(file)}>复制链接</Dropdown.Item>
              {canDelete && (
                <>
                  <Dropdown.Divider />
                  <Dropdown.Item
                    type="danger"
                    onClick={() => {
                      Modal.confirm({
                        title: '确认删除此文件？',
                        content: '删除文件记录后，将同步尝试删除实际存储对象。',
                        okButtonProps: { type: 'danger', theme: 'solid' },
                        onOk: () => onDelete(file),
                      });
                    }}
                  >删除</Dropdown.Item>
                </>
              )}
            </Dropdown.Menu>
          }
        >
          <span style={{ position: 'fixed', left: ctxPos.x, top: ctxPos.y, width: 1, height: 1 }} />
        </Dropdown>
      )}
    </>
  );
}
