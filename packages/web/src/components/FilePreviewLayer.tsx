import { ImagePreview } from '@douyinfe/semi-ui';
import FilePreviewModal from '@/components/FilePreviewModal';
import type { FilePreviewController } from '@/hooks/useFilePreview';

/** 图集预览 + 非图片文件预览弹层（与 useFilePreview 配套使用） */
export function FilePreviewLayer({ preview }: { readonly preview: FilePreviewController }) {
  return (
    <>
      <ImagePreview
        src={preview.previewSrcList}
        visible={preview.previewVisible}
        currentIndex={preview.previewCurrentIndex}
        onChange={preview.setPreviewCurrentIndex}
        onVisibleChange={(v) => {
          if (!v) preview.closeImagePreview();
        }}
        infinite
      />
      <FilePreviewModal
        fileUrl={preview.filePreview?.url ?? ''}
        fileId={preview.filePreview?.id}
        fileName={preview.filePreview?.name}
        mimeType={preview.filePreview?.mimeType}
        visible={!!preview.filePreview}
        onClose={preview.closeFilePreview}
      />
    </>
  );
}
