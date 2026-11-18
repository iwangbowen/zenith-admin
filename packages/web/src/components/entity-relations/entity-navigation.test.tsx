import { beforeEach, describe, expect, it } from 'vitest';
import { beginEntityRelationNavigation, clearEntityRelationNavigation, entityRelationSourceUrl, getEntityRelationNavigation, observeEntityRelationLocation, popEntityRelationNavigation } from './entity-navigation';
const order = { type: 'payment.order' as const, key: '41' };
beforeEach(() => clearEntityRelationNavigation());

describe('relation navigation continuity', () => {

  it('reconstructs required detail tabs while retaining unrelated query values and hashes', () => {
    expect(entityRelationSourceUrl({ pathname: '/payment/risk-rules', search: '?view=compact', hash: '#review' }, '/payment/risk-rules?tab=reviews&reviewId=42'))
      .toBe('/payment/risk-rules?view=compact&tab=reviews&reviewId=42#review');
  });

  it('keeps multiple source frames across query cleanup and discards the trail on access or unrelated page changes', () => {
    beginEntityRelationNavigation({ url: '/payment/orders?orderId=41', locationKey: 'source', kind: 'detail', ref: order, pageScrollTop: 100 }, '/payment/refunds?refundId=7', 'user:1', '/payment/orders');
    observeEntityRelationLocation('/payment/refunds', 'user:1');
    observeEntityRelationLocation('/payment/refunds', 'user:1');
    beginEntityRelationNavigation({ url: '/payment/refunds?refundId=7', locationKey: 'refund', kind: 'detail', ref: { type: 'payment.refund', key: '7' }, pageScrollTop: 20 }, '/payment/orders?orderId=9', 'user:1', '/payment/refunds');
    expect(getEntityRelationNavigation()?.stack).toHaveLength(2);
    expect(popEntityRelationNavigation()?.url).toBe('/payment/refunds?refundId=7');
    expect(popEntityRelationNavigation()?.url).toBe('/payment/orders?orderId=41');
    observeEntityRelationLocation('/payment/orders', 'user:2');
    expect(getEntityRelationNavigation()).toBeNull();
    beginEntityRelationNavigation({ url: '/payment/orders', locationKey: 'source', kind: 'page', pageScrollTop: 0 }, '/payment/refunds?refundId=7', 'user:1', '/payment/orders');
    observeEntityRelationLocation('/payment/refunds', 'user:1');
    observeEntityRelationLocation('/system/users', 'user:1');
    expect(getEntityRelationNavigation()).toBeNull();
  });
});
