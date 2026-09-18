/** Provider evidence is kept separately from normalized accounting facts. All money is integer minor units. */
export type ProviderBillKind = 'trade' | 'fund';

export interface ProviderBillEntry {
  entryKey: string;
  type: 'payment' | 'refund' | 'fee' | 'settlement' | 'transfer' | 'adjustment';
  merchantOrderNo?: string;
  merchantRefundNo?: string;
  providerTransactionId?: string;
  providerRefundId?: string;
  reference?: string;
  currency: string;
  /** Absolute amount in minor units; direction carries the sign. */
  amount: string;
  occurredAt?: string;
  direction: 'in' | 'out';
  status: 'success' | 'processing' | 'failed';
  /** Signed fee: positive is charged to the merchant, negative is returned. */
  feeAmount?: string;
  /** Signed settlement amount. */
  netAmount?: string;
  balance?: string;
  lineNo: number;
  raw: Record<string, string>;
}

export interface ProviderBillArtifact {
  bytes: Buffer;
  filename: string;
  mimeType: string;
  sha256: string;
  providerHash?: { algorithm: 'SHA1' | 'SHA256'; value: string };
}

export interface ProviderBillResult {
  artifacts: ProviderBillArtifact[];
  entries: ProviderBillEntry[];
  summary: {
    entryCount: number;
    paymentAmount: string;
    refundAmount: string;
    incomeAmount: string;
    expenseAmount: string;
    feeAmount: string;
    providerTotals?: Record<string, string>;
  };
  parserVersion: string;
  merchantId: string;
  billDate: string;
  kind: ProviderBillKind;
}

export type ProviderBillErrorCode = 'waiting' | 'no_bill' | 'temporary' | 'permanent' | 'integrity' | 'format';

/** no_bill means the provider could not produce a bill, never proof of zero activity. */
export class ProviderBillError extends Error {
  readonly retryable: boolean;
  artifacts?: ProviderBillArtifact[];
  constructor(readonly code: ProviderBillErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'ProviderBillError';
    this.retryable = code === 'waiting' || code === 'temporary';
  }
}
