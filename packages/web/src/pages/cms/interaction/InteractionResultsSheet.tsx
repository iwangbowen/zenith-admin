import { useMemo, useState } from 'react';
import {
  Button,
  Empty,
  Input,
  Select,
  SideSheet,
  Spin,
  TabPane,
  Tabs,
  Tag,
  Typography,
} from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { CMS_INTERACTION_QUESTION_TYPE_LABELS } from '@zenith/shared/cms';
import type { CmsInteraction, CmsInteractionQuestionStats } from '@zenith/shared/cms';
import {
  useCmsInteractionCrossStats,
  useCmsInteractionStats,
  useCmsInteractionTexts,
  useCmsInteractionTrend,
} from '@/hooks/queries/cms';
import './interaction-editor.css';
import { DataBar } from '@/components/data-viz/DataBar';
import { emptyIllustration } from '@/components/EmptyIllustration';
import { dateColumn } from '@/utils/table-columns';

const TEXT_PAGE_SIZE = 10;
const TREND_OPTIONS = [7, 14, 30, 90].map((days) => ({ value: days, label: `近 ${days} 天` }));
/** 有独立文本答案的题型；单选/多选开了「其他」时也算 */
const TEXTUAL_TYPES = ['text', 'date', 'number'];

function OptionBars({ options }: Readonly<{ options: CmsInteractionQuestionStats['options'] }>) {
  if (options.length === 0) return <Typography.Text type="tertiary">暂无数据</Typography.Text>;
  return (
    <div className="interaction-stats__bars">
      {options.map((option) => (
        <div key={option.id}>
          <div className="interaction-stats__bar-head">
            <span>{option.label}</span>
            <span>{option.count} · {option.percent}%</span>
          </div>
          <DataBar value={option.percent} max={100} />
        </div>
      ))}
    </div>
  );
}

