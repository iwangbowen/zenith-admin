import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type {
  ReportApiDatasourceConfig,
  ReportCanvasItem,
  ReportDashboardConfig,
  ReportDashboardSnapshot,
  ReportFilter,
  ReportGridItem,
  ReportWidget,
} from '@zenith/shared';
import { db } from '../../db';
import {
  reportAlertRules,
  reportDashboardCategories,
  reportDashboardShares,
  reportDashboardSubscriptions,
  reportDashboards,
  reportDatasets,
  reportDatasources,
  reportPrintTemplates,
  users,
} from '../../db/schema';
import { decryptField, encryptField } from '../../lib/encryption';
import { isSensitiveReportHeader } from './report-secrets';

function normalizeStoredSecret(value: string): string {
  return decryptField(value) === null ? (encryptField(value) ?? value) : value;
}

export async function migrateLegacyReportSecrets(): Promise<void> {
  const [alerts, subscriptions, shares, datasources] = await Promise.all([
    db.select({ id: reportAlertRules.id, value: reportAlertRules.webhookUrl }).from(reportAlertRules),
    db.select({ id: reportDashboardSubscriptions.id, value: reportDashboardSubscriptions.webhookUrl })
      .from(reportDashboardSubscriptions),
    db.select({
      id: reportDashboardShares.id,
      token: reportDashboardShares.token,
      tokenEncrypted: reportDashboardShares.tokenEncrypted,
    }).from(reportDashboardShares),
    db.select({ id: reportDatasources.id, type: reportDatasources.type, config: reportDatasources.config })
      .from(reportDatasources),
  ]);

  await db.transaction(async (tx) => {
    for (const row of alerts) {
      if (!row.value) continue;
      const encrypted = normalizeStoredSecret(row.value);
      if (encrypted !== row.value) {
        await tx.update(reportAlertRules).set({ webhookUrl: encrypted }).where(eq(reportAlertRules.id, row.id));
      }
    }
    for (const row of subscriptions) {
      if (!row.value) continue;
      const encrypted = normalizeStoredSecret(row.value);
      if (encrypted !== row.value) {
        await tx.update(reportDashboardSubscriptions).set({ webhookUrl: encrypted })
          .where(eq(reportDashboardSubscriptions.id, row.id));
      }
    }
    for (const row of shares) {
      if (row.tokenEncrypted || row.token.length >= 64) continue;
      await tx.update(reportDashboardShares).set({
        token: createHash('sha256').update(row.token).digest('hex'),
        tokenEncrypted: encryptField(row.token),
      }).where(eq(reportDashboardShares.id, row.id));
    }
    for (const row of datasources) {
      if (row.type !== 'api') continue;
      const config = (row.config ?? {}) as ReportApiDatasourceConfig;
      if (!config.headers) continue;
      let changed = false;
      const headers = Object.fromEntries(Object.entries(config.headers).map(([key, value]) => {
        if (!value || !isSensitiveReportHeader(key)) return [key, value];
        const encrypted = normalizeStoredSecret(value);
        if (encrypted !== value) changed = true;
        return [key, encrypted];
      }));
      if (changed) {
        await tx.update(reportDatasources).set({ config: { ...config, headers } })
          .where(eq(reportDatasources.id, row.id));
      }
    }
  });
}

