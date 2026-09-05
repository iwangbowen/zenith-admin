import { useMutation, useQueryClient } from '@tanstack/react-query';
import { firewallContract } from '@zenith/shared/ops';
import { api, contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { hostQueryOf } from './ops-hosts';

export const firewallKeys = {
  all: ['firewall'] as const,
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

/** 规则变更只作用于本机（服务端拒绝远端写入），状态与规则列表整体失效 */
export function useAddFirewallRule() {
  return useApiMutation(firewallContract.addRule, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: firewallKeys.all });
    },
  });
}

export function useDeleteFirewallRule() {
  return useApiMutation(firewallContract.removeRule, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: firewallKeys.all });
    },
  });
}

/** 启用 / 禁用是两条操作，按目标状态择一调用 */
export function useToggleFirewall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => api(enabled ? firewallContract.enable : firewallContract.disable, { query: {} }),
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}
