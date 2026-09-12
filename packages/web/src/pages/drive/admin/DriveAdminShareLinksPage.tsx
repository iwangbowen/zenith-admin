import { useMemo, useState } from 'react';
import { compactParams } from '@/lib/query';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { useNavigate } from 'react-router-dom';
import { type DriveShareLink, type DriveShareLinkState } from '@zenith/shared/drive';
import { AppModal } from '@/components/AppModal';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { DateRangeFilter, FilterSelect, KeywordInput } from '@/components/search-filters';
import { useListSearch } from '@/hooks/useListSearch';
import { usePagination } from '@/hooks/usePagination';
import { usePermission } from '@/hooks/usePermission';
import { driveKeys, useAdminRevokeDriveShareLink, useDriveAdminShareLinks, useDriveShareAccessLogs } from '@/hooks/queries/drive';
import { confirmDanger } from '@/utils/confirm';
import { formatDateTimeRangeForApi } from '@/utils/date';
import { dateTimeColumn, renderEllipsis } from '@/utils/table-columns';
import { SHARE_STATE_LABELS } from '../drive-utils';
import {
  shareLinkAccessColumn, shareLinkCapabilitiesColumn, shareLinkCopyAction, shareLinkExpireColumn, shareLinkFileColumn, shareLinkStateColumn,
} from '../drive-share-link-columns';
import '../drive.css';

interface SearchParams {
  keyword: string;
  state: DriveShareLinkState | undefined;
  timeRange: [Date, Date] | null;
}

const STATE_OPTIONS = (Object.keys(SHARE_STATE_LABELS) as DriveShareLinkState[]).map((v) => ({ value: v, label: SHARE_STATE_LABELS[v] }));

/** 外链访问日志动作文案（服务端 logShareAccess 的 action 取值） */
const ACCESS_ACTION_LABELS: Record<string, string> = { access: '访问', list: '浏览目录', download: '下载', preview: '预览', password_fail: '密码错误', save: '转存' };

function AccessLogsModal({ link, onClose }: { readonly link: DriveShareLink | null; readonly onClose: () => void }) {
  const { page, pageSize, buildPagination } = usePagination(20);
  const query = useDriveShareAccessLogs(link?.id, { page, pageSize }, !!link);
  const columns: ColumnProps<{ id: number; action: string; clientIp: string | null; ok: boolean; createdAt: string }>[] = [
    { title: '动作', dataIndex: 'action', width: 110, render: (v: string) => ACCESS_ACTION_LABELS[v] ?? v },
    { title: 'IP', dataIndex: 'clientIp', minWidth: 140, render: renderEllipsis },
    { title: '结果', dataIndex: 'ok', width: 80, render: (v: boolean) => (v ? <Tag size="small" color="green">成功</Tag> : <Tag size="small" color="red">失败</Tag>) },
    dateTimeColumn('时间', 'createdAt'),
  ];
  return (
    <AppModal visible={!!link} title={`访问记录 · ${link?.nodeName ?? ''}`} width={720} footer={null} closeOnEsc onCancel={onClose}>
      <ConfigurableTable bordered size="small" rowKey="id" columns={columns} dataSource={query.data?.list ?? []} loading={query.isFetching}
        pagination={buildPagination(query.data?.total ?? 0)} />
    </AppModal>
  );
}

export default function DriveAdminShareLinksPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const { page, pageSize, buildPagination, bind, bindKeyword, submittedParams, handleSearch, handleReset } =
    useListSearch<SearchParams>({ defaults: { keyword: '', state: undefined, timeRange: null }, listKey: driveKeys.adminShareLinksPrefix });
  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    state: submittedParams.state,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  }), [submittedParams]);
  const query = useDriveAdminShareLinks({ page, pageSize, ...filterQuery });
  const revoke = useAdminRevokeDriveShareLink();
  const [logsOf, setLogsOf] = useState<DriveShareLink | null>(null);

  // 页面宽约 1190px：密码并入权限列、去掉创建时间列，状态紧贴操作列并固定右侧
  const columns: ColumnProps<DriveShareLink>[] = [
    shareLinkFileColumn((l) => navigate(`/drive?space=${l.spaceId}`)),
    { title: '分享人', dataIndex: 'createdByName', width: 110, render: renderEllipsis },
    shareLinkCapabilitiesColumn,
    shareLinkAccessColumn,
    { title: '备注', dataIndex: 'remark', width: 140, render: renderEllipsis },
    shareLinkExpireColumn,
    shareLinkStateColumn({ fixed: 'right' }),
    createOperationColumn<DriveShareLink>({ width: 210, desktopInlineKeys: ['logs', 'revoke'], actions: (l) => [
      { key: 'logs', label: '访问记录', onClick: () => setLogsOf(l) },
      shareLinkCopyAction(l),
      { key: 'revoke', label: '撤销', danger: true, hidden: l.state === 'revoked' || !hasPermission('drive:admin:link:revoke'),
        onClick: () => { confirmDanger({ title: '撤销这条外链？', content: `「${l.nodeName}」的外链将立即失效，访客无法再访问。`, okText: '撤销',
          onOk: () => revoke.mutateAsync({ params: { id: l.id }, nodeId: l.nodeId }).then(() => Toast.success('已撤销')) }); } },
    ] }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={<KeywordInput {...bindKeyword('keyword')} placeholder="搜索文件名 / 分享人 / 备注" width={240} />}
        filters={(
          <>
            <FilterSelect<DriveShareLinkState> {...bind('state')} placeholder="全部状态" items={STATE_OPTIONS} />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="外链筛选"
      />
      <ConfigurableTable<DriveShareLink> columns={columns}
        {...listTableProps(query, { pagination: buildPagination })}
      />
      <AccessLogsModal link={logsOf} onClose={() => setLogsOf(null)} />
      {query.data?.total === 0 && <Typography.Text type="tertiary">暂无外链记录。</Typography.Text>}
    </div>
  );
}
