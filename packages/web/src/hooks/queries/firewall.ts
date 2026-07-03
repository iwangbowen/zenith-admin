import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { request } from '@/utils/request';
import { unwrap } from '@/lib/query';

export interface FirewallStatus {
  enabled: boolean;
  type: 'ufw' | 'firewalld' | 'iptables' | 'unknown';
  version: string | null;
  defaultIncoming: string | null;
  defaultOutgoing: string | null;
}

export interface FirewallRule {
  id: string;
  type: 'allow' | 'deny' | 'reject';
  protocol: 'tcp' | 'udp' | 'any';
  port: string;
  from: string;
  to: string;
  direction: 'in' | 'out' | 'any';
  comment: string | null;
  raw?: string;
}

export interface FirewallRuleList {
  type: FirewallStatus['type'];
  rules: FirewallRule[];
}

export interface AddFirewallRuleFormValues {
  type: FirewallRule['type'];
  protocol: FirewallRule['protocol'];
  port: string;
  from: string;
  to: string;
  direction: FirewallRule['direction'];
  comment?: string;
}

export const firewallKeys = {
  all: ['firewall'] as const,
  status: ['firewall', 'status'] as const,
  lists: ['firewall', 'rules'] as const,
  list: () => ['firewall', 'rules'] as const,
};

export function useFirewallStatus() {
  return useQuery({
    queryKey: firewallKeys.status,
    queryFn: () => request.get<FirewallStatus>('/api/firewall', { silent: true }).then(unwrap),
  });
}

export function useFirewallRules() {
  return useQuery({
    queryKey: firewallKeys.list(),
    queryFn: () => request.get<FirewallRuleList>('/api/firewall/rules', { silent: true }).then(unwrap),
  });
}

export function useAddFirewallRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (values: AddFirewallRuleFormValues) =>
      request.post<null>('/api/firewall/rules', {
        ...values,
        from: values.from?.trim() || 'any',
        to: values.to?.trim() || 'any',
        comment: values.comment?.trim() || undefined,
      }).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function useDeleteFirewallRule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => request.delete<null>(`/api/firewall/rules/${encodeURIComponent(id)}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}

export function useToggleFirewall() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (enabled: boolean) => request.post<null>(enabled ? '/api/firewall/enable' : '/api/firewall/disable').then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: firewallKeys.all }),
  });
}
