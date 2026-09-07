import { ImagePreview } from '@douyinfe/semi-ui';
import FilePreviewModal from '@/components/FilePreviewModal';
import { PreviewWatermark } from '@/components/PreviewWatermark';
import type { FilePreviewController } from '@/hooks/useFilePreview';

interface FilePreviewLayerProps {
  readonly preview: FilePreviewController;
  /** 预览打开时叠加的水印文本（空 = 不加水印） */
  readonly watermark?: string | string[] | null;
}

/** 图集预览 + 非图片文件预览弹层（与 useFilePreview 配套使用） */
export function FilePreviewLayer({ preview, watermark }: FilePreviewLayerProps) {
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
        fileName={preview.filePreview?.name}
        mimeType={preview.filePreview?.mimeType}
        visible={!!preview.filePreview}
        onClose={preview.closeFilePreview}
      />
      <PreviewWatermark content={watermark} visible={preview.previewVisible || !!preview.filePreview} />
    </>
  );
}
