import type { QueryOf } from '@zenith/shared/core';
import { sslCertificateContract, type SslCertDownloadKind } from '@zenith/shared/ops';
import { createResourceQueries, urlOf, useApiMutation } from '@/lib/contract-query';
import { request } from '@/utils/request';

export type SslCertificateListParams = NonNullable<QueryOf<typeof sslCertificateContract.list>>;

export const {
  keys: sslCertificateKeys,
  useList: useSslCertificateList,
  useDetail: useSslCertificateDetail,
  useDelete: useDeleteSslCertificates,
} = createResourceQueries(sslCertificateContract);

/** 生成自签名证书：新增一条记录，列表随之变化 */
export function useGenerateSslCertificate() {
  return useApiMutation(sslCertificateContract.generate, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: sslCertificateKeys.all });
    },
  });
}

export function useUploadSslCertificate() {
  return useApiMutation(sslCertificateContract.upload, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: sslCertificateKeys.all });
    },
  });
}

/** 下载证书（cert）或私钥（key）PEM 文件 */
export function downloadSslCertificate(id: number, kind: SslCertDownloadKind, filename: string) {
  return request.download(urlOf(sslCertificateContract.download, { params: { id }, query: { kind } }), filename);
}
