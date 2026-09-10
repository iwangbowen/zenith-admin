import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { createCmsInteractionSchema } from '@zenith/shared/cms';
import {
  canExposeCmsInteractionResults,
  cmsInteractionRepeatIdentity,
  applyInteractionMarkers,
  interactionCodeStem,
  nextInteractionCopyCode,
  npsScoreOf,
  scaleStatsFromHistogram,
  toCmsInteractionAnswerDetail,
  toCmsInteractionPublicStats,
} from './cms-interactions.service';

const option = (id: string) => ({ id, label: id, value: id });

describe('CMS Stage4 unified interactions', () => {
  it('supports survey and constrained poll definitions in one schema', () => {
    expect(createCmsInteractionSchema.safeParse({
      siteId: 1,
      code: 'feedback',
      kind: 'survey',
      title: 'Feedback',
      questions: [{ label: 'Comment', type: 'text', required: false, options: [], minChoices: 0, maxChoices: 1 }],
    }).success).toBe(true);
    expect(createCmsInteractionSchema.safeParse({
      siteId: 1,
      code: 'vote',
      kind: 'poll',
      title: 'Vote',
      questions: [{ label: 'Pick', type: 'single', options: [option('a'), option('b')], minChoices: 1, maxChoices: 1 }],
    }).success).toBe(true);
    expect(createCmsInteractionSchema.safeParse({
      siteId: 1,
      code: 'bad-poll',
      kind: 'poll',
      title: 'Bad',
      questions: [{ label: 'Text', type: 'text', options: [], minChoices: 0, maxChoices: 1 }],
    }).success).toBe(false);
    expect(createCmsInteractionSchema.safeParse({
      siteId: 1,
      code: 'turnstile-survey',
      kind: 'survey',
      title: 'Protected',
      captchaPolicy: 'turnstile',
      turnstileSiteKey: 'site-key',
      questions: [{ label: 'Comment', type: 'text', required: false, options: [], minChoices: 0, maxChoices: 1 }],
    }).success).toBe(false);
    expect(createCmsInteractionSchema.safeParse({
      siteId: 1,
      code: 'turnstile-survey',
      kind: 'survey',
      title: 'Protected',
      captchaPolicy: 'turnstile',
      turnstileSiteKey: 'site-key',
      turnstileSecret: 'secret-key',
      questions: [{ label: 'Comment', type: 'text', required: false, options: [], minChoices: 0, maxChoices: 1 }],
    }).success).toBe(true);
  });

  it('never exposes text answers in public state/submit statistics', () => {
    const publicStats = toCmsInteractionPublicStats({
      interactionId: 1,
      responseCount: 2,
      questions: [{
        id: 3,
        label: 'private text',
        type: 'text',
        options: [],
        texts: ['must-not-leak'],
      }],
    });
    expect(JSON.stringify(publicStats)).not.toContain('texts');
    expect(JSON.stringify(publicStats)).not.toContain('must-not-leak');
  });

  it('renders unified markers and safely ignores legacy poll/survey markers', () => {
    const rendered = applyInteractionMarkers(
      '<p>[投票:legacy]</p><p>[问卷:old-survey]</p><p>[互动:current]</p>',
      'main',
      3,
    );
    expect(rendered).not.toContain('[投票:');
    expect(rendered).not.toContain('[问卷:');
    expect(rendered).toContain('data-code="current"');
    expect(rendered).toContain('data-site-id="3"');
    expect(() => applyInteractionMarkers('[互动:<malformed>][投票:broken', 'main')).not.toThrow();
  });

  it('serializes question replacement with submissions and keeps multiple forms reusable', async () => {
    const service = await readFile(new URL('./cms-interactions-forms.service.ts', import.meta.url), 'utf8');
    expect((service.match(/\.for\('update'\)/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(service).toContain('current.responseCount > 0');
    expect(service).toContain('validateInteractionAnswers(questions, input)');
    // 多次参与表单提交后复用（保留表单、刷新实时结果、清空答案）由 cms/islands/survey/survey.test.ts 以 DOM 行为断言
  });

  it('copies every question presentation and branching property', async () => {
    const service = await readFile(new URL('./cms-interactions-forms.service.ts', import.meta.url), 'utf8');
    for (const field of ['allowOther', 'otherLabel', 'ratingMax', 'matrixRows', 'pageNo', 'visibleWhen']) {
      expect(service).toContain(`${field}: question.${field}`);
    }
  });

  it('aggregates statistics in SQL instead of pulling answers into memory', async () => {
    const service = await readFile(new URL('./cms-interactions-stats.service.ts', import.meta.url), 'utf8');
    // 旧实现把最多 10 万条 answers 拉进内存做 JS 聚合，超限即静默截断
    expect(service).not.toContain('limit(100_000)');
    expect(service).toContain('GROUP BY a.question_id, v.val');
    // 数组与标量答案统一由 LATERAL 摊平，避免在 JS 里分支处理
    expect(service).toContain('jsonb_array_elements_text(a.value)');
  });

  it('enforces repeat identities and result visibility without leaking hidden results', () => {
    expect(cmsInteractionRepeatIdentity({ policy: 'once_per_member', memberId: 7, ipHash: 'ip' })).toBe('m:7');
    expect(cmsInteractionRepeatIdentity({ policy: 'once_per_ip', memberId: null, ipHash: 'hash' })).toBe('i:hash');
    expect(cmsInteractionRepeatIdentity({ policy: 'multiple', memberId: null, ipHash: 'hash' })).toBeNull();
    expect(canExposeCmsInteractionResults({ visibility: 'hidden', status: 'closed', submitted: true })).toBe(false);
    expect(canExposeCmsInteractionResults({ visibility: 'after_submit', status: 'published', submitted: true })).toBe(true);
    expect(canExposeCmsInteractionResults({ visibility: 'after_close', status: 'published', submitted: true })).toBe(false);
  });

  it('renders the survey as an island container instead of an inline script', async () => {
    const [theme, marker] = await Promise.all([
      readFile(new URL('../../cms/themes/default/templates.tsx', import.meta.url), 'utf8'),
      readFile(new URL('./cms-interactions-responses.service.ts', import.meta.url), 'utf8'),
    ]);
    // 问卷交互（题型渲染、条件显隐 / 分页、多选与「其他」校验、草稿、提交与验证码重取）全部位于
    // cms/islands/survey/**，由 survey.test.ts 以 DOM 行为断言；主题与正文标记只输出同一 data 契约
    expect(theme).not.toContain('INTERACTION_SCRIPT');
    expect(theme).toContain('className="cms-interaction" data-island="survey"');
    expect(marker).toContain('class="cms-interaction" data-island="survey"');
  });

  it('generates non-colliding copy codes and never nests -copy suffixes', () => {
    expect(interactionCodeStem('satisfaction')).toBe('satisfaction');
    expect(interactionCodeStem('satisfaction-copy')).toBe('satisfaction');
    expect(interactionCodeStem('satisfaction-copy-7')).toBe('satisfaction');
    expect(nextInteractionCopyCode('satisfaction', new Set())).toBe('satisfaction-copy');
    expect(nextInteractionCopyCode('satisfaction', new Set(['satisfaction-copy']))).toBe('satisfaction-copy-2');
    // 副本的副本仍挂在原始词根上，不会累加成 xxx-copy-copy
    expect(nextInteractionCopyCode('satisfaction-copy', new Set(['satisfaction-copy', 'satisfaction-copy-2'])))
      .toBe('satisfaction-copy-3');
    const long = 'a'.repeat(60);
    expect(nextInteractionCopyCode(long, new Set()).length).toBeLessThanOrEqual(50);
    expect(() => nextInteractionCopyCode('x', new Set([
      'x-copy',
      ...Array.from({ length: 99 }, (_, i) => `x-copy-${i + 2}`),
    ]))).toThrow();
  });

  it('resolves option values to labels and falls back when options changed', () => {
    const options = [{ label: '非常满意', value: 'very' }, { label: '满意', value: 'ok' }];
    expect(toCmsInteractionAnswerDetail({
      questionId: 1, label: '满意度', type: 'single', options, value: 'very',
    })).toEqual({ questionId: 1, label: '满意度', type: 'single', values: ['非常满意'], display: '非常满意' });
    expect(toCmsInteractionAnswerDetail({
      questionId: 2, label: '功能', type: 'multiple', options, value: ['very', 'ok'],
    }).display).toBe('非常满意、满意');
    // 选项被删除/改名后回退成原始 value，不吞内容
    expect(toCmsInteractionAnswerDetail({
      questionId: 3, label: '功能', type: 'multiple', options, value: ['very', 'removed'],
    }).display).toBe('非常满意、removed');
    // 文本题原样返回，不做任何选项反查
    expect(toCmsInteractionAnswerDetail({
      questionId: 4, label: '建议', type: 'text', options: null, value: 'very',
    }).display).toBe('very');
  });

  it('renders new question types readably', () => {
    const options = [{ label: '好用', value: 'good' }, { label: '待改进', value: 'bad' }];
    // 矩阵：行标签：列标签
    expect(toCmsInteractionAnswerDetail({
      questionId: 1, label: '模块评价', type: 'matrix', options,
      matrixRows: [{ id: 'r1', label: '内容管理' }, { id: 'r2', label: '发布' }],
      value: ['r1::good', 'r2::bad'],
    }).display).toBe('内容管理：好用、发布：待改进');
    // 矩阵行被删除后回退成原始 id，不丢数据
    expect(toCmsInteractionAnswerDetail({
      questionId: 1, label: '模块评价', type: 'matrix', options, matrixRows: [], value: ['r9::good'],
    }).display).toBe('r9：好用');
    // 评分与 NPS 带单位
    expect(toCmsInteractionAnswerDetail({
      questionId: 2, label: '打分', type: 'rating', options: null, value: '4',
    }).display).toBe('4 分');
    expect(toCmsInteractionAnswerDetail({
      questionId: 3, label: '推荐度', type: 'nps', options: null, value: '9',
    }).display).toBe('9 分');
    // 「其他」填空展示自定义标签 + 自由文本
    expect(toCmsInteractionAnswerDetail({
      questionId: 4, label: '行业', type: 'single', options, otherLabel: '其他行业',
      value: '__other__:文旅',
    }).display).toBe('其他行业：文旅');
    // 未填写自由文本时只展示标签
    expect(toCmsInteractionAnswerDetail({
      questionId: 5, label: '行业', type: 'single', options, value: '__other__',
    }).display).toBe('其他');
    // 日期与数字原样返回
    expect(toCmsInteractionAnswerDetail({
      questionId: 6, label: '上线时间', type: 'date', options: null, value: '2026-08-01',
    }).display).toBe('2026-08-01');
  });

  it('computes NPS as promoters minus detractors', () => {
    expect(npsScoreOf([])).toBeNull();
    // 5 个推荐者(9-10)、3 个贬损者(0-6)、2 个被动者(7-8) => 50% - 30% = 20
    expect(npsScoreOf([10, 10, 9, 9, 9, 0, 3, 6, 7, 8])).toBe(20);
    expect(npsScoreOf([10, 10])).toBe(100);
    expect(npsScoreOf([0, 6])).toBe(-100);
    // 7-8 分为被动者，既不加也不减
    expect(npsScoreOf([7, 8])).toBe(0);
  });

  it('derives scale average and NPS from the SQL histogram without rescanning rows', () => {
    // 直方图口径：分值 → 人数，均值必须按人数加权而非按桶数平均
    const { average, scores } = scaleStatsFromHistogram(new Map([['10', 2], ['9', 1], ['5', 1]]));
    expect(average).toBe(8.5);
    expect(scores).toHaveLength(4);
    expect(npsScoreOf(scores)).toBe(50);
    // 空直方图（无人作答）不产生 0 分假象
    expect(scaleStatsFromHistogram(new Map()).average).toBeNull();
    // 非数字桶（脏数据 / 选项 value）被忽略，不污染均值
    expect(scaleStatsFromHistogram(new Map([['3', 1], ['bad', 5]])).average).toBe(3);
  });

  it('accepts new question types and rejects invalid definitions', () => {
    const base = { siteId: 1, code: 'q', kind: 'survey' as const, title: 'Q' };
    const ok = createCmsInteractionSchema.safeParse({
      ...base,
      questions: [
        { label: 'NPS', type: 'nps', options: [] },
        { label: '评分', type: 'rating', options: [], ratingMax: 5 },
        {
          label: '矩阵', type: 'matrix',
          options: [option('a'), option('b')],
          matrixRows: [{ id: 'r1', label: '行一' }],
        },
        { label: '行业', type: 'single', options: [option('gov'), option('edu')], allowOther: true },
        {
          label: '补充', type: 'text', options: [], required: false,
          visibleWhen: { questionIndex: 3, op: 'any', values: ['gov'] },
        },
      ],
    });
    expect(ok.success).toBe(true);

    // 矩阵必须有行
    expect(createCmsInteractionSchema.safeParse({
      ...base, questions: [{ label: '矩阵', type: 'matrix', options: [option('a'), option('b')], matrixRows: [] }],
    }).success).toBe(false);
    // 条件只能依赖前面的题
    expect(createCmsInteractionSchema.safeParse({
      ...base,
      questions: [
        { label: '补充', type: 'text', options: [], visibleWhen: { questionIndex: 1, op: 'any', values: ['a'] } },
        { label: '来源', type: 'single', options: [option('a'), option('b')] },
      ],
    }).success).toBe(false);
    // 条件不能依赖非选择题
    expect(createCmsInteractionSchema.safeParse({
      ...base,
      questions: [
        { label: '打分', type: 'rating', options: [] },
        { label: '补充', type: 'text', options: [], visibleWhen: { questionIndex: 0, op: 'any', values: ['5'] } },
      ],
    }).success).toBe(false);
    // 页码必须连续
    expect(createCmsInteractionSchema.safeParse({
      ...base,
      questions: [
        { label: '一', type: 'text', options: [], pageNo: 1 },
        { label: '二', type: 'text', options: [], pageNo: 3 },
      ],
    }).success).toBe(false);
    // 「其他」只允许单选/多选
    expect(createCmsInteractionSchema.safeParse({
      ...base, questions: [{ label: '打分', type: 'rating', options: [], allowOther: true }],
    }).success).toBe(false);
    // 选项 value 不能占用「其他」哨兵前缀
    expect(createCmsInteractionSchema.safeParse({
      ...base,
      questions: [{
        label: '来源', type: 'single',
        options: [{ id: 'a', label: 'a', value: '__other__' }, option('b')],
      }],
    }).success).toBe(false);
  });
});
