import {
  announcementContract,
  broadcastContract,
  channelContract,
  emailConfigContract,
  emailSendLogContract,
  emailTemplateContract,
  inAppMessageContract,
  inAppTemplateContract,
  notificationPolicyContract,
  notificationPreferenceContract,
  pushCallbackContract,
  pushConfigContract,
  pushSendLogContract,
  smsConfigContract,
  smsSendLogContract,
  smsTemplateContract,
} from '@zenith/shared/messaging';
import { defineRouteDomain } from '../_kit';
import announcementsRoutes from './announcements';
import channelsRoutes from './channels';
import emailConfigRoutes from './email-config';
import emailSendLogsRoutes from './email-send-logs';
import emailTemplatesRoutes from './email-templates';
import inAppMessagesRoutes from './in-app-messages';
import inAppTemplatesRoutes from './in-app-templates';
import notificationPoliciesRoutes from './notification-policies';
import notificationPreferencesRoutes from './notification-preferences';
import notificationUnsubscribeRoutes from './notification-unsubscribe';
import smsConfigsRoutes from './sms-configs';
import smsSendLogsRoutes from './sms-send-logs';
import smsTemplatesRoutes from './sms-templates';
import pushConfigsRoutes from './push-configs';
import pushSendLogsRoutes from './push-send-logs';
import pushCallbacksRoutes from './push-callbacks';
import broadcastsRoutes from './broadcasts';

export default defineRouteDomain({
  name: 'messaging',
  mounts: () => [
    [announcementContract.basePath, announcementsRoutes],
    [emailConfigContract.basePath, emailConfigRoutes],
    [channelContract.basePath, channelsRoutes],
    [emailTemplateContract.basePath, emailTemplatesRoutes],
    [emailSendLogContract.basePath, emailSendLogsRoutes],
    [smsConfigContract.basePath, smsConfigsRoutes],
    [smsTemplateContract.basePath, smsTemplatesRoutes],
    [smsSendLogContract.basePath, smsSendLogsRoutes],
    [pushConfigContract.basePath, pushConfigsRoutes],
    [pushSendLogContract.basePath, pushSendLogsRoutes],
    [pushCallbackContract.basePath, pushCallbacksRoutes],
    [broadcastContract.basePath, broadcastsRoutes],
    [inAppTemplateContract.basePath, inAppTemplatesRoutes],
    [inAppMessageContract.basePath, inAppMessagesRoutes],
    [notificationPreferenceContract.basePath, notificationPreferencesRoutes],
    [notificationPolicyContract.basePath, notificationPoliciesRoutes],
    // 退订页返回 HTML 且以令牌鉴权，不走 JSON 契约
    ['/api/notification-unsubscribe', notificationUnsubscribeRoutes],
  ],
});
