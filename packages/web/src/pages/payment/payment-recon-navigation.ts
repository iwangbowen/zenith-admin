import { useState } from 'react';
import { useListDeepLink } from '@/hooks/useListDeepLink';
import { useUrlTabState } from '@/hooks/useUrlTabState';

function parseId(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const id = Number(value);
  return Number.isSafeInteger(id) ? id : undefined;
}

function getTarget(params: Record<string, string>) {
  const caseId = parseId(params.caseId);
  if (caseId !== undefined) return { tab: 'cases', id: caseId };
  const periodId = parseId(params.periodId);
  if (periodId !== undefined) return { tab: 'periods', id: periodId };
  return undefined;
}

/** 通知深链仅消费一次；抽屉关闭后同一通知仍可再次打开。 */
export function usePaymentReconNavigation() {
  const [tab, setTab] = useUrlTabState<string>(['periods', 'cases', 'runs', 'adjustments', 'tasks'], 'periods');
  const [periodId, setPeriodId] = useState<number>();
  const [statementId, setStatementId] = useState<number>();
  const [caseId, setCaseId] = useState<number>();

  const openPeriod = (id: number) => { setCaseId(undefined); setPeriodId(id); setStatementId(undefined); };
  const closePeriod = () => { setPeriodId(undefined); setStatementId(undefined); };
  const openCase = (id: number) => { closePeriod(); setCaseId(id); };
  const closeCase = () => setCaseId(undefined);

  useListDeepLink(['caseId', 'periodId'], (params) => {
    const target = getTarget(params);
    if (target?.tab === 'cases') openCase(target.id);
    else if (target?.tab === 'periods') openPeriod(target.id);
  }, {
    getNextParams: (params) => {
      const target = getTarget(params);
      return target ? { tab: target.tab } : undefined;
    },
  });

  return { tab, setTab, periodId, statementId, setStatementId, caseId, openPeriod, closePeriod, openCase, closeCase };
}
