import type { ChartPalette } from './palette';

/** 热力图「少 → 多」图例色阶条 */
export function HeatmapLegend({ palette }: { readonly palette: ChartPalette }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 6, fontSize: 11, color: 'var(--semi-color-text-2)' }}>
      <span>少</span>
      {palette.heatColors.map((color) => (
        <div key={color} style={{ width: 12, height: 12, borderRadius: 3, background: color }} />
      ))}
      <span>多</span>
    </div>
  );
}
