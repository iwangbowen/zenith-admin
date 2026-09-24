import type { CmsChannel } from '@zenith/shared/cms';

export function channelBoundFormCode(channel: Pick<CmsChannel, 'settings'> | null): string | undefined {
  const value = channel?.settings.formCode;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

/** 切换为非单页或清空选择时显式删除绑定，其余栏目设置继续保留。 */
export function channelSettingsWithForm(settings: Record<string, unknown> | undefined, type: unknown, formCode: unknown) {
  const { formCode: _previousForm, ...rest } = settings ?? {};
  if (type !== 'page' || typeof formCode !== 'string' || !formCode.trim()) return rest;
  return { ...rest, formCode: formCode.trim() };
}
