import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PaginatedResponse } from '@zenith/shared';
import { request } from '@/utils/request';
import { toQueryString, unwrap } from '@/lib/query';

export type SshAuthType = 'password' | 'key_path' | 'key_content' | 'agent';
export interface SshProfile {
  id: number;
  userId: number;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: SshAuthType;
  hasPassword: boolean;
  keyPath: string | null;
  hasKeyContent: boolean;
  hasKeyPassphrase: boolean;
  envVars: Record<string, string>;
  groupName: string | null;
  tags: string[];
  orderNum: number;
  createdAt: string;
  updatedAt: string;
}
export type TerminalKind = 'local' | 'ssh' | 'docker';
export interface TerminalSessionItem {
  sessionId: string;
  userId: number;
  username: string;
  kind: TerminalKind;
  label: string;
  clientIp: string;
  cols: number;
  rows: number;
  connected: boolean;
  observerCount: number;
  takenOver: boolean;
  startedAt: string;
  lastActivityAt: string;
  idleSeconds: number;
  durationSeconds: number;
}
export type RecordingEvent = [number, 'o' | 'i', string];
export interface Recording {
  id: number;
  title: string;
  username: string;
  shell: string | null;
  cols: number;
  rows: number;
  duration: number;
  commandCount: number;
  createdAt: string;
}
export interface RecordingDetail extends Recording {
  events: RecordingEvent[];
}
export interface TerminalSessionListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  kind?: TerminalKind;
}
export interface TerminalRecordingListParams {
  page: number;
  pageSize: number;
  keyword?: string;
  operatorUserId?: number;
  startTime?: string;
  endTime?: string;
}

export const terminalKeys = {
  all: ['terminal'] as const,
  sshProfiles: ['terminal', 'ssh-profiles'] as const,
  sessionLists: ['terminal', 'sessions', 'list'] as const,
  sessionList: (params: TerminalSessionListParams) => ['terminal', 'sessions', 'list', params] as const,
  recordingLists: ['terminal', 'recordings', 'list'] as const,
  recordingList: (params: TerminalRecordingListParams) => ['terminal', 'recordings', 'list', params] as const,
  recordingDetail: (id: number | undefined) => ['terminal', 'recordings', 'detail', id] as const,
};

export function useSshProfiles() {
  return useQuery({
    queryKey: terminalKeys.sshProfiles,
    queryFn: () => request.get<SshProfile[]>('/api/ssh-profiles').then(unwrap),
  });
}

export function useSaveSshProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, values }: { id?: number; values: Record<string, unknown> }) =>
      (id === undefined ? request.post<SshProfile>('/api/ssh-profiles', values) : request.put<SshProfile>(`/api/ssh-profiles/${id}`, values)).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalKeys.sshProfiles }),
  });
}

export function useDeleteSshProfile() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/ssh-profiles/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalKeys.sshProfiles }),
  });
}

export function useUpdateSshProfileOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (updates: Array<{ id: number; orderNum: number }>) =>
      Promise.all(updates.map((u) => request.put<SshProfile>(`/api/ssh-profiles/${u.id}`, { orderNum: u.orderNum }).then(unwrap))),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalKeys.sshProfiles }),
  });
}

export function useTerminalSessionList(params: TerminalSessionListParams, options?: { refetchInterval?: number | false }) {
  return useQuery({
    queryKey: terminalKeys.sessionList(params),
    queryFn: () => request.get<PaginatedResponse<TerminalSessionItem>>(`/api/terminal-sessions${toQueryString(params)}`, { silent: true }).then(unwrap),
    placeholderData: keepPreviousData,
    refetchInterval: options?.refetchInterval,
  });
}

export function useTerminateTerminalSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (sessionId: string) => request.post<null>(`/api/terminal-sessions/${encodeURIComponent(sessionId)}/terminate`, {}).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalKeys.sessionLists }),
  });
}

export function useTerminalRecordingList(params: TerminalRecordingListParams) {
  return useQuery({
    queryKey: terminalKeys.recordingList(params),
    queryFn: () => request.get<PaginatedResponse<Recording>>(`/api/terminal-recordings${toQueryString(params)}`).then(unwrap),
    placeholderData: keepPreviousData,
  });
}

export function useTerminalRecordingDetail(id: number | undefined, enabled = true) {
  return useQuery({
    queryKey: terminalKeys.recordingDetail(id),
    queryFn: () => request.get<RecordingDetail>(`/api/terminal-recordings/${id}`).then(unwrap),
    enabled: enabled && id !== undefined,
  });
}

export function useDeleteTerminalRecording() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => request.delete<null>(`/api/terminal-recordings/${id}`).then(unwrap),
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalKeys.recordingLists }),
  });
}

export function useCleanTerminalRecordings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (months: number) => {
      const res = await request.delete<null>(`/api/terminal-recordings/clean${toQueryString({ months })}`);
      unwrap(res);
      return res.message;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: terminalKeys.recordingLists }),
  });
}
