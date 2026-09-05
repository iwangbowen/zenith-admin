import { smsTemplateContract } from '@zenith/shared/messaging';
import { createResourceQueries } from '@/lib/contract-query';

export const {
  keys: smsTemplateKeys,
  useList: useSmsTemplateList,
  useDetail: useSmsTemplateDetail,
  useSave: useSaveSmsTemplate,
  useDelete: useDeleteSmsTemplate,
} = createResourceQueries(smsTemplateContract);