import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Button,
  Descriptions,
  Form,
  Input,
  Popconfirm,
  Select,
  SideSheet,
  Space,
  Spin,
  Tag,
  Toast,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { FormApi } from '@douyinfe/semi-ui/lib/es/form/interface';
import { Lock, Search, RotateCcw, Upload } from 'lucide-react';
import type { PaginatedResponse, SslCertificate } from '@zenith/shared';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';

interface SslCertificateRecord extends SslCertificate {
  daysRemaining: number | null;
}

interface SearchParams {
  keyword: string;
  type: string;
}

const defaultSearchParams: SearchParams = { keyword: '', type: '' };

const TYPE_LABELS: Record<SslCertificateRecord['type'], string> = {
  self_signed: '自签名',
  uploaded: '上传',
  letsencrypt: 'Let\'s Encrypt',
};

const STATUS_CONFIG: Record<SslCertificateRecord['status'], { label: string; color: 'green' | 'orange' | 'red' | 'grey' }> = {
  valid: { label: '有效', color: 'green' },
  expiring: { label: '即将过期', color: 'orange' },
  expired: { label: '已过期', color: 'red' },
  invalid: { label: '无效', color: 'grey' },
};

function renderDaysRemaining(daysRemaining: number | null) {
  if (daysRemaining === null) {
    return <span style={{ color: 'var(--semi-color-text-2)' }}>—</span>;
  }
  if (daysRemaining <= 0) {
    return <span style={{ color: 'var(--semi-color-danger)' }}>{daysRemaining} 天</span>;
  }
  if (daysRemaining <= 30) {
    return <span style={{ color: 'var(--semi-color-warning)' }}>{daysRemaining} 天</span>;
  }
  return <span style={{ color: 'var(--semi-color-success)' }}>{daysRemaining} 天</span>;
}

