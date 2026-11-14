import { exportPresetContract } from '@zenith/shared/tasks';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
export function useExportPresets() { return useApiQuery(exportPresetContract.listPresets); }
export function useSaveExportPreset() { return useApiMutation(exportPresetContract.createPreset, { invalidate: qc => void qc.invalidateQueries({ queryKey: contractKey(exportPresetContract.listPresets) }) }); }
export function useDeleteExportPreset() { return useApiMutation(exportPresetContract.removePreset, { invalidate: qc => void qc.invalidateQueries({ queryKey: contractKey(exportPresetContract.listPresets) }) }); }
