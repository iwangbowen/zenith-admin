import type { EmailConfig } from '@zenith/shared/messaging';

const SEED_DATE = '2024-01-01 00:00:00';

export const mockEmailConfig: EmailConfig = {
  id: 1,
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpUser: 'noreply@example.com',
  fromName: 'Zenith Admin',
  fromEmail: 'noreply@example.com',
  encryption: 'ssl',
  status: 'enabled',
  createdAt: SEED_DATE,
  updatedAt: SEED_DATE,
};