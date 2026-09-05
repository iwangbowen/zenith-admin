import { useEffect, useState } from 'react';
import { systemConfigContract } from '@zenith/shared/platform';
import { api } from '@/lib/contract-query';

// ─── 水印配置 ──────────────────────────────────────────────────────────────
export function useWatermarkConfig() {
  const [watermarkConfig, setWatermarkConfig] = useState({ enabled: false, content: '', fontSize: 14, opacity: 0.15 });

  useEffect(() => {
    api(systemConfigContract.list, { query: { keys: 'watermark_enabled,watermark_content,watermark_font_size,watermark_opacity' } }, { silent: true })
      .then(({ list }) => {
        const enabled = list.find((c) => c.configKey === 'watermark_enabled')?.configValue === 'true';
        const content = list.find((c) => c.configKey === 'watermark_content')?.configValue ?? '';
        const fontSize = Number(list.find((c) => c.configKey === 'watermark_font_size')?.configValue) || 14;
        const opacity = (Number(list.find((c) => c.configKey === 'watermark_opacity')?.configValue) || 15) / 100;
        setWatermarkConfig({ enabled, content, fontSize, opacity });
      })
      .catch(() => undefined);
  }, []);

  return watermarkConfig;
}

// ─── 快捷聊天系统开关 ─────────────────────────────────────────────────────
export function useQuickChatEnabled() {
  const [quickChatEnabled, setQuickChatEnabled] = useState(false);

  useEffect(() => {
    api(systemConfigContract.publicByKey, { params: { key: 'quick_chat_enabled' } }, { silent: true })
      .then((config) => setQuickChatEnabled(config.configValue === 'true'))
      .catch(() => undefined);
  }, []);

  return quickChatEnabled;
}
