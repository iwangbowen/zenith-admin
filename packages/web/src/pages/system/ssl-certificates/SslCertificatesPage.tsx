import { useState } from 'react';
import { Button, Descriptions, Form, SideSheet, Space, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Lock, Upload } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import {
  SSL_CERT_TYPES,
  type GenerateSelfSignedCertInput,
  type SslCertDownloadKind,
  type SslCertificate,
} from '@zenith/shared/ops';
import type { UploadCertSchemaInput } from '@zenith/shared/platform';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { SearchToolbar } from '@/components/SearchToolbar';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { useListSearch } from '@/hooks/useListSearch';
import { formatDateTime } from '@/utils/date';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import {
  downloadSslCertificate,
  sslCertificateKeys,
  useDeleteSslCertificates,
  useGenerateSslCertificate,
  useSslCertificateDetail,
  useSslCertificateList,
  useUploadSslCertificate,
} from '@/hooks/queries/ssl-certificates';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { FilterSelect, KeywordInput } from '@/components/search-filters';
import { confirmDelete } from '@/utils/confirm';

interface SearchParams {
  keyword: string;
  type?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', type: '' };

const TYPE_LABELS: Record<SslCertificate['type'], string> = {
  self_signed: '自签名',
  uploaded: '上传',
  letsencrypt: 'Let\'s Encrypt',
};

const STATUS_CONFIG: Record<SslCertificate['status'], { label: string; color: 'green' | 'orange' | 'red' | 'grey' }> = {
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
  const {
    page, pageSize, buildPagination,
    draftParams, setDraftParams, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: sslCertificateKeys.lists });
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<SslCertificate | null>(null);
  const listQuery = useSslCertificateList({
    page,
    pageSize,
    keyword: submittedParams.keyword.trim() || undefined,
    type: enumValueOf(SSL_CERT_TYPES, submittedParams.type),
  });
  const data = listQuery.data?.list ?? [];
  const total = listQuery.data?.total ?? 0;
  const detailQuery = useSslCertificateDetail(detail?.id, detailVisible);
  const displayDetail = detail ? (detailQuery.data ?? detail) : null;
  const generateMutation = useGenerateSslCertificate();
  const uploadMutation = useUploadSslCertificate();
  const generateModal = useEditModal<{ id: number }, Partial<GenerateSelfSignedCertInput>>({
    save: {
      mutateAsync: async ({ values }) => {
        await generateMutation.mutateAsync({ body: values as GenerateSelfSignedCertInput });
        return { id: 0 };
      },
      isPending: generateMutation.isPending,
    },
    defaults: { days: 365, country: 'CN', organization: 'Organization' },
    successMessage: () => '证书已生成',
  });
  const uploadModal = useEditModal<{ id: number }, Partial<UploadCertSchemaInput>>({
    save: {
      mutateAsync: async ({ values }) => {
        await uploadMutation.mutateAsync({ body: values as UploadCertSchemaInput });
        return { id: 0 };
      },
      isPending: uploadMutation.isPending,
    },
    successMessage: () => '证书已上传',
  });
  const deleteMutation = useDeleteSslCertificates();

  const canCreate = hasPermission('system:ssl:create');
  const canDelete = hasPermission('system:ssl:delete');

  const openDetail = (record: SslCertificate) => {
    setDetailVisible(true);
    setDetail(record);
  };

  const handleDelete = async (id: number) => {
    await deleteMutation.mutateAsync([id]);
    Toast.success('证书已删除');
    if (detail?.id === id) {
      setDetailVisible(false);
      setDetail(null);
    }
  };

  const handleDownload = async (kind: SslCertDownloadKind) => {
    if (!displayDetail) return;
    try {
      await downloadSslCertificate(displayDetail.id, kind, `${displayDetail.domain}-${kind}.pem`);
      Toast.success(kind === 'cert' ? '证书下载成功' : '私钥下载成功');
    } catch {
      Toast.error('下载失败');
    }
  };

