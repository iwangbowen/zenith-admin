import { useMutation } from '@tanstack/react-query';
import type { OutputOf } from '@zenith/shared/core';
import { cmsUploadContract } from '@zenith/shared/cms';
import { urlOf } from '@/lib/contract-query';
import { unwrap } from '@/lib/query';
import { request } from '@/utils/request';

/** 站点图片上传地址（富文本 / 媒体选择器等只消费 URL 的场景） */
export function cmsImageUploadUrl(siteId: number): string {
  return urlOf(cmsUploadContract.uploadImage, { query: { siteId } });
}

/**
 * CMS 站点图片上传（内容封面 / 图集 / 主题配置图）。
 * 服务端按站点配置决定是否加水印与生成缩略图，故必须带 siteId；带上传进度，走 XHR 表单通道
 */
export function useUploadCmsImage() {
  return useMutation({
    mutationFn: ({ siteId, formData, onProgress }: { siteId: number; formData: FormData; onProgress?: (percent: number) => void }) =>
      request.postForm<OutputOf<typeof cmsUploadContract.uploadImage>>(cmsImageUploadUrl(siteId), formData, { onProgress, silent: true }).then(unwrap),
  });
}
