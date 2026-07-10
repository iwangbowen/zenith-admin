/**
 * 报表中心 Demo MSW handler 冒烟测试。
 * 直接驱动 handler.run() 找到首个匹配并解析响应，校验关键端点返回标准 { code, message, data } 包裹
 * 与预期数据形状，锁定 Demo 离线展示能力（数据源/数据集取数/仪表盘数据/打印渲染/AI/公开页/分类/预警）。
 */
import { describe, it, expect } from 'vitest';
import { reportHandlers } from '@/mocks/handlers/report';

// jsdom 下 location.origin 为 http://localhost:3000；MSW 相对路径按页面 origin 解析，请求需同源
const ORIGIN = window.location.origin;

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- 测试中按需访问任意 data 形状
interface ApiEnvelope { code: number; message: string; data: any }

/** 遍历 handlers，返回首个匹配该请求的响应体（解析 JSON 包裹）。 */
async function call(method: string, path: string, body?: unknown): Promise<ApiEnvelope> {
  for (const h of reportHandlers) {
    const request = new Request(`${ORIGIN}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: body != null ? JSON.stringify(body) : undefined,
    });
    const res = await (h as unknown as { run: (a: unknown) => Promise<{ response?: Response } | null> })
      .run({ request, requestId: `t-${Math.random()}` });
    if (res?.response) return res.response.json() as Promise<ApiEnvelope>;
  }
  throw new Error(`no handler matched ${method} ${path}`);
}

describe('report handlers smoke', () => {
  it('数据源列表分页', async () => {
    const j = await call('GET', '/api/report/datasources?page=1&pageSize=10');
    expect(j.code).toBe(0);
    expect(j.data.list.length).toBeGreaterThan(0);
    expect(j.data.total).toBeGreaterThan(0);
  });

  it('数据集列表 + 取数', async () => {
    const list = await call('GET', '/api/report/datasets?page=1&pageSize=10');
    expect(list.data.list.length).toBe(2);
    const data = await call('POST', '/api/report/datasets/1/data', { params: {}, limit: 100 });
    expect(data.code).toBe(0);
    expect(data.data.columns).toEqual(['name', 'value']);
    expect(data.data.fields.map((field: { name: string }) => field.name)).toEqual(['name', 'value']);
    expect(data.data.rows.length).toBe(3);
  });

  it('仪表盘详情 + 批量取数映射', async () => {
    const dash = await call('GET', '/api/report/dashboards/1');
    expect(dash.data.name).toBe('示例仪表盘');
    const data = await call('POST', '/api/report/dashboards/1/data', { filters: {} });
    expect(Object.keys(data.data)).toContain('w1');
    expect(data.data.w1.data.rows.length).toBe(3);
    expect(data.data.w1.error).toBeNull();
    expect(typeof data.data.w1.durationMs).toBe('number');
  });

  it('打印渲染填充网格', async () => {
    const r = await call('POST', '/api/report/print/1/render', {});
    expect(r.code).toBe(0);
    expect(r.data.grid.rows).toBeGreaterThan(1);
    expect(r.data.pages.length).toBeGreaterThan(0);
    expect(r.data.sheets.length).toBeGreaterThan(0);
    expect(r.data.name).toBe('部门人数清单');
  });

  it('AI NL2SQL + 公开分享页', async () => {
    const ai = await call('POST', '/api/report/ai/nl2sql', { question: '各部门人数' });
    expect(ai.data.sql).toContain('SELECT');
    const pub = await call('POST', '/api/report/public/dashboards/anytoken123', {});
    expect(pub.code).toBe(0);
    expect(pub.data.widgets.length).toBeGreaterThan(0);
  });

  it('分类列表 + 预警评估', async () => {
    const cats = await call('GET', '/api/report/categories');
    expect(cats.data.length).toBe(2);
    const ev = await call('POST', '/api/report/alerts/1/evaluate');
    expect(ev.data.taskType).toBe('report-alert-evaluate');
    const history = await call('GET', '/api/report/delivery-runs?targetType=alert&alertRuleId=1&page=1&pageSize=10');
    expect(history.data.list.length).toBeGreaterThan(0);
  });

  it('数据源 CRUD 往返', async () => {
    const created = await call('POST', '/api/report/datasources', { name: '冒烟数据源', type: 'sql', config: { connection: 'internal' }, status: 'enabled' });
    expect(created.code).toBe(0);
    const id = created.data.id;
    const got = await call('GET', `/api/report/datasources/${id}`);
    expect(got.data.name).toBe('冒烟数据源');
    const del = await call('DELETE', `/api/report/datasources/${id}`);
    expect(del.code).toBe(0);
  });

  it('订阅立即推送返回任务并写入历史', async () => {
    const task = await call('POST', '/api/report/subscriptions/1/run');
    expect(task.data.taskType).toBe('report-subscription-deliver');
    const history = await call('GET', '/api/report/delivery-runs?targetType=subscription&subscriptionId=1&page=1&pageSize=10');
    expect(history.data.list.length).toBeGreaterThan(0);
  });
});
