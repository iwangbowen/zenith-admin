import type { QueryClient } from '@tanstack/react-query';
import { firewallContract } from '@zenith/shared/ops';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export const firewallKeys = {
  /** 各主机的防火墙状态（子集匹配） */
  statuses: contractKey(firewallContract.status),
  status: (hostId: number | null) => contractKey(firewallContract.status, { query: hostQueryOf(hostId) }),
  lists: contractKey(firewallContract.rules),
  list: (hostId: number | null) => contractKey(firewallContract.rules, { query: hostQueryOf(hostId) }),
};

export function useFirewallStatus(hostId: number | null = null) {
  return useApiQuery(firewallContract.status, { query: hostQueryOf(hostId) }, { requestOptions: { silent: true } });
}

export function useFirewallRules(hostId: number | null = null) {
  return useApiQuery(firewallContract.rules, { query: hostQueryOf(hostId) }, { requestOptions: { silent: true } });
}

/**
 * 规则增删与启停只作用于本机（服务端拒绝远端写入）：状态面板（含规则数 / 启用态）与规则列表都会变化，
 * 两者是本域仅有的查询，按操作前缀各失效一次
 */
function invalidateFirewall(qc: QueryClient) {
  void qc.invalidateQueries({ queryKey: firewallKeys.statuses });
  void qc.invalidateQueries({ queryKey: firewallKeys.lists });
}

export function useAddFirewallRule() {
  return useApiMutation(firewallContract.addRule, { invalidate: invalidateFirewall });
}

export function useDeleteFirewallRule() {
  return useApiMutation(firewallContract.removeRule, { invalidate: invalidateFirewall });
}

/** 启用 / 禁用是两条操作，页面按目标状态择一调用 */
export function useEnableFirewall() {
  return useApiMutation(firewallContract.enable, { invalidate: invalidateFirewall });
}

export function useDisableFirewall() {
  return useApiMutation(firewallContract.disable, { invalidate: invalidateFirewall });
}
