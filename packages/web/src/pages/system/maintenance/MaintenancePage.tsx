import { useEffect, useRef } from 'react';
import {
  Banner,
  Button,
  Form,
  Modal,
  Spin,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Wrench, Power, PowerOff, RefreshCw } from 'lucide-react';
import type { MaintenanceLog } from '@zenith/shared';
import { useQueryClient } from '@tanstack/react-query';
import ConfigurableTable from '@/components/ConfigurableTable';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';
import {
  maintenanceKeys,
  useMaintenanceLogs,
  useMaintenanceStatus,
  useUpdateMaintenanceStatus,
} from '@/hooks/queries/maintenance';

const { Title, Text } = Typography;

interface FormValues {
  message: string;
  estimatedEndAt?: Date | null;
}

/** 将秒数格式化为「X 天 Y 小时 Z 分」 */
function formatDuration(sec: number | null): string {
  if (sec == null) return '—';
  if (sec < 60) return `${sec} 秒`;
  const d = Math.floor(sec / 86400);
  const h = Math.floor((sec % 86400) / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const parts: string[] = [];
  if (d) parts.push(`${d} 天`);
  if (h) parts.push(`${h} 小时`);
  if (m) parts.push(`${m} 分`);
  return parts.length > 0 ? parts.join(' ') : '不足 1 分';
}

export default function MaintenancePage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:maintenance:manage');
  const formApi = useRef<FormApi | null>(null);
  const queryClient = useQueryClient();

  const { page, pageSize, setPage, buildPagination } = usePagination();
  const statusQuery = useMaintenanceStatus();
  const logsQuery = useMaintenanceLogs({ page, pageSize });
  const updateMutation = useUpdateMaintenanceStatus();
  const status = statusQuery.data ?? null;
  const logs = logsQuery.data?.list ?? [];
  const logsTotal = logsQuery.data?.total ?? 0;

  useEffect(() => {
    if (!status) return;
    formApi.current?.setValues({
      message: status.message,
      estimatedEndAt: status.estimatedEndAt ? new Date(status.estimatedEndAt) : null,
    });
  }, [status]);

  // 横幅关闭维护后同步刷新页面状态
  useEffect(() => {
    const handler = () => void queryClient.invalidateQueries({ queryKey: maintenanceKeys.status });
    globalThis.addEventListener('maintenance:statusChanged', handler);
    return () => globalThis.removeEventListener('maintenance:statusChanged', handler);
  }, [queryClient]);

  const handleToggle = async (enable: boolean) => {
    if (!canManage) return;

    if (enable) {
      // 开启前二次确认，防止误操作
      const confirmed = await new Promise<boolean>((resolve) => {
        Modal.confirm({
          title: '确认开启维护模式？',
          content: '开启后，所有非超级管理员用户的 API 请求将返回 503，前端会显示维护提示页面。请确认已通知相关用户。',
          okText: '确认开启',
          okType: 'danger',
          cancelText: '取消',
          onOk: () => resolve(true),
          onCancel: () => resolve(false),
        });
      });
      if (!confirmed) return;
    }

    const values = formApi.current?.getValues() as FormValues | undefined;
    const data = await updateMutation.mutateAsync({
      enabled: enable,
      message: values?.message || '系统维护中，请稍后重试',
      estimatedEndAt: values?.estimatedEndAt ? formatDateTimeForApi(values.estimatedEndAt) : null,
    });
    Toast.success(enable ? '维护模式已开启' : '维护模式已关闭');
    globalThis.dispatchEvent(new CustomEvent('maintenance:statusChanged', { detail: data }));
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: maintenanceKeys.logs });
  };

  if (statusQuery.isFetching && !status) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  const isEnabled = status?.enabled ?? false;

  const logColumns: ColumnProps<MaintenanceLog>[] = [
    { title: '开始时间', dataIndex: 'startedAt', width: 200, render: (v: string | null) => v ?? <Text type="tertiary">—</Text> },
    { title: '结束时间', dataIndex: 'endedAt', width: 200, render: (v: string | null) => v ?? <Text type="tertiary">—</Text> },
    { title: '时长', dataIndex: 'durationSeconds', width: 120, render: (v: number | null) => formatDuration(v) },
    { title: '维护提示', dataIndex: 'message', ellipsis: { showTitle: true } },
    { title: '开启人', dataIndex: 'startedByName', width: 120, render: (v: string | null) => v ?? <Text type="tertiary">—</Text> },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (v: MaintenanceLog['status']) => (
        v === 'ongoing'
          ? <Tag color="orange" size="small">进行中</Tag>
          : <Tag color="green" size="small">已完成</Tag>
      ),
    },
  ];

  return (
    <div style={{ maxWidth: 1040, margin: '0 auto', padding: '0 0 40px' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
        <Wrench size={22} style={{ color: 'var(--semi-color-primary)' }} />
        <Title heading={4} style={{ margin: 0 }}>维护模式</Title>
      </div>

      {/* Status Banner */}
      <div style={{ marginBottom: 24 }}>
        {isEnabled ? (
          <Banner
            type="warning"
            icon={<PowerOff size={16} />}
            description={
              <span>
                维护模式已开启，所有非超级管理员用户将无法访问系统。
                {status?.startedByName && (
                  <> 由 <Text strong>{status.startedByName}</Text> 于 {status.startedAt} 开启。</>
                )}
              </span>
            }
            closeIcon={null}
          />
        ) : (
          <Banner
            type="success"
            icon={<Power size={16} />}
            description="系统运行正常，维护模式未开启。"
            closeIcon={null}
          />
        )}
      </div>

      {/* Current Status Card */}
      <div
        style={{
          background: 'var(--semi-color-bg-1)',
          border: '1px solid var(--semi-color-border)',
          borderRadius: 8,
          padding: '20px 24px',
          marginBottom: 20,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <Text type="secondary" size="small">当前状态</Text>
          <Button
            icon={<RefreshCw size={13} />}
            size="small"
            theme="borderless"
            loading={statusQuery.isFetching}
            onClick={() => void statusQuery.refetch()}
          >
            刷新
          </Button>
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px 32px' }}>
          <div>
            <Text type="secondary" size="small">状态</Text>
            <div style={{ marginTop: 4 }}>
              {isEnabled
                ? <Tag color="orange" size="large">维护中</Tag>
                : <Tag color="green" size="large">正常运行</Tag>}
            </div>
          </div>
          {status?.startedByName && (
            <div>
              <Text type="secondary" size="small">开启人</Text>
              <div style={{ marginTop: 4 }}><Text strong>{status.startedByName}</Text></div>
            </div>
          )}
          {status?.startedAt && (
            <div>
              <Text type="secondary" size="small">开启时间</Text>
              <div style={{ marginTop: 4 }}><Text>{status.startedAt}</Text></div>
            </div>
          )}
          {status?.estimatedEndAt && (
            <div>
              <Text type="secondary" size="small">预计结束</Text>
              <div style={{ marginTop: 4 }}><Text>{status.estimatedEndAt}</Text></div>
            </div>
          )}
          <div>
            <Text type="secondary" size="small">最后更新</Text>
            <div style={{ marginTop: 4 }}><Text>{status ? formatDateTime(status.updatedAt) : '-'}</Text></div>
          </div>
        </div>
      </div>

      {/* Config Form */}
      {canManage && (
        <div
          style={{
            background: 'var(--semi-color-bg-1)',
            border: '1px solid var(--semi-color-border)',
            borderRadius: 8,
            padding: '20px 24px',
          }}
        >
          <Text type="secondary" size="small" style={{ display: 'block', marginBottom: 16 }}>维护配置</Text>
          <Form
            getFormApi={(api) => { formApi.current = api; }}
            labelPosition="left"
            labelWidth={100}
            initValues={{
              message: status?.message ?? '系统维护中，请稍后重试',
              estimatedEndAt: status?.estimatedEndAt ? new Date(status.estimatedEndAt) : null,
            }}
          >
            <Form.TextArea
              field="message"
              label="维护提示"
              placeholder="向用户展示的维护提示信息"
              rows={3}
              maxCount={512}
              disabled={!canManage}
            />
            <Form.DatePicker
              field="estimatedEndAt"
              label="预计结束时间"
              type="dateTime"
              placeholder="选择预计结束时间（可选）"
              format="yyyy-MM-dd HH:mm:ss"
              style={{ width: '100%' }}
              disabled={!canManage}
            />
          </Form>

          <div style={{ marginTop: 20, display: 'flex', gap: 12 }}>
            {isEnabled ? (
              <Button
                type="tertiary"
                theme="solid"
                icon={<Power size={14} />}
                loading={updateMutation.isPending}
                onClick={() => void handleToggle(false)}
              >
                关闭维护模式
              </Button>
            ) : (
              <Button
                type="warning"
                theme="solid"
                icon={<PowerOff size={14} />}
                loading={updateMutation.isPending}
                onClick={() => void handleToggle(true)}
              >
                开启维护模式
              </Button>
            )}
          </div>
          <div style={{ marginTop: 12 }}>
            <Text type="warning" size="small">
              ⚠ 开启维护模式后，所有非超级管理员用户的 API 请求将返回 503，前端会显示维护提示页面。
            </Text>
          </div>
        </div>
      )}

      {/* Maintenance History */}
      <div
        style={{
          background: 'var(--semi-color-bg-1)',
          border: '1px solid var(--semi-color-border)',
          borderRadius: 8,
          padding: '20px 24px',
          marginTop: 20,
        }}
      >
        <Text type="secondary" size="small" style={{ display: 'block', marginBottom: 16 }}>维护记录</Text>
        <ConfigurableTable<MaintenanceLog>
          bordered
          size="small"
          rowKey="id"
          columns={logColumns}
          dataSource={logs}
          loading={logsQuery.isFetching}
          empty="暂无维护记录"
          onRefresh={() => void logsQuery.refetch()}
          refreshLoading={logsQuery.isFetching}
          pagination={buildPagination(logsTotal)}
        />
      </div>
    </div>
  );
}
