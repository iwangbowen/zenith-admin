import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AiChatModel, UserAiConfig } from '@zenith/shared/ai';
import { DEFAULT_MODEL_OPTIONS, type ModelOption } from '../chat-utils';

/**
 * 模型选择：系统模型 + 用户自有配置合成下拉选项（value: `${configId}:${model}` / `user-${id}:${model}`），
 * 镜像 AIChatInput Configure 区的取值，并解析当前选中模型的能力（vision / tools）。
 */
export function useModelSelection({ chatModels, userConfigs }: { chatModels: AiChatModel[]; userConfigs: UserAiConfig[] | undefined }) {
  const [modelOptions, setModelOptions] = useState<ModelOption[]>(DEFAULT_MODEL_OPTIONS);
  const configureValuesRef = useRef<Record<string, unknown>>({ model: '' });
  /** 选中模型（state 镜像，驱动 vision 按钮等 UI 随切换刷新） */
  const [selectedModelValue, setSelectedModelValue] = useState('');
  const setConfigureValues = useCallback((v: Record<string, unknown>) => {
    // Semi Configure 在 Select 重挂(key 随选项加载变化)时经 onRemove 回调缺失该字段的值,
    // 会把程序化预选的 model 清空:缺失时回退当前值
    const merged = { ...v };
    if (merged.model == null || merged.model === '') {
      merged.model = configureValuesRef.current.model ?? '';
    }
    configureValuesRef.current = merged;
    setSelectedModelValue(String(merged.model ?? ''));
  }, []);

  // Load AI chat models + user configs as model options（value: `${configId}:${model}` / `user-${id}:${model}`）
  const loadModelOptions = useCallback((models: AiChatModel[], configs: UserAiConfig[]) => {
    const sysOptions = models.map((m) => ({ value: `${m.id}:${m.model}`, label: `${m.name} (${m.model})`, source: 'system' as const }));
    // 用户配置对齐系统形态:逐模型展开(与系统同款 `${id}:${model}` 复合值,前缀 user- 区分来源)
    const userOptions = configs
      .filter((uc) => uc.isEnabled && uc.models.length > 0)
      .flatMap((uc) => uc.models.map((m) => ({
        value: `user-${uc.id}:${m}`,
        label: `${uc.name ?? '我的配置'} (${m})`,
        source: 'user' as const,
      })));
    const options = [...userOptions, ...sysOptions];
    setModelOptions(options);
    if (options.length > 0) {
      setConfigureValues({ ...configureValuesRef.current, model: options[0].value });
    }
  }, [setConfigureValues]);

  useEffect(() => {
    loadModelOptions(chatModels, userConfigs ?? []);
  }, [loadModelOptions, chatModels, userConfigs]);

  /** 当前选中模型的能力（vision / tools）:系统与用户配置统一解析 */
  const selectedCapabilities = useMemo(() => {
    if (!selectedModelValue) return null;
    if (selectedModelValue.startsWith('user-')) {
      const [idStr] = selectedModelValue.replace('user-', '').split(':');
      return (userConfigs ?? []).find((uc) => uc.id === Number(idStr))?.capabilities ?? null;
    }
    const [idStr, ...modelParts] = selectedModelValue.split(':');
    const model = modelParts.join(':');
    return chatModels.find((m) => m.id === Number(idStr) && m.model === model)?.capabilities ?? null;
  }, [chatModels, userConfigs, selectedModelValue]);

  return { modelOptions, configureValuesRef, setConfigureValues, selectedCapabilities };
}
