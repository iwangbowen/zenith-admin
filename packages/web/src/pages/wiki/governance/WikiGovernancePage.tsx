import { useState } from 'react';
import { Button, Checkbox, DatePicker, InputNumber, Select, Switch, Tabs, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Archive, ArchiveRestore, BellRing, UserRoundCog } from 'lucide-react';
import type { WikiDocStatus, WikiGovernanceDoc, WikiGovernanceKind, WikiNoResultKeyword } from '@zenith/shared/wiki';
import { WIKI_DOC_STATUS_LABELS, WIKI_GOVERNANCE_KIND_LABELS, WIKI_GOVERNANCE_KINDS } from '@zenith/shared/wiki';
import ConfigurableTable from '@/components/ConfigurableTable';
import AppModal from '@/components/AppModal';
import { listTableProps, useRowSelection } from '@/components/list-page';
import { SearchToolbar } from '@/components/SearchToolbar';
import { dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { usePermission } from '@/hooks/usePermission';
import { usePagination } from '@/hooks/usePagination';
import { formatDateTimeForApi } from '@/utils/date';
import { toUserOptions, useAllUsers } from '@/hooks/queries/users';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import {
  useArchiveGovernanceDocs, useRemindGovernanceOwners, useSetGovernanceOwner,
  useSetGovernanceReview, useWikiGovernanceDocs, useWikiNoResultKeywords,
} from '@/hooks/queries/wiki-governance';
import { WIKI_DOC_STATUS_TAG_COLOR } from '../wiki-tag-colors';

const { Text } = Typography;

/** 单个治理清单面板：表格 + 批量操作 */
function GovernancePane({ kind }: { kind: WikiGovernanceKind }) {
  const { hasPermission } = usePermission();
  const { page, pageSize, buildPagination } = usePagination();
  const listQuery = useWikiGovernanceDocs(kind, { page, pageSize });

  const { selectedRowKeys, clear: clearSelection, rowSelection } = useRowSelection();
  const [ownerModalVisible, setOwnerModalVisible] = useState(false);
  const [ownerId, setOwnerId] = useState<number>();
  const [reviewModalVisible, setReviewModalVisible] = useState(false);
  const [reviewEnabled, setReviewEnabled] = useState(true);
  const [reviewCycleDays, setReviewCycleDays] = useState<number>(90);
  const [expireAt, setExpireAt] = useState<Date | null>(null);
  const [clearExpireAt, setClearExpireAt] = useState(false);

  const remindMutation = useRemindGovernanceOwners();
  const archiveMutation = useArchiveGovernanceDocs();
  const ownerMutation = useSetGovernanceOwner();
  const reviewMutation = useSetGovernanceReview();
  const usersQuery = useAllUsers({ enabled: ownerModalVisible });

  function afterBatch(message: string) {
    Toast.success(message);
    clearSelection();
  }

  function openOwnerModal() {
    setOwnerId(undefined);
    setOwnerModalVisible(true);
  }

  function openReviewModal() {
    setReviewEnabled(true);
    setReviewCycleDays(90);
    setExpireAt(null);
    setClearExpireAt(false);
    setReviewModalVisible(true);
  }

  const columns: ColumnProps<WikiGovernanceDoc>[] = [
    { title: '标题', dataIndex: 'title', width: 240, render: renderEllipsis },
    { title: '所属空间', dataIndex: 'spaceName', width: 130, render: renderEllipsis },
    {
      title: '状态', dataIndex: 'status', width: 90,
      render: (v: WikiDocStatus) => <Tag color={WIKI_DOC_STATUS_TAG_COLOR[v]}>{WIKI_DOC_STATUS_LABELS[v]}</Tag>,
    },
    { title: '负责人', dataIndex: 'ownerName', width: 110, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    dateTimeColumn('有效期', 'expireAt', { empty: '不限' }),
    dateTimeColumn('下次复审', 'nextReviewAt', { empty: '不复审' }),
    dateTimeColumn('最近更新', 'updatedAt'),
  ];

  const hasSelection = selectedRowKeys.length > 0;

  return (
    <>
      <SearchToolbar
        primary={(
          <>
            {hasSelection && hasPermission('wiki:governance:remind') ? (
              <Button
                icon={<BellRing size={14} />}
                loading={remindMutation.isPending}
                onClick={() => remindMutation.mutate({ body: { ids: selectedRowKeys } }, { onSuccess: () => afterBatch('已发送提醒') })}
              >
                提醒负责人 ({selectedRowKeys.length})
              </Button>
            ) : null}
            {hasSelection && hasPermission('wiki:governance:edit') ? (
              <>
                <Button icon={<UserRoundCog size={14} />} onClick={openOwnerModal}>
                  指定负责人
                </Button>
                <Button onClick={openReviewModal}>设置复审/有效期</Button>
              </>
            ) : null}
            {hasSelection && hasPermission('wiki:governance:archive') ? (
              kind === 'archived' ? (
                <Button
                  icon={<ArchiveRestore size={14} />}
                  loading={archiveMutation.isPending}
                  onClick={() => archiveMutation.mutate(
                    { body: { ids: selectedRowKeys, archived: false } },
                    { onSuccess: () => afterBatch('已取消归档') },
                  )}
                >
                  取消归档 ({selectedRowKeys.length})
                </Button>
              ) : (
                <Button
                  icon={<Archive size={14} />}
                  loading={archiveMutation.isPending}
                  onClick={() => archiveMutation.mutate(
                    { body: { ids: selectedRowKeys, archived: true } },
                    { onSuccess: () => afterBatch('已归档') },
                  )}
                >
                  归档 ({selectedRowKeys.length})
                </Button>
              )
            ) : null}
            {!hasSelection ? <Text type="tertiary">勾选文档后可批量指定负责人、设置复审/有效期或归档</Text> : null}
          </>
        )}
      />

      <ConfigurableTable<WikiGovernanceDoc>
        columns={columns}
        empty={kind === 'all' ? '当前没有可治理的文档' : '该清单没有需要处理的文档'}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          rowSelection,
        })}
      />

      {/* 指定负责人 */}
      <AppModal
        title={`为 ${selectedRowKeys.length} 篇文档指定负责人`}
        visible={ownerModalVisible}
        closeOnEsc
        width={480}
        onCancel={() => setOwnerModalVisible(false)}
        onOk={() => {
          if (!ownerId) {
            Toast.warning('请选择负责人');
            return;
          }
          ownerMutation.mutate(
            { body: { ids: selectedRowKeys, ownerId } },
            { onSuccess: () => { afterBatch('已指定负责人'); setOwnerModalVisible(false); } },
          );
        }}
        okButtonProps={{ loading: ownerMutation.isPending }}
      >
        <Select
          style={{ width: '100%' }}
          placeholder="选择负责人"
          filter
          value={ownerId}
          onChange={(v) => setOwnerId(v as number)}
          optionList={toUserOptions(usersQuery.data ?? [])}
        />
      </AppModal>

      {/* 设置复审 */}
      <AppModal
        title={`为 ${selectedRowKeys.length} 篇文档设置复审与有效期`}
        visible={reviewModalVisible}
        closeOnEsc
        width={480}
        onCancel={() => setReviewModalVisible(false)}
        onOk={() => {
          reviewMutation.mutate(
            {
              body: {
                ids: selectedRowKeys,
                reviewCycleDays: reviewEnabled ? reviewCycleDays : null,
                expireAt: clearExpireAt ? null : expireAt ? formatDateTimeForApi(expireAt) : undefined,
              },
            },
            { onSuccess: () => { afterBatch('治理设置已更新'); setReviewModalVisible(false); } },
          );
        }}
        okButtonProps={{ loading: reviewMutation.isPending }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 16 }}>
            <div>
              <Text>定期复审</Text>
              <div><Text type="tertiary" size="small">关闭后清除所选文档的复审周期与下次复审时间</Text></div>
            </div>
            <Switch checked={reviewEnabled} onChange={setReviewEnabled} />
          </div>
          <div>
            <Text>复审周期（天）</Text>
            <InputNumber
              style={{ width: '100%', marginTop: 4 }}
              min={1}
              max={3650}
              disabled={!reviewEnabled}
              value={reviewCycleDays}
              onChange={(v) => setReviewCycleDays(Number(v) || 90)}
            />
            <Text type="tertiary" size="small">
              {reviewEnabled ? '下次复审时间 = 当前时间 + 周期' : '保存后不再安排定期复审'}
            </Text>
          </div>
          <div>
            <Text>有效期（选填）</Text>
            <DatePicker
              type="dateTime"
              style={{ width: '100%', marginTop: 4 }}
              value={expireAt ?? undefined}
              disabled={clearExpireAt}
              onChange={(v) => setExpireAt(v instanceof Date ? v : null)}
              placeholder="留空则保持已有有效期不变"
            />
            <div style={{ marginTop: 8 }}>
              <Checkbox
                checked={clearExpireAt}
                onChange={(e) => {
                  const checked = !!e.target.checked;
                  setClearExpireAt(checked);
                  if (checked) setExpireAt(null);
                }}
              >
                清除已有有效期
              </Checkbox>
            </div>
          </div>
        </div>
      </AppModal>
    </>
  );
}

