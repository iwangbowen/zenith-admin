import type { NodeSDK } from '@opentelemetry/sdk-node';
import { config } from '../config';
import logger from './logger';

let telemetrySdk: NodeSDK | null = null;
let telemetryInitialized = false;

export const initTelemetry = async (): Promise<boolean> => {
  if (!config.otel.enabled) {
    return false;
  }

  if (telemetryInitialized) {
    return true;
  }

  try {
    // 惰性加载：@opentelemetry/sdk-node 模块图很大（实测数秒），仅在启用 OTel 时才引入
    const [{ NodeSDK }, { OTLPTraceExporter }, { UndiciInstrumentation }] = await Promise.all([
      import('@opentelemetry/sdk-node'),
      import('@opentelemetry/exporter-trace-otlp-http'),
      import('@opentelemetry/instrumentation-undici'),
    ]);
    // 进程角色进 resource：api / worker 拆分部署后同一 service 的 span 可按角色区分。
    // 走 SDK 自带的 env 资源探测（OTEL_RESOURCE_ATTRIBUTES），不直接依赖 @opentelemetry/resources
    const roleAttribute = `zenith.process.role=${config.roles.label}`;
    const existingAttributes = process.env.OTEL_RESOURCE_ATTRIBUTES?.trim();
    if (!existingAttributes?.includes('zenith.process.role=')) {
      process.env.OTEL_RESOURCE_ATTRIBUTES = existingAttributes ? `${existingAttributes},${roleAttribute}` : roleAttribute;
    }
    telemetrySdk = new NodeSDK({
      serviceName: config.otel.serviceName,
      traceExporter: new OTLPTraceExporter(),
      // 出站 HTTP（Node 全局 fetch / undici）span：基于 diagnostics_channel 订阅，
      // 不做模块补丁，因此对模块加载顺序不敏感，可在此处安全启用。
      //
      // 有意未插桩的层（评估于 2026-08，复查时先确认上游支持范围）：
      //  - ioredis：官方 instrumentation-ioredis 仅支持 >=2 <6，本项目为 ioredis 6，挂载会被静默拒绝；
      //    若未来升级支持 v6，需注意其基于 require 补丁，必须让 SDK 先于 ioredis 模块加载
      //    （届时需把 initTelemetry 拆到独立入口、动态 import 其余启动逻辑）
      //  - postgres-js：无官方 instrumentation（instrumentation-pg 仅支持 pg）
      instrumentations: [new UndiciInstrumentation()],
    });
    telemetrySdk.start();
    telemetryInitialized = true;

    logger.info('OpenTelemetry tracing enabled', {
      serviceName: config.otel.serviceName,
      serviceVersion: config.otel.serviceVersion,
    });

    return true;
  } catch (error) {
    telemetrySdk = null;
    telemetryInitialized = false;
    logger.error('Failed to initialize OpenTelemetry tracing', error);
    return false;
  }
};

export const shutdownTelemetry = async (): Promise<void> => {
  if (!telemetrySdk || !telemetryInitialized) {
    return;
  }

  try {
    await telemetrySdk.shutdown();
  } catch (error) {
    logger.error('Failed to shutdown OpenTelemetry tracing', error);
  } finally {
    telemetrySdk = null;
    telemetryInitialized = false;
  }
};
