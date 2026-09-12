/**
 * payment-recon / iot-register 域缓存一致性契约
 *
 * 对账此前任何动作都打掉整个对账资源根（其它批次的明细一并回源）；差异处理现在按响应里的 batchId 精确到所属批次，
 * 「已调账」额外回源资金凭证。IoT 注册密钥此前打掉整个产品资源根（含每个产品的物模型），现在只碰产品下拉源 / 列表 / 详情。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';
import {
  ApiRecorder,
  createRequestMock,
  createTestQueryClient,
  createWrapper,
  isFresh,
  observeFetches,
  type RecordedCall,
} from '@/test-utils/query-harness';

const api = new ApiRecorder();
vi.mock('@/utils/request', () => ({ request: createRequestMock(() => api) }));

import {
  paymentReconKeys,
  useHandlePaymentReconItem,
  usePaymentReconBatchDetail,
  usePaymentReconBatchList,
  usePaymentReconItems,
  usePaymentReconSampleBill,
} from './payment-recon';
import { paymentJournalKeys, usePaymentJournalList } from './payment-journals';
import { iotWhitelistKeys, useDisableIotRegistration, useImportIotWhitelist, useIotWhitelistList, useIotWhitelistStats, useResetIotRegistrationSecret } from './iot-register';
import { iotModelKeys, iotProductKeys, useAllIotProducts } from './iot-products';

const PAGE = { page: 1, pageSize: 10 };
const EMPTY_PAGE = { list: [], total: 0, page: 1, pageSize: 10 };
const ITEM = { id: 5, batchId: 1, result: 'amount_mismatch', handleStatus: 'suspended' };

beforeEach(() => {
  api.reset();
  api
    .on('GET', '/api/payment/recon/batches', EMPTY_PAGE)
    .on('GET', '/api/payment/recon/batches/1', { id: 1, status: 'done' })
    .on('GET', '/api/payment/recon/batches/1/items', EMPTY_PAGE)
    .on('GET', '/api/payment/recon/batches/2/items', EMPTY_PAGE)
    .on('GET', '/api/payment/recon/sample-bill', { billText: 'a,b,c' })
    .on('GET', '/api/payment/journals', EMPTY_PAGE)
    .on('PATCH', '/api/payment/recon/items/5/handle', (call: RecordedCall) => ({ ...ITEM, handleStatus: (call.body as { action: string }).action }))
    .on('GET', '/api/iot/whitelist', EMPTY_PAGE)
    .on('GET', '/api/iot/whitelist/stats', { total: 0, used: 0 })
    .on('GET', '/api/iot/products/all', [{ id: 1, name: '网关', registrationEnabled: false }])
    .on('POST', '/api/iot/whitelist/products/1/registration-secret', { registrationSecret: 'secret' })
    .on('DELETE', '/api/iot/whitelist/products/1/registration-secret', null)
    .on('POST', '/api/iot/whitelist', { inserted: 1, skipped: 0 });
});

describe('payment-recon', () => {
  function mountReconPage() {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        list: usePaymentReconBatchList(PAGE),
        detail: usePaymentReconBatchDetail(1),
        items1: usePaymentReconItems(1, PAGE),
        items2: usePaymentReconItems(2, PAGE),
        journals: usePaymentJournalList(PAGE),
        handle: useHandlePaymentReconItem(),
        sample: usePaymentReconSampleBill(),
      }),
      { wrapper: createWrapper(qc) },
    );
    return { qc, ...hook };
  }

  async function settled(result: ReturnType<typeof mountReconPage>['result']) {
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.detail.isSuccess).toBe(true);
      expect(result.current.items1.isSuccess).toBe(true);
      expect(result.current.items2.isSuccess).toBe(true);
      expect(result.current.journals.isSuccess).toBe(true);
    });
  }

  it('挂账 / 忽略差异：所属批次的明细、详情与批次列表回源，其它批次明细与资金凭证保持新鲜', async () => {
    const { qc, result } = mountReconPage();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    await result.current.handle.mutateAsync({ params: { id: 5 }, body: { action: 'suspended', remark: '待核实' } });
    await waitFor(() => expect(api.countOf('GET', '/api/payment/recon/batches/1/items')).toBe(1));

    expect(fetches.countOf(paymentReconKeys.detail(1))).toBe(1);
    expect(fetches.countOf(paymentReconKeys.lists)).toBe(1);
    expect(api.countOf('GET', '/api/payment/recon/batches/2/items')).toBe(0);
    expect(isFresh(qc, paymentReconKeys.itemList(2, PAGE))).toBe(true);
    expect(fetches.countOf(paymentJournalKeys.lists)).toBe(0);
    expect(isFresh(qc, paymentJournalKeys.list(PAGE))).toBe(true);
    fetches.stop();
  });

  it('已调账会写入双分录凭证：资金凭证列表一并回源', async () => {
    const { qc, result } = mountReconPage();
    await settled(result);

    const fetches = observeFetches(qc);
    await result.current.handle.mutateAsync({ params: { id: 5 }, body: { action: 'adjusted', remark: '渠道多收' } });
    await waitFor(() => expect(fetches.countOf(paymentJournalKeys.lists)).toBe(1));

    expect(fetches.countOf(paymentReconKeys.lists)).toBe(1);
    fetches.stop();
  });

  it('模拟账单变量即契约输入：query 段进入 URL，不触发任何失效', async () => {
    const { qc, result } = mountReconPage();
    await settled(result);

    const fetches = observeFetches(qc);
    api.resetCalls();
    const bill = await result.current.sample.mutateAsync({
      query: { applicationId: 1, channel: 'wechat', channelConfigId: 2, currency: 'CNY', billDate: '2026-09-01' },
    });

    expect(bill).toEqual({ billText: 'a,b,c' });
    expect(api.urls('GET')[0]).toContain('/api/payment/recon/sample-bill?');
    expect(api.urls('GET')[0]).toContain('billDate=2026-09-01');
    expect(fetches.count).toBe(0);
    fetches.stop();
  });
});

describe('iot-register', () => {
  function mountRegisterPage() {
    const qc = createTestQueryClient();
    const hook = renderHook(
      () => ({
        list: useIotWhitelistList(PAGE),
        stats: useIotWhitelistStats(),
        products: useAllIotProducts(),
        reset: useResetIotRegistrationSecret(),
        disable: useDisableIotRegistration(),
        importWhitelist: useImportIotWhitelist(),
      }),
      { wrapper: createWrapper(qc) },
    );
    return { qc, ...hook };
  }

  async function settled(result: ReturnType<typeof mountRegisterPage>['result']) {
    await waitFor(() => {
      expect(result.current.list.isSuccess).toBe(true);
      expect(result.current.stats.isSuccess).toBe(true);
      expect(result.current.products.isSuccess).toBe(true);
    });
  }

  it('开启 / 重置注册密钥：产品下拉源回源（页面从中读取开关），物模型与白名单保持新鲜', async () => {
    const { qc, result } = mountRegisterPage();
    await settled(result);
    qc.setQueryData(iotModelKeys.of(1), { properties: [] });

    const fetches = observeFetches(qc);
    await result.current.reset.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(fetches.countOf(iotProductKeys.lookup)).toBe(1));

    expect(isFresh(qc, iotModelKeys.of(1))).toBe(true);
    expect(fetches.countOf(iotWhitelistKeys.lists)).toBe(0);
    expect(isFresh(qc, iotWhitelistKeys.list(PAGE))).toBe(true);
    fetches.stop();
  });

  it('关闭动态注册同样只碰产品', async () => {
    const { qc, result } = mountRegisterPage();
    await settled(result);
    qc.setQueryData(iotModelKeys.of(1), { properties: [] });

    const fetches = observeFetches(qc);
    await result.current.disable.mutateAsync({ params: { id: 1 } });
    await waitFor(() => expect(fetches.countOf(iotProductKeys.lookup)).toBe(1));

    expect(isFresh(qc, iotModelKeys.of(1))).toBe(true);
    expect(fetches.countOf(iotWhitelistKeys.statsAll)).toBe(0);
    fetches.stop();
  });

  it('批量导入白名单：列表与统计卡回源，产品下拉源保持新鲜', async () => {
    const { qc, result } = mountRegisterPage();
    await settled(result);

    const fetches = observeFetches(qc);
    await result.current.importWhitelist.mutateAsync({ body: { productId: 1, sns: ['SN001'] } });
    await waitFor(() => expect(fetches.countOf(iotWhitelistKeys.lists)).toBe(1));

    expect(fetches.countOf(iotWhitelistKeys.statsAll)).toBe(1);
    expect(fetches.countOf(iotProductKeys.lookup)).toBe(0);
    expect(isFresh(qc, iotProductKeys.lookup)).toBe(true);
    fetches.stop();
  });
});
