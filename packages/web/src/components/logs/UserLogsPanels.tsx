/**
 * 「某个人」的登录记录 / 操作记录面板：个人中心与用户管理（记录抽屉）共用同一份筛选条、分页与表格接线，
 * 差异只在取数来源：
 *
 * - `scope = { kind: 'self' }`：走 `authContract.myLoginLogs` / `myOperationLogs`，服务端按当前登录用户过滤；
 * - `scope = { kind: 'user', userId }`：走管理侧 `loginLogContract.list` / `operationLogContract.list` 的 `userId` 精确筛选
 *   （管理侧的 `username` 是模糊关键字，不能用来定位到某个人）。
 *
 * 两个 scope 的分页 / 筛选状态是同一份（同一行控件服务两条链路），因此两条查询都无条件调用，
 * 只把当前生效的那条 `enabled`；未激活的一条不会发请求（抽屉里切 tab 才拉取）。
 *
 * 表格本身仍是既有的 `LoginLogsTable` / `OperationLogsTable`，这里只负责取数接线与筛选条。
 */
import { useMemo } from 'react';
import { DateRangeFilter, FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { ListSearchToolbar } from '@/components/list-page';
import { LoginLogsTable } from '@/components/logs/LoginLogsTable';
import { OperationLogsTable } from '@/components/logs/OperationLogsTable';
import { useListSearch } from '@/hooks/useListSearch';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { profileKeys, useProfileLoginLogs, useProfileOperationLogs } from '@/hooks/queries/profile';
import { loginLogKeys, useLoginLogList } from '@/hooks/queries/login-logs';
import { operationLogKeys, useOperationLogList } from '@/hooks/queries/operation-logs';
import { enumValueOf } from '@zenith/shared/core';
import { formatDateTimeRangeForApi } from '@/utils/date';
import {
  LOGIN_EVENT_TYPE_OPTIONS,
  LOGIN_EVENT_TYPES,
  LOGIN_STATUS_OPTIONS,
  LOGIN_STATUSES,
} from '@zenith/shared/identity';
import { OPERATION_LOG_RESULT_OPTIONS, OPERATION_LOG_RESULTS } from '@zenith/shared/platform';
import type { QueryKey } from '@tanstack/react-query';

/** 记录归属：本人（个人中心）或指定用户（用户管理） */
export type UserLogsScope = { readonly kind: 'self' } | { readonly kind: 'user'; readonly userId: number };

export interface UserLogsPanelProps {
  readonly scope: UserLogsScope;
  /** 面板未激活时不发请求（抽屉 / 个人中心按当前 tab 传） */
  readonly enabled?: boolean;
  /** 列设置持久化 key：两个入口各自记住列宽 */
  readonly columnSettingsKey: string;
}

/** 操作记录筛选选项：与管理侧操作日志页保持一致（操作人除外，面板本身已限定到某个人） */
const OPERATION_METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((value) => ({ value, label: value }));
/** 操作来源筛选：与契约 `impersonated` 的 queryBool 文案一致 */
const OPERATION_IMPERSONATED_OPTIONS = [
  { value: 'true', label: '仅模拟操作' },
  { value: 'false', label: '仅本人操作' },
];

interface LoginLogSearchParams {
  eventType?: string;
  status?: string;
  timeRange: [Date, Date] | null;
}

interface OperationLogSearchParams {
  module: string;
  description: string;
  method?: string;
  path: string;
  ip: string;
  status?: string;
  content: string;
  /** 'true' 仅模拟登录期间的操作 / 'false' 仅本人操作；未选为 undefined */
  impersonated?: string;
  timeRange: [Date, Date] | null;
}

/**
 * 列表查询的筛选键：指定用户时按 userId 分片，让「记住列表筛选条件」不跨用户串味；
 * 同时把整个管理侧列表键放进 extraKeys——「查询」要失效的正是该用户那份列表（前缀匹配同域全部列表查询）。
 */
function useScopeListKey(selfKey: QueryKey, adminListsKey: QueryKey, scope: UserLogsScope) {
  const userId = scope.kind === 'user' ? scope.userId : undefined;
  return useMemo(
    () => ({
      listKey: userId === undefined ? selfKey : [...adminListsKey, 'user', userId],
      extraKeys: userId === undefined ? undefined : [adminListsKey],
    }),
    [selfKey, adminListsKey, userId],
  );
}

export function UserLoginLogsPanel({ scope, enabled = true, columnSettingsKey }: UserLogsPanelProps) {
  const isSelf = scope.kind === 'self';
  const { listKey, extraKeys } = useScopeListKey(profileKeys.loginLogs, loginLogKeys.lists, scope);

  const {
    page, pageSize, buildPagination,
    bind, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<LoginLogSearchParams>({
    defaults: { eventType: undefined, status: undefined, timeRange: null },
    listKey,
    extraKeys,
  });

  const filterQuery = useFilterQuery({
    eventType: enumValueOf(LOGIN_EVENT_TYPES, submittedParams.eventType),
    status: enumValueOf(LOGIN_STATUSES, submittedParams.status),
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });

  const params = { page, pageSize, ...filterQuery };
  // 两条链路都调用、只启用生效的一条（React 不允许条件调用 hook）
  const selfQuery = useProfileLoginLogs(params, enabled && isSelf);
  const scopedQuery = useLoginLogList(
    { ...params, userId: scope.kind === 'user' ? scope.userId : undefined },
    enabled && !isSelf,
  );
  const query = isSelf ? selfQuery : scopedQuery;
  const list = query.data?.list ?? [];
  const total = query.data?.total ?? 0;

  return (
    <>
      <ListSearchToolbar
        filters={(
          <>
            <FilterSelect
              placeholder="全部事件"
              items={LOGIN_EVENT_TYPE_OPTIONS}
              {...bind('eventType')}
            />
            <StatusSelect
              items={LOGIN_STATUS_OPTIONS}
              {...bind('status')}
            />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="登录记录筛选"
      />
      <LoginLogsTable
        loading={query.isFetching}
        dataSource={list}
        onRefresh={() => void query.refetch()}
        columnSettingsKey={columnSettingsKey}
        pagination={buildPagination(total)}
      />
    </>
  );
}

export function UserOperationLogsPanel({ scope, enabled = true, columnSettingsKey }: UserLogsPanelProps) {
  const isSelf = scope.kind === 'self';
  const { listKey, extraKeys } = useScopeListKey(profileKeys.operationLogs, operationLogKeys.lists, scope);

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<OperationLogSearchParams>({
    defaults: {
      module: '', description: '', method: undefined, path: '', ip: '',
      status: undefined, content: '', impersonated: undefined, timeRange: null,
    },
    listKey,
    extraKeys,
  });

  const filterQuery = useFilterQuery({
    module: submittedParams.module,
    description: submittedParams.description,
    method: submittedParams.method,
    path: submittedParams.path,
    ip: submittedParams.ip,
    status: enumValueOf(OPERATION_LOG_RESULTS, submittedParams.status),
    content: submittedParams.content,
    impersonated: submittedParams.impersonated === 'true' ? true : submittedParams.impersonated === 'false' ? false : undefined,
    ...formatDateTimeRangeForApi(submittedParams.timeRange),
  });

  const params = { page, pageSize, ...filterQuery };
  const selfQuery = useProfileOperationLogs(params, enabled && isSelf);
  const scopedQuery = useOperationLogList(
    { ...params, userId: scope.kind === 'user' ? scope.userId : undefined },
    enabled && !isSelf,
  );
  const query = isSelf ? selfQuery : scopedQuery;
  const list = query.data?.list ?? [];
  const total = query.data?.total ?? 0;

  return (
    <>
      <ListSearchToolbar
        filters={(
          <>
            <KeywordInput placeholder="请输入功能模块" {...bindKeyword('module')} width={160} />
            <KeywordInput placeholder="请输入操作描述" {...bindKeyword('description')} width={160} />
            <FilterSelect
              placeholder="全部请求方法"
              items={OPERATION_METHOD_OPTIONS}
              {...bind('method')}
              width={140}
            />
            <KeywordInput placeholder="请输入请求路径" {...bindKeyword('path')} width={180} />
            <KeywordInput placeholder="请输入 IP 地址" {...bindKeyword('ip')} width={160} />
            <KeywordInput placeholder="请求/变更内容包含…" {...bindKeyword('content')} width={180} />
            <StatusSelect
              items={OPERATION_LOG_RESULT_OPTIONS}
              {...bind('status')}
            />
            <FilterSelect
              placeholder="全部操作来源"
              items={OPERATION_IMPERSONATED_OPTIONS}
              {...bind('impersonated')}
              width={140}
            />
            <DateRangeFilter {...bind('timeRange')} />
          </>
        )}
        onSearch={handleSearch}
        onReset={handleReset}
        filterTitle="操作记录筛选"
      />
      <OperationLogsTable
        loading={query.isFetching}
        dataSource={list}
        onRefresh={() => void query.refetch()}
        columnSettingsKey={columnSettingsKey}
        pagination={buildPagination(total)}
      />
    </>
  );
}
