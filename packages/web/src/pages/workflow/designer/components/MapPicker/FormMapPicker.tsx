import { createContext, useContext } from 'react';
import { withField } from '@douyinfe/semi-ui';
import { MapPicker, type MapPickerValue } from './MapPicker';
import { useMapApiKey } from './useMapApiKey';
import type { MapProviderId } from './mapProvider';

export interface MapPickerConfig {
  provider?: MapProviderId;
  defaultCenter?: { lng: number; lat: number };
  defaultZoom?: number;
  popupPc?: { widthPct: number; heightPct: number };
  popupMobile?: { widthPct: number; heightPct: number };
}

// 由 FieldRenderer 在渲染时注入 per-form 配置（withField 不转发自定义属性，故走 Context）
export const MapPickerConfigContext = createContext<MapPickerConfig>({});

interface MapPickerFieldProps {
  value?: MapPickerValue;
  onChange?: (v: MapPickerValue | undefined) => void;
  disabled?: boolean;
  placeholder?: string;
}

const PRESET_CENTER = { lng: 116.397, lat: 39.908 };

function MapPickerField({ value, onChange, disabled, placeholder }: Readonly<MapPickerFieldProps>) {
  const cfg = useContext(MapPickerConfigContext);
  const pid = cfg.provider ?? 'tianditu';
  const { apiKey, securityJsCode } = useMapApiKey(pid);
  return (
    <MapPicker
      provider={pid}
      apiKey={apiKey}
      securityJsCode={securityJsCode}
      defaultCenter={cfg.defaultCenter ?? PRESET_CENTER}
      defaultZoom={cfg.defaultZoom ?? 15}
      popupPc={cfg.popupPc ?? { widthPct: 80, heightPct: 70 }}
      popupMobile={cfg.popupMobile ?? { widthPct: 100, heightPct: 100 }}
      value={value}
      onChange={onChange}
      disabled={disabled}
      placeholder={placeholder}
    />
  );
}

export const FormMapPicker = withField(MapPickerField);
