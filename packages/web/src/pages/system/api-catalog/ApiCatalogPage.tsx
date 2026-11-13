import { useCallback, useMemo, useState } from 'react';
import { Banner, Radio, RadioGroup, Select, Tag, Typography } from '@douyinfe/semi-ui';
import { CircleCheck, CircleSlash, Fingerprint, Globe, KeyRound, Layers, Lock, ShieldCheck } from 'lucide-react';
import { judgeOperation, type OperationVerdict, type PermissionSubject } from '@zenith/shared/permission-catalog-core';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import UserSelect from '@/components/UserSelect';
import { FilterSelect } from '@/components/search-filters';
import { config } from '@/config';
import { apiCatalogKeys, useApiCatalog, useRolePermissionSets, useUserPermissionSet } from '@/hooks/queries/permission-matrix';
import { useListSearch } from '@/hooks/useListSearch';
import { usePermission } from '@/hooks/usePermission';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { ApiCatalogSearchBar, ApiCatalogTable, type PermissionLabels } from './ApiCatalogTable';
import ApiOperationSheet from './ApiOperationSheet';
import {
  EMPTY_FILTERS,
  VERDICT_LABELS,
  hasActiveFilter,
  matchesCatalogFilters,
  rowsByPermission,
  summarizeCatalog,
  toCatalogRows,
  type CatalogFilters,
  type CatalogRow,
} from './catalog-model';

type SubjectKind = 'role' | 'user';

const LOADING_VALUE = '—';
const NO_LABELS: PermissionLabels = {};

/** 统计卡即筛选：点「需权限码」等于把认证方式 / 访问要求提交为对应值，再点一次取消 */
type StatKey = 'permission' | 'authenticated' | 'platform' | 'public' | 'otherCredential';
type StatFilter = Pick<CatalogFilters, 'security' | 'accessKind' | 'otherCredential'>;

const STAT_FILTERS: Record<StatKey, StatFilter> = {
  permission: { security: 'bearer', accessKind: 'permission', otherCredential: undefined },
  authenticated: { security: 'bearer', accessKind: 'authenticated', otherCredential: undefined },
  platform: { security: 'bearer', accessKind: 'platform', otherCredential: undefined },
  public: { security: 'none', accessKind: undefined, otherCredential: undefined },
  otherCredential: { security: undefined, accessKind: undefined, otherCredential: true },
};
const CLEARED_STAT_FILTER: StatFilter = { security: undefined, accessKind: undefined, otherCredential: undefined };

function activeStatOf(filters: CatalogFilters): StatKey | null {
  return (Object.keys(STAT_FILTERS) as StatKey[]).find((key) => {
    const spec = STAT_FILTERS[key];
    return filters.security === spec.security && filters.accessKind === spec.accessKind && filters.otherCredential === spec.otherCredential;
  }) ?? null;
}

const VERDICT_OPTIONS = (Object.keys(VERDICT_LABELS) as OperationVerdict[]).map((value) => ({ value, label: VERDICT_LABELS[value] }));

/**
 * 接口目录：全部契约操作的名称 / 地址 / 方法 / 认证 / 权限码 / 审计 / 功能门控，
 * 由服务端从契约派生下发（与门禁同源）。
 * 选择「查看主体」（角色 / 用户）后叠加每个接口的判定：默认只列它可调用的接口，
 * 统计卡切到「无权限」「仅平台超管」或全部；服务端只提供主体持有的权限码，判定在浏览器内完成。
 */
