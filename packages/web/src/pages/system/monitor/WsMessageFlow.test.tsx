import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { MonitorWsMessage, MonitorWsMetrics } from '@zenith/shared/platform';

vi.mock('@/hooks/usePreferences', () => ({ usePreferences: () => ({ preferences: {} }) }));
vi.mock('@/components/ConfigurableTable', () => ({
  default: ({ dataSource, rowKey, pagination, onRefresh }: { dataSource: Array<MonitorWsMessage & { pingCount?: number }>; rowKey: (row: MonitorWsMessage) => string; pagination: { pageSize: number }; onRefresh: () => void }) => (
    <div data-testid="samples" data-page-size={pagination.pageSize}>
      {dataSource.map((row) => <div key={rowKey(row)}>{row.type ?? `心跳 ${row.connId} ${row.pingCount}`}</div>)}
      <button onClick={onRefresh}>刷新表格</button>
    </div>
  ),
}));
import WsMessageFlow, { WsMessageResult } from './WsMessageFlow';

const message = (id: string, type: string, success = true): MonitorWsMessage => ({
  id, type, success, direction: 'outbound', nodeId: 'node-1', connId: '1', userId: 1, at: 1_700_000_000_000, topic: null, bytes: 10,
});
const failedPong = message('failed', 'pong', false);
const metrics: MonitorWsMetrics = {
  currentConnections: 1, currentUsers: 1, totalConnects: 1, totalDisconnects: 0, totalSent: 20, totalRecv: 20,
  messages: [message('biz', 'chat:message')],
  controlMessages: [message('ping', 'ping'), failedPong],
  exceptionMessages: [failedPong, message('old', 'invalid', false)],
  heartbeats: [{ nodeId: 'node-1', connId: '1', userId: 1, pingCount: 500, pongCount: 499, failedCount: 1, lastPingAt: 1_700_000_000_000, lastPongAt: 1_700_000_000_000, lastFailureAt: 1_700_000_000_000 }],
  connections: [], recentDisconnects: [], nodes: [], topics: [],
  tenants: [],
  fanout: { published: 0, publishFailed: 0, delivered: 0, dropped: 0, subscribedNodes: 0, degradedNodes: 0, nodes: [] },
};

describe('WebSocket 消息流', () => {
  it('默认仅展示业务消息，异常快捷入口保留失败心跳和已离开其他窗口的异常', () => {
    render(<WsMessageFlow metrics={metrics} refreshing={false} onRefresh={vi.fn()} />);
    const table = screen.getByTestId('samples');
    expect(table).toHaveTextContent('chat:message');
    expect(table).not.toHaveTextContent('pong');
    expect(screen.getByRole('tab', { name: '业务消息（1）' })).toHaveAttribute('aria-selected', 'true');
    fireEvent.click(screen.getByRole('button', { name: '查看异常（2）' }));
    expect(table).toHaveTextContent('pong');
    expect(table).toHaveTextContent('invalid');
    expect(table).not.toHaveTextContent('chat:message');
    expect(table).toHaveAttribute('data-page-size', '20');
  });

  it('心跳直接展示原始 ping / pong，连接摘要作为辅助信息', () => {
    render(<WsMessageFlow metrics={metrics} refreshing={false} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '心跳（2）' }));
    const tables = screen.getAllByTestId('samples');
    expect(tables).toHaveLength(2);
    expect(tables[0]).toHaveTextContent('ping');
    expect(tables[0]).toHaveTextContent('pong');
    expect(tables[1]).toHaveTextContent('心跳 1 500');
    expect(screen.getByText('ping', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('pong', { exact: true })).toBeInTheDocument();
    expect(screen.getByText('在线连接心跳摘要（1 / 1）')).toBeInTheDocument();
  });

  it('全部视图去重异常，关键字和仅失败筛选可清除', () => {
    render(<WsMessageFlow metrics={metrics} refreshing={false} onRefresh={vi.fn()} />);
    fireEvent.click(screen.getByRole('tab', { name: '全部（4）' }));
    const table = screen.getByTestId('samples');
    expect(within(table).getAllByText('pong', { exact: true })).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: '仅失败' }));
    expect(table).not.toHaveTextContent('chat:message');
    fireEvent.change(screen.getByPlaceholderText('类型 / Topic / 连接 / 用户 / 节点'), { target: { value: 'invalid' } });
    expect(table).toHaveTextContent('invalid');
    expect(table).not.toHaveTextContent('pong');
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(table).toHaveTextContent('chat:message');
  });

  it('将本地解析 / 写出结果与失败区分，不声称客户端确认收到', () => {
    const { rerender } = render(<WsMessageResult message={message('out', 'chat:message')} />);
    expect(screen.getByText('已写出')).toBeInTheDocument();
    rerender(<WsMessageResult message={{ ...message('in', 'chat:typing'), direction: 'inbound' }} />);
    expect(screen.getByText('已解析')).toBeInTheDocument();
    rerender(<WsMessageResult message={failedPong} />);
    expect(screen.getByText('失败')).toBeInTheDocument();
  });
});