function MatrixTable({ question }: Readonly<{ question: CmsInteractionQuestionStats }>) {
  const columns = question.matrixRows[0]?.options ?? [];
  if (question.matrixRows.length === 0) return <Typography.Text type="tertiary">暂无数据</Typography.Text>;
  return (
    <div className="interaction-stats__matrix-wrap">
      <table className="interaction-stats__matrix">
        <thead>
          <tr>
            <th aria-label="行标题" />
            {columns.map((column) => <th key={column.id}>{column.label}</th>)}
          </tr>
        </thead>
        <tbody>
          {question.matrixRows.map((row) => (
            <tr key={row.id}>
              <th scope="row">{row.label}</th>
              {row.options.map((option) => (
                <td key={option.id}>{option.count}<span className="interaction-stats__muted"> · {option.percent}%</span></td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** 文本类答案分页浏览（含关键词搜索），替代此前只给前 50 条的一次性样本 */
function TextAnswers({ interactionId, question }: Readonly<{
  interactionId: number;
  question: CmsInteractionQuestionStats;
}>) {
  const [page, setPage] = useState(1);
  const [draft, setDraft] = useState('');
  const [keyword, setKeyword] = useState('');
  const query = useCmsInteractionTexts(interactionId, question.id, page, TEXT_PAGE_SIZE, keyword);
  const submit = () => { setPage(1); setKeyword(draft.trim()); };
  return (
    <div className="interaction-stats__texts">
      <div className="interaction-stats__text-search">
        <Input
          prefix={<Search size={13} />}
          placeholder="搜索答案内容"
          showClear
          size="small"
          value={draft}
          onChange={setDraft}
          onEnterPress={submit}
        />
        <Button size="small" onClick={submit}>搜索</Button>
      </div>
      <Spin spinning={query.isFetching}>
        {(query.data?.list.length ?? 0) === 0 ? (
          <Typography.Text type="tertiary">{keyword ? '没有匹配的答案' : '暂无文本答案'}</Typography.Text>
        ) : (
          <>
            {query.data?.list.map((item) => (
              <div key={`${item.responseId}-${item.value}`} className="interaction-stats__text-item">
                <span>{item.value}</span>
                <span className="interaction-stats__muted">{item.createdAt}</span>
              </div>
            ))}
            <div className="interaction-stats__text-foot">
              <Typography.Text type="tertiary" size="small">共 {query.data?.total ?? 0} 条</Typography.Text>
              <Button size="small" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</Button>
              <Button
                size="small"
                disabled={page * TEXT_PAGE_SIZE >= (query.data?.total ?? 0)}
                onClick={() => setPage((value) => value + 1)}
              >
                下一页
              </Button>
            </div>
          </>
        )}
      </Spin>
    </div>
  );
}

function QuestionStatsBlock({ interactionId, question, index }: Readonly<{
  interactionId: number;
  question: CmsInteractionQuestionStats;
  index: number;
}>) {
  const hasTexts = TEXTUAL_TYPES.includes(question.type) || question.texts.length > 0;
  return (
    <section className="interaction-stats__question">
      <Typography.Title heading={6}>
        {index + 1}. {question.label}
        <Tag size="small" style={{ marginLeft: 8 }}>{CMS_INTERACTION_QUESTION_TYPE_LABELS[question.type]}</Tag>
        <span className="interaction-stats__muted"> {question.answered} 人作答</span>
      </Typography.Title>
      {question.npsScore !== null ? (
        <Typography.Text strong type="success">NPS 净推荐值：{question.npsScore}</Typography.Text>
      ) : null}
      {question.average !== null ? (
        <Typography.Text type="tertiary">平均值：{question.average}</Typography.Text>
      ) : null}
      {question.type === 'matrix' ? <MatrixTable question={question} /> : null}
      {question.options.length > 0 ? <OptionBars options={question.options} /> : null}
      {hasTexts ? <TextAnswers interactionId={interactionId} question={question} /> : null}
    </section>
  );
}

function CrossAnalysis({ interactionId, questions }: Readonly<{
  interactionId: number;
  questions: CmsInteractionQuestionStats[];
}>) {
  const choices = useMemo(
    () => questions.filter((question) => question.type === 'single' || question.type === 'multiple'),
    [questions],
  );
  const [x, setX] = useState<number | undefined>(choices[0]?.id);
  const [y, setY] = useState<number | undefined>(choices[1]?.id);
  const query = useCmsInteractionCrossStats(interactionId, x, y, x !== y);

  if (choices.length < 2) {
    return <Empty {...emptyIllustration('NoContent')} description="至少需要两道单选或多选题才能做交叉分析" />;
  }
  const optionList = choices.map((question) => ({ value: question.id, label: question.label }));
  return (
    <div className="interaction-stats__cross">
      <div className="interaction-stats__cross-picker">
        <Select value={x} style={{ flex: 1, minWidth: 160 }} optionList={optionList} onChange={(value) => setX(value as number)} />
        <span>×</span>
        <Select value={y} style={{ flex: 1, minWidth: 160 }} optionList={optionList} onChange={(value) => setY(value as number)} />
      </div>
      {x === y ? (
        <Typography.Text type="warning">请选择两道不同的题目</Typography.Text>
      ) : (
        <Spin spinning={query.isFetching}>
          {query.data ? (
            <div className="interaction-stats__matrix-wrap">
              <table className="interaction-stats__matrix">
                <thead>
                  <tr>
                    <th>{query.data.xLabel} \ {query.data.yLabel}</th>
                    {query.data.columns.map((column) => <th key={column.value}>{column.label}</th>)}
                    <th>小计</th>
                  </tr>
                </thead>
                <tbody>
                  {query.data.rows.map((row) => (
                    <tr key={row.value}>
                      <th scope="row">{row.label}</th>
                      {row.cells.map((cell, cellIndex) => (
                        <td key={query.data!.columns[cellIndex].value}>
                          {cell.count}<span className="interaction-stats__muted"> · {cell.percent}%</span>
                        </td>
                      ))}
                      <td>{row.total}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </Spin>
      )}
    </div>
  );
}

function TrendView({ interactionId }: Readonly<{ interactionId: number }>) {
  const [days, setDays] = useState(30);
  const query = useCmsInteractionTrend(interactionId, days);
  const max = Math.max(1, ...(query.data?.points ?? []).map((point) => point.count));
  const columns = [
    dateColumn('日期', 'date'),
    { title: '答卷数', dataIndex: 'count', width: 90, align: 'right' as const },
    {
      title: '分布',
      dataIndex: 'distribution',
      render: (_: unknown, record: { count: number }) => <DataBar value={record.count} max={max} />,
    },
  ];
  return (
    <div className="interaction-stats__trend">
      <Select value={days} style={{ width: 140 }} optionList={TREND_OPTIONS} onChange={(value) => setDays(value as number)} />
      <ConfigurableTable
        size="small"
        bordered
        columnSettingsKey="cms-interaction-trend"
        columns={columns}
        dataSource={query.data?.points ?? []}
        loading={query.isFetching}
        rowKey="date"
        pagination={false}
        scroll={{ y: 360 }}
        onRefresh={() => void query.refetch()}
        refreshLoading={query.isFetching}
      />
    </div>
  );
}

export default function InteractionResultsSheet({ interaction, onClose }: Readonly<{
  interaction: CmsInteraction | null;
  onClose: () => void;
}>) {
  const query = useCmsInteractionStats(interaction?.id, !!interaction);
  const id = interaction?.id;
  return (
    <SideSheet
      title={interaction ? `结果统计：${interaction.title}` : '结果统计'}
      visible={!!interaction}
      onCancel={onClose}
      width={640}
    >
      <Spin spinning={query.isFetching}>
        {query.data && id ? (
          <Tabs collapsible="auto" type="line" lazyRender>
            <TabPane tab="题目分布" itemKey="questions">
              <Typography.Text type="tertiary">共收集 {query.data.responseCount} 份答卷</Typography.Text>
              <div className="interaction-stats">
                {query.data.questions.map((question, index) => (
                  <QuestionStatsBlock key={question.id} interactionId={id} question={question} index={index} />
                ))}
              </div>
            </TabPane>
            <TabPane tab="交叉分析" itemKey="cross">
              <CrossAnalysis interactionId={id} questions={query.data.questions} />
            </TabPane>
            <TabPane tab="提交趋势" itemKey="trend">
              <TrendView interactionId={id} />
            </TabPane>
          </Tabs>
        ) : null}
      </Spin>
    </SideSheet>
  );
}
