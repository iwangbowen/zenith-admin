import { useState } from 'react';
import { Banner, Button, Select, Space, Typography } from '@douyinfe/semi-ui';
import type { CmsWidgetSlot, CmsWidgetRendererKey } from '@zenith/shared/cms';
import { CMS_WIDGET_RENDERER_LABELS } from '@zenith/shared/cms';
import { useCmsWidgetSlots, usePublishedCmsWidgets, useSaveCmsWidgetSlot } from '@/hooks/queries/cms-widgets';
import { usePermission } from '@/hooks/usePermission';
import './site-composition.css';

function SlotRow({ siteId, slot }: { siteId: number; slot: CmsWidgetSlot }) {
  const { hasPermission } = usePermission();
  const widgets = usePublishedCmsWidgets(siteId, true);
  const save = useSaveCmsWidgetSlot();
  const [widgetId, setWidgetId] = useState<number | null>(slot.binding?.widgetId ?? null);
  const [renderer, setRenderer] = useState<CmsWidgetRendererKey>(slot.binding?.rendererKey ?? slot.rendererKeys[0]);
  return <div className="cms-composition-row"><Typography.Text strong>{slot.label}</Typography.Text><Space wrap>
    <Select value={widgetId ?? undefined} showClear filter placeholder="不绑定页面部件" style={{ minWidth: 220 }} disabled={!hasPermission('cms:widget:bind') || save.isPending}
      optionList={(widgets.data ?? []).filter((widget) => slot.allowedTypes.includes(widget.type)).map((widget) => ({ value: widget.id, label: `${widget.name}（${widget.code}）` }))}
      onChange={(value) => setWidgetId(value == null ? null : Number(value))} />
    <Select value={renderer} disabled={!hasPermission('cms:widget:bind') || save.isPending} optionList={slot.rendererKeys.map((key) => ({ value: key, label: CMS_WIDGET_RENDERER_LABELS[key] }))} onChange={(value) => setRenderer(value as CmsWidgetRendererKey)} />
    <Button type="primary" disabled={!hasPermission('cms:widget:bind')} loading={save.isPending} onClick={() => void save.mutateAsync({ params: { slotKey: slot.key }, body: { siteId, widgetId, rendererKey: renderer } })}>保存{slot.label}</Button>
  </Space><Typography.Text type="tertiary" size="small">保存后加入配置草稿，构建并激活后上线。</Typography.Text></div>;
}

export default function ThemeWidgetSlotsEditor({ siteId }: { siteId?: number }) {
  const { hasPermission } = usePermission();
  const slots = useCmsWidgetSlots(siteId, !!siteId && hasPermission('cms:widget:list'));
  if (!siteId || !hasPermission('cms:widget:list')) return null;
  if (slots.isError) return <Banner type="warning" description="主题插槽加载失败，请重试。" />;
  return <div className="cms-composition-editor">{slots.data?.map((slot) => <SlotRow key={`${siteId}:${slot.key}:${slot.binding?.widgetId ?? ''}:${slot.binding?.rendererKey ?? ''}:${slot.binding?.updatedAt ?? ''}`} siteId={siteId} slot={slot} />)}</div>;
}