export default function ApiCatalogPage() {
  const { hasPermission } = usePermission();
  const [subjectKind, setSubjectKind] = useState<SubjectKind>('role');
  const [roleId, setRoleId] = useState<number | null>(null);
  const [userId, setUserId] = useState<number | null>(null);
  const [selected, setSelected] = useState<CatalogRow | null>(null);
  // 词典就绪进过滤 memo 的依赖：已提交的关键字补上拼音命中
  const pinyinReady = usePinyinReady();

  const catalogQuery = useApiCatalog();
  const rows = useMemo(() => toCatalogRows(catalogQuery.data), [catalogQuery.data]);
  const permissionLabels = catalogQuery.data?.permissionLabels ?? NO_LABELS;
  const byPermission = useMemo(() => rowsByPermission(rows), [rows]);
  const stats = useMemo(() => summarizeCatalog(rows), [rows]);
  const loading = catalogQuery.isFetching;
  const { refetch: refetchCatalog } = catalogQuery;
  const refreshCatalog = useCallback(() => { void refetchCatalog(); }, [refetchCatalog]);

  const rolesQuery = useRolePermissionSets();
  const userQuery = useUserPermissionSet(subjectKind === 'user' ? userId : null);
  const roles = rolesQuery.data ?? [];
  const role = subjectKind === 'role' ? roles.find((r) => r.id === roleId) ?? null : null;
  const user = subjectKind === 'user' ? userQuery.data ?? null : null;
  const subjectSummary = role ?? user;
  const subject = useMemo<PermissionSubject | null>(() => {
    if (!subjectSummary) return null;
    return { permissions: new Set(subjectSummary.permissions), superAdmin: subjectSummary.superAdmin };
  }, [subjectSummary]);

  // 主体切换回到第 1 页，筛选条件保留；目录随发布静态可知（staleTime: Infinity），查询 / 重置只重新过滤、不重新下载
  const search = useListSearch<CatalogFilters>({
    defaults: EMPTY_FILTERS,
    listKey: apiCatalogKeys.catalog,
    refetchOnSearch: false,
    resetKey: [subjectKind, roleId, userId],
  });
  const { submittedParams, applySearch, page, pageSize, buildPagination } = search;

  // 判定只对后台登录令牌操作有意义；公开 / 会员 / 设备 / 网关接口不经权限码门禁 → null（表内显示「不适用」）
  const verdicts = useMemo(() => {
    if (!subject) return null;
    const map = new Map<string, OperationVerdict | null>();
    for (const row of rows) {
      map.set(row.key, row.security === 'bearer' && row.accessKind !== null
        ? judgeOperation({ accessKind: row.accessKind, permissions: row.permissions, platformOnly: row.platformOnly }, subject, { multiTenant: config.multiTenantMode })
        : null);
    }
    return map;
  }, [rows, subject]);
  const verdictOf = useMemo(() => (verdicts ? (row: CatalogRow) => verdicts.get(row.key) ?? null : undefined), [verdicts]);
  const verdictCounts = useMemo(() => {
    const result: Record<OperationVerdict, number> = { allowed: 0, denied: 0, 'platform-only': 0 };
    if (verdicts) for (const verdict of verdicts.values()) if (verdict) result[verdict] += 1;
    return result;
  }, [verdicts]);

  const verdictFilter = verdictOf ? submittedParams.verdict : undefined;
  // 关键字过滤带拼音匹配，2,400 行一遍 ~60–90 ms：只在条件 / 数据 / 词典就绪时重算，
  // 输入草稿、翻页、开关详情抽屉这类无关渲染不再触发；pinyinReady 仅作为重算信号
  const filtered = useMemo(() => rows.filter((row) =>
    matchesCatalogFilters(row, submittedParams) && (verdictFilter === undefined || verdictOf?.(row) === verdictFilter)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, submittedParams, verdictFilter, verdictOf, pinyinReady]);
  const pageRows = useMemo(() => filtered.slice((page - 1) * pageSize, page * pageSize), [filtered, page, pageSize]);
  // 表格已 memo：分页配置按 total / 页码稳定引用，避免每次渲染新对象把它拖下水
  const pagination = useMemo(() => buildPagination(filtered.length), [buildPagination, filtered.length]);

  const activeStat = activeStatOf(submittedParams);
  const toggleStat = (key: StatKey) => {
    applySearch({ ...submittedParams, ...(activeStat === key ? CLEARED_STAT_FILTER : STAT_FILTERS[key]) });
  };
  const toggleVerdict = (verdict: OperationVerdict) => {
    applySearch({ ...submittedParams, verdict: submittedParams.verdict === verdict ? undefined : verdict });
  };
  // 选中主体即刻提交「只看可调用」；清空主体回到普通目录
  const selectSubject = (next: { roleId?: number | null; userId?: number | null }) => {
    if (next.roleId !== undefined) setRoleId(next.roleId);
    if (next.userId !== undefined) setUserId(next.userId);
    const picked = (next.roleId ?? next.userId) != null;
    applySearch({ ...submittedParams, verdict: picked ? 'allowed' : undefined });
  };
  const switchSubjectKind = (kind: SubjectKind) => {
    setSubjectKind(kind);
    applySearch({ ...submittedParams, verdict: undefined });
  };
  const canPickUser = hasPermission('system:user:list');

  const summaryText = (() => {
    if (loading) return '正在加载接口目录…';
    if (subject) return `${verdictFilter ? VERDICT_LABELS[verdictFilter] : '全部'} ${filtered.length} / ${rows.length} 个接口`;
    if (hasActiveFilter(submittedParams)) return `匹配 ${filtered.length} / ${rows.length} 个接口`;
    return `共 ${rows.length} 个接口，由契约声明派生`;
  })();
  const stat = (value: number) => (loading ? LOADING_VALUE : value);

  return (
    <div className="page-container">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 12 }}>
        <Typography.Text strong>查看主体</Typography.Text>
        <RadioGroup type="button" value={subjectKind} onChange={(e) => switchSubjectKind(e.target.value as SubjectKind)}>
          <Radio value="role">按角色</Radio>
          <Radio value="user">按用户</Radio>
        </RadioGroup>
        {subjectKind === 'role' ? (
          <Select
            placeholder="选择角色，查看它能调用哪些接口"
            filter
            showClear
            loading={rolesQuery.isPending}
            value={roleId ?? undefined}
            onChange={(v) => selectSubject({ roleId: typeof v === 'number' ? v : null })}
            optionList={roles.map((r) => ({ value: r.id, label: `${r.name}（${r.code}）` }))}
            style={{ width: 280 }}
          />
        ) : (
          <UserSelect
            placeholder="选择用户，查看他能调用哪些接口"
            showClear
            disabled={!canPickUser}
            value={userId ?? undefined}
            onChange={(v) => selectSubject({ userId: typeof v === 'number' ? v : null })}
            style={{ width: 280 }}
          />
        )}
        {subjectSummary && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {subjectSummary.superAdmin
              ? <Tag size="small" color="violet">平台超管 · 全部放行</Tag>
              : <Typography.Text type="tertiary">持有 {subjectSummary.permissions.length} 个权限码</Typography.Text>}
            {user?.roles.map((r) => <Tag key={r.id} size="small">{r.name}</Tag>)}
          </span>
        )}
      </div>
      {subjectKind === 'user' && !canPickUser && (
        <Banner type="info" closeIcon={null} description="按用户查看需要「用户管理 → 查询」权限以检索用户。" style={{ marginBottom: 12 }} />
      )}

      {verdictOf ? (
        <StatGrid minItemWidth={150} gap={12} style={{ marginBottom: 12 }}>
          <StatCard title="全部接口" value={stat(stats.total)} icon={<Layers size={16} />} sub={`其中 ${stats.public + stats.otherCredential} 个不经权限码门禁`} />
          <StatCard title="可调用" value={stat(verdictCounts.allowed)} icon={<CircleCheck size={16} />} accent="var(--semi-color-success)" onClick={() => toggleVerdict('allowed')} active={verdictFilter === 'allowed'} />
          <StatCard title="无权限" value={stat(verdictCounts.denied)} icon={<CircleSlash size={16} />} accent="var(--semi-color-danger)" onClick={() => toggleVerdict('denied')} active={verdictFilter === 'denied'} />
          <StatCard title="仅平台超管" value={stat(verdictCounts['platform-only'])} icon={<ShieldCheck size={16} />} accent="rgb(var(--semi-violet-5))" onClick={() => toggleVerdict('platform-only')} active={verdictFilter === 'platform-only'} />
        </StatGrid>
      ) : (
        <StatGrid minItemWidth={150} gap={12} style={{ marginBottom: 12 }}>
          <StatCard title="全部接口" value={stat(stats.total)} icon={<Layers size={16} />} />
          <StatCard title="需权限码" value={stat(stats.permission)} icon={<KeyRound size={16} />} accent="var(--semi-color-primary)" onClick={() => toggleStat('permission')} active={activeStat === 'permission'} />
          <StatCard title="登录即可" value={stat(stats.authenticated)} icon={<Lock size={16} />} onClick={() => toggleStat('authenticated')} active={activeStat === 'authenticated'} />
          <StatCard title="仅平台超管" value={stat(stats.platform)} icon={<ShieldCheck size={16} />} accent="rgb(var(--semi-violet-5))" onClick={() => toggleStat('platform')} active={activeStat === 'platform'} />
          <StatCard title="公开接口" value={stat(stats.public)} icon={<Globe size={16} />} accent="var(--semi-color-warning)" onClick={() => toggleStat('public')} active={activeStat === 'public'} />
          <StatCard title="其他凭证" value={stat(stats.otherCredential)} sub="会员令牌 / 设备签名 / 开放网关" icon={<Fingerprint size={16} />} onClick={() => toggleStat('otherCredential')} active={activeStat === 'otherCredential'} />
        </StatGrid>
      )}

      <ApiCatalogSearchBar
        rows={rows}
        permissionLabels={permissionLabels}
        search={search}
        extraFilters={verdictOf ? <FilterSelect placeholder="全部判定" items={VERDICT_OPTIONS} {...search.bind('verdict')} width={120} /> : undefined}
        extra={<Typography.Text type="tertiary" size="small">{summaryText}</Typography.Text>}
      />

      <ApiCatalogTable
        rows={pageRows}
        permissionLabels={permissionLabels}
        pagination={pagination}
        loading={loading}
        onRefresh={refreshCatalog}
        refreshLoading={catalogQuery.isFetching}
        onOpen={setSelected}
        verdictOf={verdictOf}
      />
      <ApiOperationSheet row={selected} permissionLabels={permissionLabels} byPermission={byPermission} onClose={() => setSelected(null)} onOpen={setSelected} />
    </div>
  );
}
