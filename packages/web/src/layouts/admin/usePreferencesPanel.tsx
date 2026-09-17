import { useCallback, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { textMatches } from '@/utils/pinyin';
import { copyTextWithToast } from '@/utils/clipboard';
import { downloadBlob } from '@/utils/download';
import { sanitizeImportedPreferences, usePreferences } from '@/hooks/usePreferences';

// 偏好设置面板：搜索过滤、分区标题、复制 / 导入 / 导出偏好
export function usePreferencesPanel() {
  const { overrides, setPreferences } = usePreferences();
  const [prefsVisible, setPrefsVisible] = useState(false);
  const [prefsSearch, setPrefsSearch] = useState('');

  const matchesPref = useCallback((keywords: string[]): boolean => {
    if (!prefsSearch.trim()) return true;
    return keywords.some((kw) => textMatches(kw, prefsSearch));
  }, [prefsSearch]);

  // 偏好面板分区标题：搜索时隐藏（搜索结果为扁平列表）
  const prefSection = useCallback((label: string) => (
    prefsSearch.trim() ? null : <div className="prefs-section-title">{label}</div>
  ), [prefsSearch]);

  const handleCopyPreferences = useCallback(() => {
    void copyTextWithToast(JSON.stringify({ overrides }, null, 2), { success: '偏好设置已复制到剪贴板', error: '复制失败，请重试' });
  }, [overrides]);

  const handleExportPreferences = useCallback(() => {
    downloadBlob(new Blob([JSON.stringify({ overrides }, null, 2)], { type: 'application/json' }), 'zenith-preferences.json');
    Toast.success('偏好配置已导出为文件');
  }, [overrides]);

  // ─── 导入偏好 ─────────────────────────────────────────────────────────────
  const [importPrefsVisible, setImportPrefsVisible] = useState(false);
  const [importPrefsText, setImportPrefsText] = useState('');
  const handleImportPreferences = useCallback(() => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(importPrefsText);
    } catch {
      Toast.error('JSON 解析失败，请检查格式');
      return;
    }
    const sanitized = sanitizeImportedPreferences(parsed && typeof parsed === 'object' && 'overrides' in parsed ? parsed.overrides : null);
    if (!sanitized) {
      Toast.error('未识别到有效的偏好设置字段');
      return;
    }
    const result = setPreferences(sanitized);
    setImportPrefsVisible(false);
    setImportPrefsText('');
    if (result.applied > 0) Toast.success(`已导入 ${result.applied} 项设置${result.skipped ? `，跳过 ${result.skipped} 项系统管理设置` : ''}`);
    else Toast.info('所选设置由系统管理，未导入任何修改');
  }, [importPrefsText, setPreferences]);

  return {
    prefsVisible, setPrefsVisible,
    prefsSearch, setPrefsSearch,
    matchesPref, prefSection, handleCopyPreferences, handleExportPreferences,
    importPrefsVisible, setImportPrefsVisible,
    importPrefsText, setImportPrefsText,
    handleImportPreferences,
  };
}
