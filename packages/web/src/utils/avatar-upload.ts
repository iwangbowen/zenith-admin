import { fileContract } from '@zenith/shared/platform';
import { api } from '@/lib/contract-query';

/**
 * 管理后台文件中心头像上传（裁剪 Blob → 文件中心 → URL）。
 * 供 `AvatarSelectModal` 的管理后台调用方传入 `uploadBlob`。
 *
 * 注意：会员前台走独立上传通道，不要引用本模块——静态引入会把
 * `@zenith/shared/platform` 契约图拖入 member 入口，触发产物预算
 *（`bundle-budget.json` 的 member.html chunk 数）。
 */
export async function uploadAvatarBlobToFileCenter(blob: Blob): Promise<string> {
  const formData = new FormData();
  formData.append('file', blob, 'avatar.jpg');
  // code !== 0 由 api() 抛 ApiError，调用方按场景提示；请求层静默
  return (await api(fileContract.uploadOne, { body: formData }, { silent: true })).url;
}
