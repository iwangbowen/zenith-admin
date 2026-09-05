import type { QueryOf } from '@zenith/shared/core';
import { mpQrcodeContract } from '@zenith/shared/mp';
import { createResourceQueries } from '@/lib/contract-query';

export type MpQrcodeListParams = QueryOf<typeof mpQrcodeContract.list>;

/** 二维码只有新增与删除（生成后不可编辑）：useSave 无 id 即创建 */
export const {
  keys: mpQrcodeKeys,
  useList: useMpQrcodeList,
  useSave: useCreateMpQrcode,
  useDelete: useDeleteMpQrcodes,
} = createResourceQueries(mpQrcodeContract);
