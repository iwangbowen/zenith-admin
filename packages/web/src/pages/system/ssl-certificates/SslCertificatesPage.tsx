import { useState, useMemo } from 'react';
import { Button, Descriptions, Form, SideSheet, Space, Spin, Tag, Toast } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Lock, Upload } from 'lucide-react';
import { enumValueOf } from '@zenith/shared/core';
import {
  SSL_CERT_STATUS_LABELS,
  SSL_CERT_TYPE_LABELS,
  SSL_CERT_TYPE_OPTIONS,
  SSL_CERT_TYPES,
  type GenerateSelfSignedCertInput,
  type SslCertDownloadKind,
  type SslCertificate,
} from '@zenith/shared/ops';
import type { UploadCertSchemaInput } from '@zenith/shared/platform';
import AppModal from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { deleteAction, ListSearchToolbar, listTableProps } from '@/components/list-page';
import { usePermission } from '@/hooks/usePermission';
import { useEditModal } from '@/hooks/useEditModal';
import { compactParams } from '@/lib/query';
import { useListSearch } from '@/hooks/useListSearch';
import { formatDateTime } from '@/utils/date';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderEllipsis } from '@/utils/table-columns';
import {
  downloadSslCertificate,
  sslCertificateKeys,
  useDeleteSslCertificates,
  useGenerateSslCertificate,
  useSslCertificateDetail,
  useSslCertificateList,
  useUploadSslCertificate,
} from '@/hooks/queries/ssl-certificates';
import { FilterSelect, KeywordInput } from '@/components/search-filters';

interface SearchParams {
  keyword: string;
  type?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', type: undefined };

const STATUS_COLORS: Record<SslCertificate['status'], 'green' | 'orange' | 'red' | 'grey'> = {
  valid: 'green',
  expiring: 'orange',
  expired: 'red',
  invalid: 'grey',
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
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: sslCertificateKeys.lists });
  const [detailVisible, setDetailVisible] = useState(false);
  const [detail, setDetail] = useState<SslCertificate | null>(null);
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword.trim(),
    type: enumValueOf(SSL_CERT_TYPES, submittedParams.type),
  }), [submittedParams]);

  const listQuery = useSslCertificateList({ page, pageSize, ...filterQuery });
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
      render: (value: SslCertificate['type']) => <Tag size="small">{SSL_CERT_TYPE_LABELS[value]}</Tag>,
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
        <Tag color={STATUS_COLORS[value]} size="small">
          {SSL_CERT_STATUS_LABELS[value]}
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
        deleteAction({
          hidden: !canDelete,
          title: '确定要删除该证书吗？',
          run: () => deleteMutation.mutateAsync([record.id]),
          successMessage: '证书已删除',
          onDeleted: () => {
            if (detail?.id === record.id) {
              setDetailVisible(false);
              setDetail(null);
            }
          },
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput placeholder="搜索名称或域名" {...bindKeyword('keyword')} width={240} />}
        filters={(
          <FilterSelect
            placeholder="全部证书类型"
            items={SSL_CERT_TYPE_OPTIONS}
            {...bind('type')}
            width={160}
          />
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        create={canCreate ? (
          <>
            <Button type="primary" icon={<Lock size={14} />} onClick={generateModal.openCreate}>生成自签名证书</Button>
            <Button type="primary" icon={<Upload size={14} />} onClick={uploadModal.openCreate}>上传证书</Button>
          </>
        ) : null}
        mobileActions={canCreate ? (
          <>
            <Button theme="borderless" icon={<Lock size={14} />} onClick={generateModal.openCreate}>生成</Button>
            <Button theme="borderless" icon={<Upload size={14} />} onClick={uploadModal.openCreate}>上传</Button>
          </>
        ) : null}
        filterTitle="证书筛选"
      />

      <ConfigurableTable
        columns={columns}
        {...listTableProps(listQuery, { pagination: buildPagination, empty: '暂无证书' })}
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
                  { key: '类型', value: SSL_CERT_TYPE_LABELS[displayDetail.type] },
                  { key: '状态', value: <Tag color={STATUS_COLORS[displayDetail.status]} size="small">{SSL_CERT_STATUS_LABELS[displayDetail.status]}</Tag> },
                  { key: '生效时间', value: displayDetail.validFrom ? formatDateTime(displayDetail.validFrom) : EMPTY_PLACEHOLDER },
                  { key: '失效时间', value: displayDetail.validTo ? formatDateTime(displayDetail.validTo) : EMPTY_PLACEHOLDER },
                  { key: '剩余天数', value: renderDaysRemaining(displayDetail.daysRemaining) },
                  { key: '自动续期', value: displayDetail.autoRenew ? '是' : '否' },
                  { key: '创建时间', value: formatDateTime(displayDetail.createdAt) },
                  { key: '更新时间', value: formatDateTime(displayDetail.updatedAt) },
                  { key: '颁发者', value: displayDetail.issuer ?? EMPTY_PLACEHOLDER, span: 2 },
                  { key: '主题', value: displayDetail.subject ?? EMPTY_PLACEHOLDER, span: 2 },
                  { key: '序列号', value: displayDetail.serialNumber ?? EMPTY_PLACEHOLDER, span: 2 },
                  { key: '指纹', value: displayDetail.fingerprint ?? EMPTY_PLACEHOLDER, span: 2 },
                  { key: '证书路径', value: displayDetail.certPath ?? EMPTY_PLACEHOLDER, span: 2 },
                  { key: '私钥路径', value: displayDetail.keyPath ?? EMPTY_PLACEHOLDER, span: 2 },
                ]}
              />
            </div>
          )}
        </Spin>
      </SideSheet>
    </div>
  );
}
