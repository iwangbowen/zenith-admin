import { Descriptions, Progress, SideSheet, Spin, Typography } from '@douyinfe/semi-ui';
import { IOT_OTA_DEVICE_STATUS_LABELS } from '@zenith/shared/iot';
import { formatBytes } from '@zenith/shared/core';
import { EntityContextView } from '@/components/entity-relations/EntityRelationButton';
import DateTimeText from '@/components/DateTimeText';
import { useIotFirmwareDetail, useIotOtaDeviceDetail } from '@/hooks/queries/iot-ota';

export function IotFirmwareDetail({ id, onClose }: { readonly id: number | null; readonly onClose: () => void }) {
  const query = useIotFirmwareDetail(id ?? undefined);
  const row = query.data;
  return <SideSheet title="固件详情" width={720} visible={id !== null} onCancel={onClose}>
    {query.isLoading ? <Spin /> : row ? <>
      <Descriptions align="left" data={[
        { key: '版本', value: row.version }, { key: '产品', value: row.productName || '—' },
        { key: '文件名', value: row.fileName }, { key: '大小', value: formatBytes(row.size) },
        { key: 'SHA256', value: <Typography.Text copyable style={{ overflowWrap: 'anywhere' }}>{row.sha256}</Typography.Text> },
        { key: '发布说明', value: row.releaseNotes || '—' }, { key: '创建时间', value: <DateTimeText value={row.createdAt} /> },
      ]} />
      <EntityContextView entityType="iot.firmware" entityKey={String(row.id)} />
    </> : <Typography.Text type="danger">固件不存在或无权查看</Typography.Text>}
  </SideSheet>;
}

export function IotOtaDeviceDetail({ id, onClose }: { readonly id: number | null; readonly onClose: () => void }) {
  const query = useIotOtaDeviceDetail(id);
  const row = query.data;
  return <SideSheet title="设备升级结果" width={720} visible={id !== null} onCancel={onClose}>
    {query.isLoading ? <Spin /> : row ? <>
      <Descriptions align="left" data={[
        { key: '设备', value: row.deviceName || '—' }, { key: 'SN', value: row.deviceSn || '—' },
        { key: '状态', value: IOT_OTA_DEVICE_STATUS_LABELS[row.status] }, { key: '进度', value: <Progress percent={row.progress} /> },
        { key: '原版本', value: row.fromVersion || '—' }, { key: '灰度批次', value: row.batchIndex },
        { key: '失败原因', value: row.errorMsg || '—' }, { key: '通知时间', value: <DateTimeText value={row.notifiedAt} /> },
        { key: '完成时间', value: <DateTimeText value={row.finishedAt} /> },
      ]} />
      <EntityContextView entityType="iot.ota-device" entityKey={String(row.id)} />
    </> : <Typography.Text type="danger">升级结果不存在或无权查看</Typography.Text>}
  </SideSheet>;
}