/** 无结果搜索词面板：知识缺口 */
function NoResultPane() {
  const listQuery = useWikiNoResultKeywords();

  const columns: ColumnProps<WikiNoResultKeyword>[] = [
    { title: '搜索关键词', dataIndex: 'keyword', width: 260, render: renderEllipsis },
    { title: '近 30 天搜索次数', dataIndex: 'searchCount', width: 150, align: 'right' },
    dateTimeColumn('最近搜索时间', 'lastSearchedAt'),
  ];

  return (
    <ConfigurableTable<WikiNoResultKeyword>
      columns={columns}
      empty="近 30 天没有搜索无结果的关键词"
      {...listTableProps(listQuery, { rowKey: 'keyword' })}
    />
  );
}

export default function WikiGovernancePage() {
  const [activeTab, setActiveTab] = useUrlTabState([...WIKI_GOVERNANCE_KINDS, 'no-result'] as const, WIKI_GOVERNANCE_KINDS[0]);
  return (
    <div className="page-container page-tabs-page">
      <Tabs type="line" collapsible="auto" activeKey={activeTab} onChange={(k) => setActiveTab(k as typeof activeTab)}>
        {WIKI_GOVERNANCE_KINDS.map((kind) => (
          <Tabs.TabPane tab={WIKI_GOVERNANCE_KIND_LABELS[kind]} itemKey={kind} key={kind}>
            <GovernancePane kind={kind} />
          </Tabs.TabPane>
        ))}
        <Tabs.TabPane tab="无结果搜索词" itemKey="no-result">
          <NoResultPane />
        </Tabs.TabPane>
      </Tabs>
    </div>
  );
}
