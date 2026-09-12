import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Banner, Button, Empty, List, Select, Space, Spin, Tag, Toast, Typography } from '@douyinfe/semi-ui';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { MasterDetailLayout } from '@/components/MasterDetailLayout';
import { confirmDanger } from '@/utils/confirm';
import { usePermission } from '@/hooks/usePermission';
import {
  useRollbackWikiDoc, useWikiDocDetail, useWikiDocVersionDetail, useWikiDocVersions,
} from '@/hooks/queries/wiki-docs';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';

const { Text, Title } = Typography;

type DiffLine = { type: 'same' | 'add' | 'del'; text: string };

/** 轻量行级 diff（LCS）：足够展示文档两个版本的增删行 */
function diffLines(oldText: string, newText: string): DiffLine[] {
  const a = oldText.split('\n');
  const b = newText.split('\n');
  const m = a.length;
  const n = b.length;
  // 行数过大时退化为整段展示，避免 O(m*n) 卡顿
  if (m * n > 400_000) {
    return [
      ...a.map<DiffLine>((text) => ({ type: 'del', text })),
      ...b.map<DiffLine>((text) => ({ type: 'add', text })),
    ];
  }
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) {
      out.push({ type: 'same', text: a[i] });
      i++; j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: a[i] });
      i++;
    } else {
      out.push({ type: 'add', text: b[j] });
      j++;
    }
  }
  while (i < m) { out.push({ type: 'del', text: a[i] }); i++; }
  while (j < n) { out.push({ type: 'add', text: b[j] }); j++; }
  return out;
}

const DIFF_LINE_STYLE: Record<DiffLine['type'], React.CSSProperties> = {
  same: {},
  add: { backgroundColor: 'rgba(59, 179, 70, 0.14)' },
  del: { backgroundColor: 'rgba(249, 57, 32, 0.12)', textDecoration: 'line-through', opacity: 0.85 },
};