  const columns: ColumnProps<SslCertificate>[] = [
    { title: '名称', dataIndex: 'name', width: 180, render: renderEllipsis },
    { title: '域名', dataIndex: 'domain', minWidth: 220, render: renderEllipsis },
    {
      title: '类型',
      dataIndex: 'type',
      width: 110,
      render: (value: SslCertificate['type']) => <Tag size="small">{TYPE_LABELS[value]}</Tag>,
    },
    { title: '颁发者', dataIndex: 'issuer', width: 220, render: renderEllipsis },
    dateTimeColumn('有效期至', 'validTo'),
    {
      title: '剩余天数',
      align: 'right',
      dataIndex: 'daysRemaining',
      width: 100,
      render: (value: number | null) => renderDaysRemaining(value),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      fixed: 'right',
      render: (value: SslCertificate['status']) => (
        <Tag color={STATUS_CONFIG[value].color} size="small">
          {STATUS_CONFIG[value].label}
        </Tag>
      ),
    },
    createOperationColumn<SslCertificate>({
      width: 180,
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
            confirmDelete({
              title: '确定要删除该证书吗？',
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
            <KeywordInput placeholder="搜索名称或域名" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} width={240} />
            <FilterSelect
              placeholder="全部证书类型"
              items={[{ value: 'self_signed', label: '自签名' },
                { value: 'uploaded', label: '上传' },
                { value: 'letsencrypt', label: 'Let\'s Encrypt' },]}
              value={draftParams.type}
              onChange={(value) => setDraftParams((prev) => ({ ...prev, type: value }))}
              width={160}
            />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
            {canCreate && <Button type="primary" icon={<Lock size={14} />} onClick={generateModal.openCreate}>生成自签名证书</Button>}
            {canCreate && <Button type="primary" icon={<Upload size={14} />} onClick={uploadModal.openCreate}>上传证书</Button>}
          </>
        )}
        mobilePrimary={(
          <>
            <KeywordInput placeholder="搜索名称或域名" value={draftParams.keyword} onChange={(value) => setDraftParams((prev) => ({ ...prev, keyword: value }))} onSearch={handleSearch} width={240} />
            <SearchButton onClick={handleSearch} />
            {canCreate && <Button type="primary" icon={<Lock size={14} />} onClick={generateModal.openCreate}>生成</Button>}
            {canCreate && <Button type="primary" icon={<Upload size={14} />} onClick={uploadModal.openCreate}>上传</Button>}
          </>
        )}
        mobileFilters={(
          <FilterSelect
            placeholder="全部证书类型"
            items={[{ value: 'self_signed', label: '自签名' },
              { value: 'uploaded', label: '上传' },
              { value: 'letsencrypt', label: 'Let\'s Encrypt' },]}
            value={draftParams.type}
            onChange={(value) => setDraftParams((prev) => ({ ...prev, type: value }))}
            width={160}
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
        {...generateModal.modalProps}
        title="生成自签名证书"
        width={520}
      >
        <Form key={generateModal.formKey} {...generateModal.formProps}>
          <Form.Input field="name" label="名称" rules={[{ required: true, message: '请输入名称' }]} />
          <Form.Input field="domain" label="域名" rules={[{ required: true, message: '请输入域名' }]} />
          <Form.InputNumber field="days" label="有效期" min={1} max={3650} suffix="天" style={{ width: '100%' }} />
          <Form.Input field="country" label="国家" />
          <Form.Input field="organization" label="组织" />
        </Form>
      </AppModal>

      <AppModal
        {...uploadModal.modalProps}
        title="上传证书"
        width={660}
      >
        <Form key={uploadModal.formKey} {...uploadModal.formProps}>
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
                align="plain"
                layout="horizontal"
                column={2}
                size="small"
                style={{ width: '100%' }}
                data={[
                  { key: '名称', value: displayDetail.name },
                  { key: '域名', value: displayDetail.domain },
                  { key: '类型', value: TYPE_LABELS[displayDetail.type] },
                  { key: '状态', value: <Tag color={STATUS_CONFIG[displayDetail.status].color} size="small">{STATUS_CONFIG[displayDetail.status].label}</Tag> },
                  { key: '生效时间', value: displayDetail.validFrom ? formatDateTime(displayDetail.validFrom) : '—' },
                  { key: '失效时间', value: displayDetail.validTo ? formatDateTime(displayDetail.validTo) : '—' },
                  { key: '剩余天数', value: renderDaysRemaining(displayDetail.daysRemaining) },
                  { key: '自动续期', value: displayDetail.autoRenew ? '是' : '否' },
                  { key: '创建时间', value: formatDateTime(displayDetail.createdAt) },
                  { key: '更新时间', value: formatDateTime(displayDetail.updatedAt) },
                  { key: '颁发者', value: displayDetail.issuer ?? '—', span: 2 },
                  { key: '主题', value: displayDetail.subject ?? '—', span: 2 },
                  { key: '序列号', value: displayDetail.serialNumber ?? '—', span: 2 },
                  { key: '指纹', value: displayDetail.fingerprint ?? '—', span: 2 },
                  { key: '证书路径', value: displayDetail.certPath ?? '—', span: 2 },
                  { key: '私钥路径', value: displayDetail.keyPath ?? '—', span: 2 },
                ]}
              />
            </div>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
