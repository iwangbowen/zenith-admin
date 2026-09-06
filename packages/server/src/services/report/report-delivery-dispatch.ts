import type { ReportDeliveryStatus, ReportNotifyChannel } from '@zenith/shared/report';
import { dispatchNotificationChannels } from './report-delivery.service';

export interface DispatchReportNotificationInput {
  tenantId: number | null;
  runId: number;
  attempt: number;
  channels: ReportNotifyChannel[];
  recipients?: string | null;
  webhookUrl?: string | null;
  createdBy?: number | null;
  title: string;
  text: string;
  html?: string | null;
  inAppType?: 'info' | 'warning';
  payloadSummary?: Record<string, unknown>;
  isCancelRequested?: () => Promise<boolean>;
}

export function dispatchReportNotification(input: DispatchReportNotificationInput): Promise<{ status: ReportDeliveryStatus; errorMessage: string | null }> {
  return dispatchNotificationChannels({
    ...input,
    inAppType: input.inAppType ?? 'warning',
  });
}
