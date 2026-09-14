import { useEffect, useRef, useState } from 'react';
import { Modal, TextArea, Button, Toast, Typography } from '@douyinfe/semi-ui';
import { LocateFixed, MapPin } from 'lucide-react';
import { useElementSize } from '@/hooks/useElementSize';
import { getMapProvider, type MapProviderId, type MapInstance } from './mapProvider';

export interface MapPickerValue {
  lng?: number;
  lat?: number;
  address?: string;
}

export interface MapPickerProps {
  provider: MapProviderId;
  apiKey: string;
  securityJsCode?: string;
  defaultCenter: { lng: number; lat: number };
  defaultZoom: number;
  popupPc: { widthPct: number; heightPct: number };
  popupMobile: { widthPct: number; heightPct: number };
  value?: MapPickerValue;
  onChange?: (v: MapPickerValue | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
}

const PRESET_CENTER = { lng: 116.397, lat: 39.908 };

export function MapPicker({
  provider,
  apiKey,
  securityJsCode,
  defaultCenter = PRESET_CENTER,
  defaultZoom = 15,
  popupPc = { widthPct: 80, heightPct: 70 },
  popupMobile = { widthPct: 100, heightPct: 100 },
  value,
  onChange,
  disabled,
  placeholder,
}: Readonly<MapPickerProps>) {
  const mapProv = getMapProvider(provider);
  const { ref, width } = useElementSize<HTMLDivElement>();
  const [address, setAddress] = useState(value?.address ?? '');
  const [mapOpen, setMapOpen] = useState(false);
  const [locating, setLocating] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapInstanceRef = useRef<MapInstance | null>(null);
  const isNarrow = width > 0 && width < 520;

  useEffect(() => {
    setAddress(value?.address ?? '');
  }, [value?.address]);

  const emit = (next: MapPickerValue | undefined) => onChange?.(next);

  const handleAddress = (text: string) => {
    setAddress(text);
    const next: MapPickerValue = { ...(value ?? {}), address: text || undefined };
    emit(next.address || next.lng != null ? next : undefined);
  };

  const getLocation = () => {
    if (!navigator.geolocation) {
      Toast.error('当前浏览器不支持定位');
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setLocating(false);
        const lng = Number(pos.coords.longitude.toFixed(6));
        const lat = Number(pos.coords.latitude.toFixed(6));
        if (!apiKey) {
          emit({ ...(value ?? {}), lng, lat });
          Toast.warning(`未配置${mapProv.label} Key，仅回填坐标`);
          return;
        }
        mapProv.reverseGeocode(lng, lat, apiKey, securityJsCode)
          .then((addr) => {
            if (addr) {
              setAddress(addr);
              emit({ lng, lat, address: addr });
            } else {
              setAddress('');
              emit({ lng, lat, address: undefined });
              Toast.warning('逆地理编码未返回地址，已记录坐标，请在地址栏手动补充');
            }
          })
          .catch(() => {
            setAddress('');
            emit({ lng, lat, address: undefined });
            Toast.warning('逆地理编码未返回地址，已记录坐标，请在地址栏手动补充');
          });
      },
      () => {
        setLocating(false);
        Toast.error('定位失败，请检查浏览器定位权限');
      },
      { timeout: 8000 },
    );
  };

  const openMap = () => {
    if (disabled) return;
    if (!apiKey) {
      Toast.error(`未配置${mapProv.label} API Key`);
      return;
    }
    setMapOpen(true);
  };

  // 地图加载与回收（每次打开仅初始化一次）
  useEffect(() => {
    if (!mapOpen || !containerRef.current) return;
    let destroyed = false;
    let instance: MapInstance | null = null;
    mapProv.loadScript(apiKey, securityJsCode).then(() => {
      if (destroyed || !containerRef.current) return;
      instance = mapProv.createMap({ container: containerRef.current, center: defaultCenter, zoom: defaultZoom });
      mapInstanceRef.current = instance;
      instance.onClick((wgs) => {
        mapProv.reverseGeocode(wgs.lng, wgs.lat, apiKey, securityJsCode)
          .then((addr) => {
            if (addr) {
              setAddress(addr);
              emit({ lng: wgs.lng, lat: wgs.lat, address: addr });
            } else {
              // 逆编码未返回地址：保留坐标、清空地址，引导用户在地址栏手动补充（不再回填假坐标串）
              setAddress('');
              emit({ lng: wgs.lng, lat: wgs.lat, address: undefined });
              Toast.warning('逆地理编码未返回地址，已记录坐标，请在地址栏手动补充');
            }
            setMapOpen(false);
          })
          .catch(() => {
            setAddress('');
            emit({ lng: wgs.lng, lat: wgs.lat, address: undefined });
            Toast.warning('逆地理编码未返回地址，已记录坐标，请在地址栏手动补充');
            setMapOpen(false);
          });
      });
      requestAnimationFrame(() => requestAnimationFrame(() => instance?.checkResize()));
    }).catch(() => {
      Toast.error('地图脚本加载失败');
    });

    const onResize = () => instance?.checkResize();
    window.addEventListener('resize', onResize);
    return () => {
      destroyed = true;
      window.removeEventListener('resize', onResize);
      instance?.destroy();
      mapInstanceRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapOpen, isNarrow]);

  const closeMap = () => setMapOpen(false);
  const overlayHeight = Math.max(320, Math.round((window.innerHeight * popupPc.heightPct) / 100));

  return (
    <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <TextArea
        autosize={{ minRows: 2, maxRows: 4 }}
        value={address}
        onChange={handleAddress}
        placeholder={placeholder ?? '详细地址'}
        disabled={disabled}
      />
      <div style={{ display: 'flex', gap: 8 }}>
        <Button icon={<LocateFixed size={16} />} loading={locating} disabled={disabled} onClick={getLocation}>
          获取位置
        </Button>
        <Button icon={<MapPin size={16} />} disabled={disabled} onClick={openMap}>
          选择位置
        </Button>
      </div>
      {value?.lng != null && value?.lat != null && (
        <Typography.Text type="tertiary" size="small">
          经度 {value.lng} · 纬度 {value.lat}
        </Typography.Text>
      )}

      {isNarrow ? (
        mapOpen && (
          <div
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 1050,
              background: 'rgba(0, 0, 0, 0.35)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <div
              style={{
                // 移动端弹窗尺寸由字段配置的 mapPopupMobile 决定（默认 100/100 即全屏）
                width: `${popupMobile.widthPct}%`,
                height: Math.max(320, Math.round((window.innerHeight * popupMobile.heightPct) / 100)),
                maxHeight: '100%',
                background: '#fff',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: 8,
                  borderBottom: '1px solid var(--semi-color-border)',
                }}
              >
                <Typography.Text strong>选择位置</Typography.Text>
                <Button theme="borderless" onClick={closeMap}>
                  关闭
                </Button>
              </div>
              <div ref={containerRef} style={{ flex: 1, minHeight: 0 }} />
            </div>
          </div>
        )
      ) : (
        <Modal
          title="选择位置"
          visible={mapOpen}
          onCancel={closeMap}
          footer={null}
          closeOnEsc
          maskClosable
          width={`${popupPc.widthPct}%`}
        >
          <div ref={containerRef} style={{ width: '100%', height: overlayHeight }} />
        </Modal>
      )}
    </div>
  );
}