export default function WikiDocHistoryPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { hasPermission } = usePermission();
  const docId = searchParams.get('id') ? Number(searchParams.get('id')) : undefined;

  const [selectedVersion, setSelectedVersion] = useState<number>();
  const [baseVersion, setBaseVersion] = useState<number>();
  const [showDetailOnNarrow, setShowDetailOnNarrow] = useState(false);

  const docQuery = useWikiDocDetail(docId);
  const versionsQuery = useWikiDocVersions(docId, { page: 1, pageSize: 100 });
  const versions = useMemo(() => versionsQuery.data?.list ?? [], [versionsQuery.data]);

  const effectiveVersion = selectedVersion ?? versions[0]?.version;
  // 默认与上一个版本对比
  const effectiveBase = baseVersion ?? versions.find((v) => v.version < (effectiveVersion ?? 0))?.version;

  const targetQuery = useWikiDocVersionDetail(docId, effectiveVersion);
  const baseQuery = useWikiDocVersionDetail(docId, effectiveBase, effectiveBase !== undefined);

  const rollbackMutation = useRollbackWikiDoc();

  const diff = useMemo(() => {
    if (!targetQuery.data) return [];
    return diffLines(baseQuery.data?.content ?? '', targetQuery.data.content ?? '');
  }, [baseQuery.data, targetQuery.data]);

  if (!docId) {
    return (
      <div className="page-container">
        <Banner type="warning" description="缺少文档参数，请从文档中心进入" />
      </div>
    );
  }

  const canRollback = hasPermission('wiki:doc:edit');
  const addCount = diff.filter((l) => l.type === 'add').length;
  const delCount = diff.filter((l) => l.type === 'del').length;

  return (
    <div className="page-container page-container--stretch" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <Space spacing={8}>
        <Button icon={<ArrowLeft size={14} />} onClick={() => navigate(-1)}>返回</Button>
        <Title heading={5} style={{ margin: 0 }}>{docQuery.data?.title ?? '版本历史'}</Title>
        {docQuery.data ? <Text type="tertiary">当前 v{docQuery.data.currentVersion}</Text> : null}
      </Space>

      <MasterDetailLayout
        persistKey="wiki-doc-history"
        defaultSize={300}
        minSize={240}
        maxSize={420}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
        showDetail={showDetailOnNarrow}
        onBack={() => setShowDetailOnNarrow(false)}
        master={(
          <MasterDetailLayout.Body padding={8}>
            <List
              loading={versionsQuery.isFetching}
              dataSource={versions}
              emptyContent={<Empty description="暂无版本记录" />}
              renderItem={(item) => (
                <List.Item
                  style={{
                    cursor: 'pointer',
                    padding: '10px 12px',
                    borderRadius: 'var(--semi-border-radius-medium)',
                    background: item.version === effectiveVersion ? 'var(--semi-color-primary-light-default)' : undefined,
                  }}
                  onClick={() => { setSelectedVersion(item.version); setBaseVersion(undefined); setShowDetailOnNarrow(true); }}
                  main={(
                    <div style={{ minWidth: 0 }}>
                      <Space spacing={6}>
                        <Text strong>v{item.version}</Text>
                        {docQuery.data && item.version === docQuery.data.currentVersion ? (
                          <Tag size="small" color="green">当前</Tag>
                        ) : null}
                      </Space>
                      <div>
                        <Text type="tertiary" size="small">
                          {item.authorName ?? EMPTY_PLACEHOLDER} · {item.createdAt}
                        </Text>
                      </div>
                      {item.changeNote ? (
                        <Text type="tertiary" size="small" ellipsis={{ showTooltip: true }} style={{ width: '100%' }}>
                          {item.changeNote}
                        </Text>
                      ) : null}
                    </div>
                  )}
                />
              )}
            />
          </MasterDetailLayout.Body>
        )}
        detail={(
          <MasterDetailLayout.Body padding="0 0 0 16px">
            {!effectiveVersion ? (
              <Empty title="选择版本查看" description="从左侧选择一个版本" style={{ marginTop: 80 }} />
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 12 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <Space spacing={8}>
                    <Text>对比基准：</Text>
                    <Select
                      style={{ width: 160 }}
                      placeholder="选择基准版本"
                      showClear
                      value={effectiveBase}
                      onChange={(v) => setBaseVersion(v === undefined ? undefined : Number(v))}
                      optionList={versions
                        .filter((v) => v.version !== effectiveVersion)
                        .map((v) => ({ value: v.version, label: `v${v.version}` }))}
                    />
                    <Text type="tertiary">→ v{effectiveVersion}</Text>
                    <Tag size="small" color="green">+{addCount}</Tag>
                    <Tag size="small" color="red">-{delCount}</Tag>
                  </Space>
                  {canRollback && docQuery.data && effectiveVersion !== docQuery.data.currentVersion ? (
                    <Button
                      icon={<RotateCcw size={14} />}
                      loading={rollbackMutation.isPending}
                      onClick={() => confirmDanger({
                        title: `回滚到 v${effectiveVersion}？`,
                        content: '回滚会生成一个新版本并把文档打回草稿状态，需重新发布。',
                        onOk: () => rollbackMutation.mutate(
                          { params: { id: docId }, body: { version: effectiveVersion } },
                          { onSuccess: () => { Toast.success('回滚成功'); navigate(-1); } },
                        ),
                      })}
                    >
                      回滚到此版本
                    </Button>
                  ) : null}
                </div>

                <div style={{ flex: 1, minHeight: 0, overflowY: 'auto', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)' }}>
                  {targetQuery.isPending || (effectiveBase !== undefined && baseQuery.isPending) ? (
                    <div style={{ textAlign: 'center', padding: 40 }}><Spin size="large" /></div>
                  ) : (
                    <pre style={{
                      margin: 0,
                      padding: 16,
                      fontFamily: "'JetBrains Mono', 'Fira Code', Consolas, monospace",
                      fontSize: 13,
                      lineHeight: 1.7,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-all',
                    }}
                    >
                      {diff.map((line, idx) => (
                        <div key={`${line.type}-${idx}`} style={DIFF_LINE_STYLE[line.type]}>
                          {line.type === 'add' ? '+ ' : line.type === 'del' ? '- ' : '  '}
                          {line.text}
                        </div>
                      ))}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </MasterDetailLayout.Body>
        )}
      />
    </div>
  );
}
