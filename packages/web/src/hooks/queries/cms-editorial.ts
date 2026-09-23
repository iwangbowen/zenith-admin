import { cmsEditorialContract } from '@zenith/shared/cms';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { invalidateAfterCmsContentChange } from './cms-contents';

export const cmsEditorialKeys = {
  notes: (id: number) => contractKey(cmsEditorialContract.notes, { params: { id } }),
  quality: (id: number) => contractKey(cmsEditorialContract.quality, { params: { id } }),
  translations: contractKey(cmsEditorialContract.translations),
  conflicts: contractKey(cmsEditorialContract.distributionConflict),
  metrics: contractKey(cmsEditorialContract.metrics),
};
export const useCmsEditorialMetrics = (siteId?: number) => useApiQuery(cmsEditorialContract.metrics, { query: { siteId: siteId ?? 0 } }, { enabled: !!siteId });
export const useCmsEditorialNotes = (id?: number) => useApiQuery(cmsEditorialContract.notes, { params: { id: id ?? 0 } }, { enabled: !!id });
export const useCmsQuality = (id?: number) => useApiQuery(cmsEditorialContract.quality, { params: { id: id ?? 0 } }, { enabled: !!id });
export const useCmsTranslations = (id?: number) => useApiQuery(cmsEditorialContract.translations, { params: { id: id ?? 0 } }, { enabled: !!id });
export const useCmsDistributionConflict = (id?: number, enabled = true) => useApiQuery(cmsEditorialContract.distributionConflict, { params: { id: id ?? 0 } }, { enabled: !!id && enabled });
export function useAddCmsEditorialNote() {
  return useApiMutation(cmsEditorialContract.addNote, { invalidate: (qc, _data, input) => {
    void qc.invalidateQueries({ queryKey: cmsEditorialKeys.notes(input.params.id) });
    void qc.invalidateQueries({ queryKey: cmsEditorialKeys.metrics });
  } });
}
export function useResolveCmsEditorialNote() {
  return useApiMutation(cmsEditorialContract.resolveNote, { invalidate: (qc, _data, input) => {
    void qc.invalidateQueries({ queryKey: cmsEditorialKeys.notes(input.params.id) });
    void qc.invalidateQueries({ queryKey: cmsEditorialKeys.metrics });
  } });
}
export function useCreateCmsTranslation() {
  return useApiMutation(cmsEditorialContract.createTranslation, { invalidate: (qc) => {
    invalidateAfterCmsContentChange(qc);
    void qc.invalidateQueries({ queryKey: cmsEditorialKeys.translations });
  } });
}
export function useResolveCmsDistribution() {
  return useApiMutation(cmsEditorialContract.resolveDistribution, { invalidate: (qc, _data, input) => {
    invalidateAfterCmsContentChange(qc, [input.params.id]);
    void qc.invalidateQueries({ queryKey: cmsEditorialKeys.conflicts });
  } });
}
export const usePreviewCmsTypeConversion = () => useApiMutation(cmsEditorialContract.previewConversion);
export function useConvertCmsType() {
  return useApiMutation(cmsEditorialContract.convertType, { invalidate: (qc, _data, input) => invalidateAfterCmsContentChange(qc, [input.params.id]) });
}
