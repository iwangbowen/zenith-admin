import { useRef, useState } from 'react';
import {
  Button,
  Descriptions,
  Form,
  Input,
  Modal,
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
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { request } from '@/utils/request';
import { formatDateTime } from '@/utils/date';
import { renderEllipsis } from '@/utils/table-columns';
import { useQueryClient } from '@tanstack/react-query';
import {
  sslCertificateKeys,
  useDeleteSslCertificate,
  useGenerateSslCertificate,
  useSslCertificateDetail,
  useSslCertificateList,
  useUploadSslCertificate,
  type SslCertificateRecord,
} from '@/hooks/queries/ssl-certificates';

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
  const queryClient = useQueryClient();
  const { page, pageSize, setPage, buildPagination } = usePagination();
  const generateFormApi = useRef<FormApi | null>(null);
  const uploadFormApi = useRef<FormApi | null>(null);
  const [draftParams, setDraftParams] = useState<SearchParams>(defaultSearchParams);
  const [submittedParams, setSubmittedParams] = useState<SearchParams>(defaultSearchParams);
  const [generateVisible, setGenerateVisible] = useState(false);
  const [uploadVisible, setUploadVisible] = useState(false);
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<SslCertificateRecord | null>(null);
  const listQuery = useSslCertificateList({
    page,
    pageSize,
    keyword: submittedParams.keyword.trim() || undefined,
    type: submittedParams.type || undefined,
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useSslCertificateDetail(detail?.id, detailVisible);
  const displayDetail = detail ? (detailQuery.data ?? detail) : null;
  const generateMutation = useGenerateSslCertificate();
  const uploadMutation = useUploadSslCertificate();
  const deleteMutation = useDeleteSslCertificate();

  const canCreate = hasPermission('system:ssl:create');
  const canDelete = hasPermission('system:ssl:delete');

  const handleSearch = () => {
    setPage(1);
    setSubmittedParams(draftParams);
    void queryClient.invalidateQueries({ queryKey: sslCertificateKeys.lists });
  };

  const handleReset = () => {
    setDraftParams(defaultSearchParams);
    setSubmittedParams(defaultSearchParams);
    setPage(1);
    void queryClient.invalidateQueries({ queryKey: sslCertificateKeys.lists });
  };

  const openDetail = (record: SslCertificateRecord) => {
    setDetailVisible(true);
    setDetail(record);
  };

  const handleGenerate = async () => {
    let values: Record<string, unknown>;
    try {
      values = await generateFormApi.current?.validate() as Record<string, unknown>;
    } catch {
      throw new Error('validation');
    }
    await generateMutation.mutateAsync(values);
    Toast.success('证书已生成');
    setGenerateVisible(false);
    generateFormApi.current?.reset();
  };

  const handleUpload = async () => {
    let values: Record<string, unknown>;
    try {
      values = await uploadFormApi.current?.validate() as Record<string, unknown>;
    } catch {
      throw new Error('validation');
    }
    await uploadMutation.mutateAsync(values);
    Toast.success('证书已上传');
    setUploadVisible(false);
    uploadFormApi.current?.reset();
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync(id);
    Toast.success('证书已删除');
    if (detail?.id === id) {
      setDetailVisible(false);
      setDetail(null);
    }
  };

  const handleDownload = async (kind: 'cert' | 'key') => {
    if (!displayDetail) return;
    try {
      await request.download(`/api/ssl-certificates/${displayDetail.id}/download?kind=${kind}`, `${displayDetail.domain}-${kind}.pem`);
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
    createOperationColumn<SslCertificateRecord>({
      width: 130,
      actions: (record) => [
        {
          key: 'detail',
          label: '查看详情',
          onClick: () => { void openDetail(record); },
        },
        {
          key: 'delete',
          label: '删除',
          danger: true,
          hidden: !canDelete,
          onClick: () => {
            Modal.confirm({
              title: '确定要删除该证书吗？',
              okButtonProps: { type: 'danger', theme: 'solid' },
              onOk: () => { void handleDelete(record.id); },
            });
          },
        },
      ],
    }),
  ];

  return (
    <div className="page-container">
      <SearchToolbar
        primary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索名称或域名"
              value={draftParams.keyword}
              onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 240 }}
            />
            <Select
              placeholder="证书类型"
              value={draftParams.type || undefined}
              onChange={(value) => setDraftParams((prev) => ({ ...prev, type: (value as string) ?? '' }))}
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
          </>
        )}
        mobilePrimary={(
          <>
            <Input
              prefix={<Search size={14} />}
              placeholder="搜索名称或域名"
              value={draftParams.keyword}
              onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))}
              onEnterPress={handleSearch}
              showClear
              style={{ width: 240 }}
            />
            <Button type="primary" icon={<Search size={14} />} onClick={handleSearch}>查询</Button>
            {canCreate && <Button type="primary" icon={<Lock size={14} />} onClick={() => setGenerateVisible(true)}>生成</Button>}
            {canCreate && <Button type="primary" icon={<Upload size={14} />} onClick={() => setUploadVisible(true)}>上传</Button>}
          </>
        )}
        mobileFilters={(
          <Select
            placeholder="证书类型"
            value={draftParams.type || undefined}
            onChange={(value) => setDraftParams((prev) => ({ ...prev, type: (value as string) ?? '' }))}
            optionList={[
              { value: '', label: '全部类型' },
              { value: 'self_signed', label: '自签名' },
              { value: 'uploaded', label: '上传' },
              { value: 'letsencrypt', label: 'Let\'s Encrypt' },
            ]}
            style={{ width: 160 }}
          />
        )}
        filterTitle="证书筛选"
        onFilterApply={handleSearch}
        onFilterReset={handleReset}
      />

      <ConfigurableTable
        bordered
        rowKey="id"
        columns={columns}
        dataSource={data}
        loading={listQuery.isFetching}
        onRefresh={() => void listQuery.refetch()}
        refreshLoading={listQuery.isFetching}
        pagination={buildPagination(total)}
        empty="暂无证书"
      />

      <AppModal
        title="生成自签名证书"
        visible={generateVisible}
        onCancel={() => setGenerateVisible(false)}
        onOk={handleGenerate}
        okButtonProps={{ loading: generateMutation.isPending }}
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
        okButtonProps={{ loading: uploadMutation.isPending }}
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
        title={displayDetail ? `证书详情 · ${displayDetail.name}` : '证书详情'}
        visible={detailVisible}
        onCancel={() => setDetailVisible(false)}
        width={720}
      >
        <Spin spinning={detailQuery.isFetching}>
          {displayDetail && (
            <div style={{ padding: '8px 0 24px' }}>
              <Space style={{ marginBottom: 16 }}>
                <Button type="primary" onClick={() => void handleDownload('cert')}>下载证书</Button>
                <Button onClick={() => void handleDownload('key')}>下载私钥</Button>
              </Space>
              <Descriptions
                row
                size="small"
                data={[
                  { key: '名称', value: displayDetail.name },
                  { key: '域名', value: displayDetail.domain },
                  { key: '类型', value: TYPE_LABELS[displayDetail.type] },
                  { key: '状态', value: <Tag color={STATUS_CONFIG[displayDetail.status].color} size="small">{STATUS_CONFIG[displayDetail.status].label}</Tag> },
                  { key: '颁发者', value: displayDetail.issuer ?? '—' },
                  { key: '主题', value: displayDetail.subject ?? '—' },
                  { key: '生效时间', value: displayDetail.validFrom ? formatDateTime(displayDetail.validFrom) : '—' },
                  { key: '失效时间', value: displayDetail.validTo ? formatDateTime(displayDetail.validTo) : '—' },
                  { key: '剩余天数', value: renderDaysRemaining(displayDetail.daysRemaining) },
                  { key: '序列号', value: displayDetail.serialNumber ?? '—' },
                  { key: '指纹', value: displayDetail.fingerprint ?? '—' },
                  { key: '证书路径', value: displayDetail.certPath ?? '—' },
                  { key: '私钥路径', value: displayDetail.keyPath ?? '—' },
                  { key: '自动续期', value: displayDetail.autoRenew ? '是' : '否' },
                  { key: '创建时间', value: formatDateTime(displayDetail.createdAt) },
                  { key: '更新时间', value: formatDateTime(displayDetail.updatedAt) },
                ]}
              />
            </div>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
