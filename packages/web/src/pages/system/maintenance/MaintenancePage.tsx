import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Banner,
  Button,
  DatePicker,
  Form,
  Space,
  Spin,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form';
import { Wrench, Power, PowerOff, RefreshCw } from 'lucide-react';
import { request } from '@/utils/request';
import { usePermission } from '@/hooks/usePermission';
import { formatDateTime, formatDateTimeForApi } from '@/utils/date';

const { Title, Text } = Typography;

interface MaintenanceStatus {
  enabled: boolean;
  message: string;
  estimatedEndAt: string | null;
  startedAt: string | null;
  startedByName: string | null;
  updatedAt: string;
}

interface FormValues {
  message: string;
  estimatedEndAt?: Date | null;
}

export default function MaintenancePage() {
  const { hasPermission } = usePermission();
  const canManage = hasPermission('system:maintenance:manage');
  const formApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [status, setStatus] = useState<MaintenanceStatus | null>(null);

  const fetchStatus = useCallback(async () => {
    setLoading(true);
    try {
      const res = await request.get<MaintenanceStatus>('/api/maintenance');
      if (res.code === 0) {
        setStatus(res.data);
        formApi.current?.setValues({
          message: res.data.message,
          estimatedEndAt: res.data.estimatedEndAt ? new Date(res.data.estimatedEndAt) : null,
        });
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchStatus();
  }, [fetchStatus]);

  const handleToggle = async (enable: boolean) => {
    if (!canManage) return;
    const values = formApi.current?.getValues() as FormValues | undefined;
    setSubmitting(true);
    try {
      const res = await request.put<MaintenanceStatus>('/api/maintenance', {
        enabled: enable,
        message: values?.message || '系统维护中，请稍后重试',
        estimatedEndAt: values?.estimatedEndAt ? formatDateTimeForApi(values.estimatedEndAt) : null,
      });
      if (res.code === 0) {
        setStatus(res.data);
        Toast.success(enable ? '维护模式已开启' : '维护模式已关闭');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading && !status) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
        <Spin size="large" />
      </div>
    );
  }

  const isEnabled = status?.enabled ?? false;

  return (
    <div style={{ maxWidth: 720, margin: '0 auto', padding: '0 0 40px' }}>
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
            loading={loading}
            onClick={fetchStatus}
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
                loading={submitting}
                onClick={() => void handleToggle(false)}
              >
                关闭维护模式
              </Button>
            ) : (
              <Button
                type="warning"
                theme="solid"
                icon={<PowerOff size={14} />}
                loading={submitting}
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
    </div>
  );
}
