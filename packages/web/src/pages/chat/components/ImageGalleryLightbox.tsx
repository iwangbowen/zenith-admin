import { useEffect } from 'react';
import { X, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import type { ChatMessage } from '@zenith/shared';
import { getAssetMeta } from '../utils';

export function ImageGalleryLightbox({
  images, activeImageId, onClose, onPrev, onNext,
}: Readonly<{
  images: ChatMessage[];
  activeImageId: number | null;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}>) {
  const activeIndex = images.findIndex((item) => item.id === activeImageId);
  const current = activeIndex >= 0 ? images[activeIndex] : null;

  useEffect(() => {
    if (!current) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      } else if (e.key === 'ArrowLeft' && activeIndex > 0) {
        e.preventDefault();
        onPrev();
      } else if (e.key === 'ArrowRight' && activeIndex < images.length - 1) {
        e.preventDefault();
        onNext();
      }
    };
    globalThis.addEventListener('keydown', handleKeyDown);
    return () => globalThis.removeEventListener('keydown', handleKeyDown);
  }, [activeIndex, current, images.length, onClose, onNext, onPrev]);

  if (!current) return null;

  const asset = getAssetMeta(current);
  const hasPrev = activeIndex > 0;
  const hasNext = activeIndex < images.length - 1;

  return (
    <button
      type="button"
      onClick={onClose}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault();
          onClose();
        }
      }}
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 2200,
        background: 'rgba(0, 0, 0, 0.9)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        border: 'none',
        cursor: 'default',
        padding: 0,
      }}
    >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '12px 16px',
          background: 'rgba(0,0,0,0.45)',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ color: 'rgba(255,255,255,0.96)', fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {asset?.name ?? '图片预览'}
            {asset?.width && asset.height ? ` (${asset.width}×${asset.height})` : ''}
          </div>
          <div style={{ color: 'rgba(255,255,255,0.65)', fontSize: 12, marginTop: 2 }}>
            {activeIndex + 1} / {images.length}
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <a
            href={current.content}
            download={asset?.name ?? '图片'}
            onClick={(e) => e.stopPropagation()}
            title="下载"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 6,
              background: 'rgba(255,255,255,0.15)', color: '#fff', textDecoration: 'none',
            }}
          >
            <Download size={15} />
          </a>
          <button
            type="button"
            title="关闭 (Esc)"
            onClick={onClose}
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              width: 32, height: 32, borderRadius: 6,
              background: 'rgba(255,255,255,0.15)', border: 'none', color: '#fff', cursor: 'pointer',
            }}
          >
            <X size={15} />
          </button>
        </div>
      </div>

      {hasPrev && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onPrev();
          }}
          title="上一张 (←)"
          style={{
            position: 'absolute',
            left: 20,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.16)',
            color: '#fff',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronLeft size={22} />
        </button>
      )}

      {hasNext && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onNext();
          }}
          title="下一张 (→)"
          style={{
            position: 'absolute',
            right: 20,
            top: '50%',
            transform: 'translateY(-50%)',
            width: 44,
            height: 44,
            borderRadius: '50%',
            border: 'none',
            background: 'rgba(255,255,255,0.16)',
            color: '#fff',
            cursor: 'pointer',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <ChevronRight size={22} />
        </button>
      )}

      <img
        src={current.content}
        alt={asset?.name ?? '预览图片'}
        style={{
          maxWidth: '92vw',
          maxHeight: 'calc(88vh - 52px)',
          display: 'block',
          border: 'none',
          boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
          borderRadius: 4,
        }}
      />
    </button>
  );
}
