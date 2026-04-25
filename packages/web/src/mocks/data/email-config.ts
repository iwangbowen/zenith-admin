import type { EmailConfig } from '@zenith/shared';

const SEED_DATE = '2024-01-01 00:00:00';

export const mockEmailConfig: EmailConfig = {
  id: 1,
  smtpHost: 'smtp.example.com',
  smtpPort: 465,
  smtpUser: 'noreply@example.com',
  // smtpPassword intentionally omitted to match real API behavior (masked)
  fromName: 'Zenith Admin',
  fromEmail: 'noreply@example.com',
  encryption: 'ssl',
  status: 'active',
  createdAt: SEED_DATE,
  updatedAt: SEED_DATE,
};
