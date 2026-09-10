/**
 * 进程身份：同一主机上 api / worker 可并存（PM2、本地 split 开发），端口不再是唯一标识，
 * 统一用 hostname:pid。用于调度节点心跳、WS fan-out 自跳过、日志与指标标签。
 *
 * 终端会话仍用 hostname:port（`terminal-session-registry.ts`）：客户端重连要能落回持有 PTY 的实例，
 * 那是按监听端口而非进程区分的，语义不同，不在此合并。
 */
import os from 'node:os';

export const PROCESS_HOSTNAME = os.hostname();
export const PROCESS_PID = process.pid;
export const PROCESS_ID = `${PROCESS_HOSTNAME}:${PROCESS_PID}`;
