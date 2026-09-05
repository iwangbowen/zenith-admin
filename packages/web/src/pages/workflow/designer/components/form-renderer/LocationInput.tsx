/** 定位：浏览器 geolocation 取经纬度 + 地址文本 */
import { useState } from 'react';
import { Button, Input, Toast, Typography, withField } from '@douyinfe/semi-ui';

interface LocationValue { lng?: number; lat?: number; address?: string }

function LocationInput({ value, onChange, disabled, placeholder }: Readonly<{
  value?: LocationValue; onChange?: (v: LocationValue | undefined) => void; disabled?: boolean; placeholder?: string;
}>) {
  const val = value ?? {};
  const [locating, setLocating] = useState(false);

  const locate = () => {
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
        onChange?.({ ...val, lng, lat });
        Toast.success('已获取当前坐标');
      },
      () => {
        setLocating(false);
        Toast.error('定位失败，请检查浏览器定位权限');
      },
      { timeout: 8000 },
    );
  };

  const setAddress = (address: string) => {
    const next = { ...val, address: address || undefined };
    onChange?.(next.address || next.lng != null ? next : undefined);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', gap: 8 }}>
        <Input
          value={val.address ?? ''}
          onChange={setAddress}
          placeholder={placeholder ?? '详细地址'}
          disabled={disabled}
        />
        <Button loading={locating} disabled={disabled} onClick={locate}>获取定位</Button>
      </div>
      {val.lng != null && val.lat != null && (
        <Typography.Text type="tertiary" size="small">经度 {val.lng} · 纬度 {val.lat}</Typography.Text>
      )}
    </div>
  );
}

export const FormLocation = withField(LocationInput);
