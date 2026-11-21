import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Empty, Spin, Typography } from '@douyinfe/semi-ui';
import { LngLatBounds, Map as MapLibreMap, Marker, NavigationControl, Popup, setWorkerUrl, type StyleSpecification } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// maplibre 通过运行时拼接 import.meta.url 定位 worker，打包器无法静态收集；显式经 Vite 产出并指定地址，dev 与生产都能加载。
// 使用相对路径而非裸包名，避免 Vite 依赖预构建把 ?url 当成 JS 模块（裸包名会被 prebundle 成模块对象）。
import maplibreWorkerUrl from '../../../../../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import type { IotDevice } from '@zenith/shared/iot';

setWorkerUrl(maplibreWorkerUrl);

const { Text } = Typography;

/** OSM 栅格底图（与文件预览的地理渲染器同源；生产可替换为自托管瓦片） */
const OSM_TILE_URL = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';

const MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [OSM_TILE_URL],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

const FILL_STYLE: CSSProperties = { position: 'absolute', inset: 0 };

interface IotDeviceMapProps {
  /** 已带经纬度的设备 */
  devices: IotDevice[];
  /** 设备清单仍在首次加载中（决定「暂无已定位设备」空态是否展示） */
  loading: boolean;
  onSelect: (device: IotDevice) => void;
}

/**
 * 设备散点地图（在线绿 / 离线灰，点击进详情），铺满父级定尺寸的 `position: relative` 外框。
 *
 * maplibre-gl 的 JS 与 CSS 只在本模块静态引入：由页面 `lazy()` 加载，2MB 的 vendor-maplibre 不进入页面 chunk 的静态闭包。
 * 不能在页面里「JS 动态 import + CSS 静态 import」——CSS 模块被分包规则划进 vendor-maplibre，
 * 对它的静态 import 会把整个 JS chunk 一起变成页面的静态依赖，动态 import 形同虚设。
 */
export default function IotDeviceMap({ devices, loading, onSelect }: Readonly<IotDeviceMapProps>) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new MapLibreMap({
      container: containerRef.current,
      style: MAP_STYLE,
      center: [104.5, 35.5],
      zoom: 3.2,
      attributionControl: { compact: true },
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    map.on('load', () => setMapReady(true));
    mapRef.current = map;
    return () => {
      markersRef.current.forEach((m) => m.remove());
      markersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 设备散点：数据变化时重建 markers 并自适应视野
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    markersRef.current.forEach((m) => m.remove());
    markersRef.current = devices.map((device) => {
      const el = document.createElement('div');
      el.style.cssText = [
        'width:14px', 'height:14px', 'border-radius:50%', 'cursor:pointer',
        'border:2px solid var(--semi-color-bg-0, #fff)',
        `background:${device.online ? 'var(--semi-color-success, #3bb346)' : 'var(--semi-color-text-3, #aaa)'}`,
        'box-shadow:0 1px 4px rgba(0,0,0,.35)',
      ].join(';');
      el.title = `${device.name}（${device.sn}）`;
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onSelectRef.current(device);
      });
      const marker = new Marker({ element: el })
        .setLngLat([device.longitude!, device.latitude!])
        .setPopup(new Popup({ offset: 12, closeButton: false }).setHTML(
          `<div style="font-size:12px"><b>${device.name}</b><br/>${device.sn}<br/>${device.online ? '🟢 在线' : '⚪ 离线'}${device.address ? `<br/>${device.address}` : ''}</div>`,
        ))
        .addTo(map);
      el.addEventListener('mouseenter', () => marker.togglePopup());
      el.addEventListener('mouseleave', () => marker.togglePopup());
      return marker;
    });
    if (devices.length > 0) {
      const bounds = devices.reduce(
        (b, d) => b.extend([d.longitude!, d.latitude!]),
        new LngLatBounds([devices[0].longitude!, devices[0].latitude!], [devices[0].longitude!, devices[0].latitude!]),
      );
      map.fitBounds(bounds, { padding: 80, maxZoom: 10, duration: 400 });
    }
  }, [devices, mapReady]);

  return (
    <>
      <div ref={containerRef} style={FILL_STYLE} />
      {!mapReady && (
        <div style={{ ...FILL_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Spin size="large" />
        </div>
      )}
      {mapReady && !loading && devices.length === 0 && (
        <div style={{
          ...FILL_STYLE, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'color-mix(in srgb, var(--semi-color-bg-0) 72%, transparent)', pointerEvents: 'none',
        }}>
          <Empty description={(
            <Text type="tertiary">暂无已定位设备 — 在设备「编辑」表单中填写经纬度后显示在地图上</Text>
          )} />
        </div>
      )}
    </>
  );
}