export async function backfillLegacyReportTenants(): Promise<void> {
  const [userRows, datasourceRows, datasetRows, dashboardRows, categoryRows, printRows, alertRows, subscriptionRows] = await Promise.all([
    db.select({ id: users.id, tenantId: users.tenantId }).from(users),
    db.select({ id: reportDatasources.id, tenantId: reportDatasources.tenantId, createdBy: reportDatasources.createdBy }).from(reportDatasources),
    db.select({ id: reportDatasets.id, tenantId: reportDatasets.tenantId, datasourceId: reportDatasets.datasourceId, createdBy: reportDatasets.createdBy }).from(reportDatasets),
    db.select({ id: reportDashboards.id, tenantId: reportDashboards.tenantId, createdBy: reportDashboards.createdBy }).from(reportDashboards),
    db.select({ id: reportDashboardCategories.id, tenantId: reportDashboardCategories.tenantId, createdBy: reportDashboardCategories.createdBy }).from(reportDashboardCategories),
    db.select({ id: reportPrintTemplates.id, tenantId: reportPrintTemplates.tenantId, datasetId: reportPrintTemplates.datasetId, createdBy: reportPrintTemplates.createdBy }).from(reportPrintTemplates),
    db.select({ id: reportAlertRules.id, tenantId: reportAlertRules.tenantId, datasetId: reportAlertRules.datasetId, createdBy: reportAlertRules.createdBy }).from(reportAlertRules),
    db.select({ id: reportDashboardSubscriptions.id, tenantId: reportDashboardSubscriptions.tenantId, dashboardId: reportDashboardSubscriptions.dashboardId, createdBy: reportDashboardSubscriptions.createdBy }).from(reportDashboardSubscriptions),
  ]);
  const userTenants = new Map(userRows.map((row) => [row.id, row.tenantId]));
  const createdTenant = (createdBy: number | null) => createdBy ? (userTenants.get(createdBy) ?? null) : null;
  const datasourceTenants = new Map(datasourceRows.map((row) => [
    row.id,
    row.tenantId ?? createdTenant(row.createdBy),
  ]));
  const datasetTenants = new Map(datasetRows.map((row) => [
    row.id,
    row.tenantId ?? datasourceTenants.get(row.datasourceId) ?? createdTenant(row.createdBy),
  ]));
  const dashboardTenants = new Map(dashboardRows.map((row) => [
    row.id,
    row.tenantId ?? createdTenant(row.createdBy),
  ]));

  await db.transaction(async (tx) => {
    for (const row of datasourceRows) {
      const tenantId = datasourceTenants.get(row.id);
      if (row.tenantId === null && tenantId != null) {
        await tx.update(reportDatasources).set({ tenantId }).where(eq(reportDatasources.id, row.id));
      }

    }
    for (const row of datasetRows) {
      const tenantId = datasetTenants.get(row.id);
      if (row.tenantId === null && tenantId != null) {
        await tx.update(reportDatasets).set({ tenantId }).where(eq(reportDatasets.id, row.id));
      }
    }
    for (const row of dashboardRows) {
      const tenantId = dashboardTenants.get(row.id);
      if (row.tenantId === null && tenantId != null) {
        await tx.update(reportDashboards).set({ tenantId }).where(eq(reportDashboards.id, row.id));
      }
    }
    for (const row of categoryRows) {
      const tenantId = row.tenantId ?? createdTenant(row.createdBy);
      if (row.tenantId === null && tenantId != null) {
        await tx.update(reportDashboardCategories).set({ tenantId })
          .where(eq(reportDashboardCategories.id, row.id));
      }
    }
    for (const row of printRows) {
      const tenantId = row.tenantId
        ?? (row.datasetId ? datasetTenants.get(row.datasetId) : null)
        ?? createdTenant(row.createdBy);
      if (row.tenantId === null && tenantId != null) {
        await tx.update(reportPrintTemplates).set({ tenantId }).where(eq(reportPrintTemplates.id, row.id));
      }
    }
    for (const row of alertRows) {
      const tenantId = row.tenantId ?? datasetTenants.get(row.datasetId) ?? createdTenant(row.createdBy);
      if (row.tenantId === null && tenantId != null) {
        await tx.update(reportAlertRules).set({ tenantId }).where(eq(reportAlertRules.id, row.id));
      }
    }
    for (const row of subscriptionRows) {
      const tenantId = row.tenantId ?? dashboardTenants.get(row.dashboardId) ?? createdTenant(row.createdBy);
      if (row.tenantId === null && tenantId != null) {
        await tx.update(reportDashboardSubscriptions).set({ tenantId })
          .where(eq(reportDashboardSubscriptions.id, row.id));
      }
    }
  });
}

export async function backfillLegacyDashboardLifecycle(): Promise<void> {
  const rows = await db.select().from(reportDashboards)
    .where(eq(reportDashboards.lifecycleInitialized, false));
  if (!rows.length) return;
  await db.transaction(async (tx) => {
    for (const row of rows) {
      const snapshot: ReportDashboardSnapshot = {
        name: row.name,
        layout: (row.layout ?? []) as ReportGridItem[],
        canvasLayout: (row.canvasLayout ?? []) as ReportCanvasItem[],
        widgets: (row.widgets ?? []) as ReportWidget[],
        filters: (row.filters ?? []) as ReportFilter[],
        config: (row.config ?? {}) as ReportDashboardConfig,
        categoryId: row.categoryId ?? null,
        remark: row.remark ?? null,
      };
      await tx.update(reportDashboards).set({
        lifecycleStatus: 'published',
        lifecycleInitialized: true,
        publishedSnapshot: snapshot,
        publishedAt: row.updatedAt,
      }).where(eq(reportDashboards.id, row.id));
    }
  });
}
