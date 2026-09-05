import { useState } from 'react';
import { Table, Typography } from '@douyinfe/semi-ui';
import { useMemberTransactions, type MemberTransactionOp } from '../hooks/queries';
import { dateTimeColumn } from '@/utils/table-columns';

interface TransactionListProps {
  /** 数据源契约操作：积分流水或钱包流水 */
  op: MemberTransactionOp;
  typeLabels: Record<string, string>;
  formatAmount: (absAmount: number) => string;
}

const PAGE_SIZE = 15;

export function TransactionList({ op, typeLabels, formatAmount }: TransactionListProps) {
  const [page, setPage] = useState(1);
  const query = useMemberTransactions(op, { page, pageSize: PAGE_SIZE });
  const data = query.data?.list ?? [];
  const total = query.data?.total ?? 0;

  const columns = [
    {
      title: '类型',
      dataIndex: 'type',
      width: 120,
      render: (type: string) => typeLabels[type] ?? type,
    },
    {
      title: '备注',
      dataIndex: 'remark',
      render: (remark: string | null) => remark ?? '—',
    },
    {
      title: '金额',
      align: 'right' as const,
      dataIndex: 'amount',
      width: 120,
      render: (amount: number) => {
        const positive = amount >= 0;
        return (
          <Typography.Text style={{ color: positive ? 'var(--m-primary)' : 'var(--m-text)', fontWeight: 600 }}>
            {positive ? '+' : '-'}
            {formatAmount(Math.abs(amount))}
          </Typography.Text>
        );
      },
    },
    dateTimeColumn('时间', 'createdAt'),
  ];

  return (
    <Table
      columns={columns}
      dataSource={data}
      loading={query.isFetching}
      rowKey="id"
      size="small"
      pagination={{
        total,
        pageSize: PAGE_SIZE,
        currentPage: page,
        showSizeChanger: false,
        onPageChange: (p: number) => setPage(p),
      }}
      empty={<div className="m-empty">暂无记录</div>}
    />
  );
}