export default function SslCertificatesPage() {
  const { hasPermission } = usePermission();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const generateFormApi = useRef<FormApi | null>(null);
  const uploadFormApi = useRef<FormApi | null>(null);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<SslCertificateRecord[]>([]);
  const [total, setTotal] = useState(0);
  const [searchParams, setSearchParams] = useState<SearchParams>(defaultSearchParams);
  const searchParamsRef = useRef<SearchParams>(defaultSearchParams);
  searchParamsRef.current = searchParams;
  const [generateVisible, setGenerateVisible] = useState(false);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detail, setDetail] = useState<SslCertificateRecord | null>(null);

  const canCreate = hasPermission('system:ssl:create');
  const canDelete = hasPermission('system:ssl:delete');

  const fetchData = useCallback(async (p = page, ps = pageSize, override?: SearchParams) => {
    const params = override ?? searchParamsRef.current;
    setLoading(true);
    try {
      const query = new URLSearchParams({ page: String(p), pageSize: String(ps) });
      if (params.keyword.trim()) {
        query.set('keyword', params.keyword.trim());
      }
      if (params.type) {
        query.set('type', params.type);
      }
      const res = await request.get<PaginatedResponse<SslCertificateRecord>>(`/api/ssl-certificates?${query.toString()}`);
      if (res.code === 0 && res.data) {
        setData(res.data.list);
        setTotal(res.data.total);
        setPage(p);
      }
    } finally {
      setLoading(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, pageSize]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleSearch = () => {
    setPage(1);
    void fetchData(1);
  };

  const handleReset = () => {
    setSearchParams(defaultSearchParams);
    setPage(1);
    void fetchData(1, pageSize, defaultSearchParams);
  };

  const openDetail = async (record: SslCertificateRecord) => {
    setDetailVisible(true);
    setDetail(record);
    setDetailLoading(true);
    try {
      const res = await request.get<SslCertificateRecord>(`/api/ssl-certificates/${record.id}`);
      if (res.code === 0 && res.data) {
        setDetail(res.data);
      }
    } finally {
      setDetailLoading(false);
    }
  };

  const handleGenerate = async () => {
    let values: Record<string, unknown>;
    try {
      values = await generateFormApi.current?.validate() as Record<string, unknown>;
    } catch {
      throw new Error('validation');
    }
    setSubmitting(true);
    try {
      const res = await request.post('/api/ssl-certificates/generate', values);
      if (res.code === 0) {
        Toast.success('证书已生成');
        setGenerateVisible(false);
        generateFormApi.current?.reset();
        void fetchData(1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpload = async () => {
    let values: Record<string, unknown>;
    try {
      values = await uploadFormApi.current?.validate() as Record<string, unknown>;
    } catch {
      throw new Error('validation');
    }
    setSubmitting(true);
    try {
      const res = await request.post('/api/ssl-certificates/upload', values);
      if (res.code === 0) {
        Toast.success('证书已上传');
        setUploadVisible(false);
        uploadFormApi.current?.reset();
        void fetchData(1);
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: number) => {
    const res = await request.delete(`/api/ssl-certificates/${id}`);
    if (res.code === 0) {
      Toast.success('证书已删除');
      if (detail?.id === id) {
        setDetailVisible(false);
        setDetail(null);
      }
      void fetchData();
    }
  };

  const handleDownload = async (kind: 'cert' | 'key') => {
    if (!detail) return;
    try {
      await request.download(`/api/ssl-certificates/${detail.id}/download?kind=${kind}`, `${detail.domain}-${kind}.pem`);
      Toast.success(kind === 'cert' ? '证书下载成功' : '私钥下载成功');
    } catch {
      Toast.error('下载失败');
    }
  };

  const columns: ColumnProps<SslCertificateRecord>[] = [
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '域名', dataIndex: 'domain', width: 220, render: renderEllipsis },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (value: SslCertificateRecord['type']) => <Tag size="small">{TYPE_LABELS[value]}</Tag>,
    },
    { title: '颁发者', dataIndex: 'issuer', width: 220, render: renderEllipsis },
    {
      title: '有效期至',
      dataIndex: 'validTo',
      width: 180,
      render: (value: string | null) => (value ? formatDateTime(value) : '—'),
    },
    {
      title: '剩余天数',
      dataIndex: 'daysRemaining',
      width: 100,
      render: (value: number | null) => renderDaysRemaining(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      fixed: 'right',
      render: (value: SslCertificateRecord['status']) => (
        <Tag color={STATUS_CONFIG[value].color} size="small">
          {STATUS_CONFIG[value].label}
        </Tag>
      ),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_value: unknown, record: SslCertificateRecord) => (
        <Space>
          <Button theme="borderless" size="small" onClick={() => { void openDetail(record); }}>
            查看详情
          </Button>
          {canDelete && (
            <Popconfirm title="确定要删除该证书吗？" onConfirm={() => void handleDelete(record.id)}>
              <Button theme="borderless" type="danger" size="small">
                删除
              </Button>
            </Popconfirm>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="page-container">
      <SearchToolbar>
        <Input
          prefix={<Search size={14} />}
          placeholder="搜索名称或域名"
          value={searchParams.keyword}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, keyword: value }))}
          onEnterPress={handleSearch}
          showClear
          style={{ width: 240 }}
        />
        <Select
          placeholder="证书类型"
          value={searchParams.type || undefined}
          onChange={(value) => setSearchParams((prev) => ({ ...prev, type: (value as string) ?? '' }))}
          optionList={[
            { value: '', label: '全部类型' },
            { value: 'self_signed', label: '自签名' },
            { value: 'uploaded', label: '上传' },
            { value: 'letsencrypt', label: 'Let\'s Encrypt' },
          ]}
          style={{ width: 160 }}
        />
        <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
        <Button type="tertiary" icon={<RotateCcw size={14} />} onClick={handleReset}>重置</Button>
        {canCreate && <Button type="primary" icon={<Lock size={14} />} onClick={() => setGenerateVisible(true)}>生成自签名证书</Button>}
        {canCreate && <Button type="primary" icon={<Upload size={14} />} onClick={() => setUploadVisible(true)}>上传证书</Button>}
      </SearchToolbar>

      <ConfigurableTable
        bordered
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={loading}
        onRefresh={() => void fetchData()}
        refreshLoading={loading}
        pagination={buildPagination(total, fetchData)}
        empty="暂无证书"
      />

      <AppModal
        title="生成自签名证书"
        visible={generateVisible}
        onCancel={() => setGenerateVisible(false)}
        onOk={handleGenerate}
        okButtonProps={{ loading: submitting }}
        width={520}
        closeOnEsc
      >
        <Form
          getFormApi={(api) => { generateFormApi.current = api; }}
          initValues={{ days: 365, country: 'CN', organization: 'Organization' }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="domain" label="域名" rules={[{ required: true, message: '请输入域名' }]} />
          <Form.InputNumber field="days" label="有效期" min={1} max={3650} suffix="天" style={{ width: '100%' }} />
          <Form.Input field="country" label="国家" />
          <Form.Input field="organization" label="组织" />
        </Form>
      </AppModal>

      <AppModal
        title="上传证书"
        visible={uploadVisible}
        onCancel={() => setUploadVisible(false)}
        onOk={handleUpload}
        okButtonProps={{ loading: submitting }}
        width={660}
        closeOnEsc
      >
        <Form
          getFormApi={(api) => { uploadFormApi.current = api; }}
          labelPosition="left"
          labelWidth={90}
        >
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="domain" label="域名" rules={[{ required: true, message: '请输入域名' }]} />
          <Form.TextArea field="certContent" label="证书内容" rows={8} rules={[{ required: true, message: '请输入证书内容' }]} />
          <Form.TextArea field="keyContent" label="私钥内容" rows={8} rules={[{ required: true, message: '请输入私钥内容' }]} />
        </Form>
      </AppModal>

      <SideSheet
        title={detail ? `证书详情 · ${detail.name}` : '证书详情'}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width={720}
      >
        <Spin spinning={detailLoading}>
          {detail && (
            <div style={{ padding: '8px 0 24px' }}>
              <Space style={{ marginBottom: 16 }}>
                <Button type="primary" onClick={() => void handleDownload('cert')}>下载证书</Button>
                <Button onClick={() => void handleDownload('key')}>下载私钥</Button>
              </Space>
              <Descriptions
                row
                size="small"
                data={[
                  { key: '名称', value: detail.name },
                  { key: '域名', value: detail.domain },
                  { key: '类型', value: TYPE_LABELS[detail.type] },
                  { key: '状态', value: <Tag color={STATUS_CONFIG[detail.status].color} size="small">{STATUS_CONFIG[detail.status].label}</Tag> },
                  { key: '颁发者', value: detail.issuer ?? '—' },
                  { key: '主题', value: detail.subject ?? '—' },
                  { key: '生效时间', value: detail.validFrom ? formatDateTime(detail.validFrom) : '—' },
                  { key: '失效时间', value: detail.validTo ? formatDateTime(detail.validTo) : '—' },
                  { key: '剩余天数', value: renderDaysRemaining(detail.daysRemaining) },
                  { key: '序列号', value: detail.serialNumber ?? '—' },
                  { key: '指纹', value: detail.fingerprint ?? '—' },
                  { key: '证书路径', value: detail.certPath ?? '—' },
                  { key: '私钥路径', value: detail.keyPath ?? '—' },
                  { key: '自动续期', value: detail.autoRenew ? '是' : '否' },
                  { key: '创建时间', value: formatDateTime(detail.createdAt) },
                  { key: '更新时间', value: formatDateTime(detail.updatedAt) },
                ]}
              />
            </div>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
