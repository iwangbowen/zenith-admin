import { useEffect, useRef, useCallback, useState } from 'react';
import { TOKEN_KEY } from '@zenith/shared/core';
import { wsAuthProtocols, type WsMessage } from '@zenith/shared/platform';
import { config } from '@/config';

type MessageHandler = (message: WsMessage) => void;
type StatusListener = (connected: boolean) => void;

/** Demo 模式无实时后端：跳过 WebSocket，避免反复连接/断开触发“已恢复”提示 */
const IS_DEMO = import.meta.env.VITE_DEMO_MODE === 'true';

const MAX_RECONNECT_DELAY = 30_000;
const BASE_RECONNECT_DELAY = 1_000;
/** 重连退避的随机抖动幅度（±50%）：服务重启 / 网络抖动时全体客户端不会在同一秒同时重连，摊平 WS 与补拉请求的尖峰 */
const RECONNECT_JITTER = 0.5;
/** 心跳间隔（毫秒）：每 25s 发一次 ping */
const HEARTBEAT_INTERVAL = 25_000;
/** 等待 pong 超时（毫秒）：超时则认为连接已断，主动关闭并重连 */
const PONG_TIMEOUT = 5_000;

const listeners = new Set<MessageHandler>();
const statusListeners = new Set<StatusListener>();

let sharedSocket: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | undefined;
let heartbeatTimer: ReturnType<typeof setInterval> | undefined;
let pongTimeoutTimer: ReturnType<typeof setTimeout> | undefined;
let reconnectRetries = 0;
let manuallyClosed = false;
let isConnectedState = false;

function clearReconnectTimer() {
  clearTimeout(reconnectTimer);
  reconnectTimer = undefined;
}

function clearHeartbeat() {
  clearInterval(heartbeatTimer);
  heartbeatTimer = undefined;
  clearTimeout(pongTimeoutTimer);
  pongTimeoutTimer = undefined;
}

function notifyStatus(connected: boolean) {
  isConnectedState = connected;
  for (const listener of statusListeners) {
    listener(connected);
  }
}

function scheduleReconnect() {
  if (reconnectTimer || manuallyClosed || listeners.size === 0) return;
  const baseDelay = Math.min(BASE_RECONNECT_DELAY * 2 ** reconnectRetries, MAX_RECONNECT_DELAY);
  const delay = Math.round(baseDelay * (1 + RECONNECT_JITTER * (2 * Math.random() - 1)));
  reconnectRetries += 1;
  reconnectTimer = setTimeout(() => connectSharedSocket(), delay);
}

/** access token 不进 URL（会落代理 / 访问日志），改经 Sec-WebSocket-Protocol 子协议传递 */
function buildWebSocketTarget(): { url: string; protocols: string[] } | null {
  const token = localStorage.getItem(TOKEN_KEY);
  if (!token) return null;

  let wsBase = config.wsBaseUrl;
  if (!wsBase) {
    const base = config.apiBaseUrl || globalThis.location.origin;
    wsBase = base.replace(/^http/, 'ws');
  }

  return { url: `${wsBase}/api/ws`, protocols: wsAuthProtocols(token) };
}

function notifyListeners(message: WsMessage) {
  for (const listener of listeners) {
    listener(message);
  }
}

function connectSharedSocket() {
  if (IS_DEMO) return;
  if (sharedSocket?.readyState === WebSocket.OPEN || sharedSocket?.readyState === WebSocket.CONNECTING) {
    return;
  }

  const target = buildWebSocketTarget();
  if (!target) return;

  manuallyClosed = false;
  clearReconnectTimer();

  const ws = new WebSocket(target.url, target.protocols);
  sharedSocket = ws;

  ws.onopen = () => {
    if (sharedSocket !== ws) return;
    reconnectRetries = 0;
    notifyStatus(true);
    // 启动心跳：定时发 ping，等待服务端 pong
    heartbeatTimer = setInterval(() => {
      if (sharedSocket?.readyState !== WebSocket.OPEN) return;
      try {
        sharedSocket.send(JSON.stringify({ type: 'ping' }));
      } catch { return; }
      // 如果 5s 内未收到 pong，认为连接已死，主动断开触发重连
      pongTimeoutTimer = setTimeout(() => {
        if (sharedSocket === ws) {
          sharedSocket = null;
          notifyStatus(false);
        }
        clearHeartbeat();
        try { ws.close(); } catch { /* ignore */ }
        scheduleReconnect();
      }, PONG_TIMEOUT);
    }, HEARTBEAT_INTERVAL);
  };

  ws.onmessage = (event) => {
    try {
      const raw = JSON.parse(event.data) as { type: string };
      // 心跳 pong：清除超时计时器，不广播给业务监听器
      if (raw?.type === 'pong') {
        clearTimeout(pongTimeoutTimer);
        pongTimeoutTimer = undefined;
        return;
      }
      const msg = raw as WsMessage;
      notifyListeners(msg);
    } catch {
      /* ignore malformed messages */
    }
  };

  ws.onclose = (event) => {
    if (sharedSocket === ws) {
      sharedSocket = null;
      notifyStatus(false);
    }
    clearHeartbeat();

    if (manuallyClosed || event.code === 1000 || listeners.size === 0) {
      return;
    }

    scheduleReconnect();
  };
}

function disconnectSharedSocket() {
  manuallyClosed = true;
  clearReconnectTimer();
  clearHeartbeat();

  if (sharedSocket) {
    const ws = sharedSocket;
    sharedSocket = null;
    notifyStatus(false);
    ws.close(1000, 'logout');
  }
}

export function sendWsMessage(msg: WsMessage) {
  if (sharedSocket?.readyState === WebSocket.OPEN) {
    sharedSocket.send(JSON.stringify(msg));
  }
}

/**
 * Generic WebSocket hook with auto-reconnect and exponential backoff.
 * Reuses one shared connection per page and fans out messages to subscribers.
 */
export function useWebSocket(onMessage: MessageHandler) {
  const onMessageRef = useRef(onMessage);

  useEffect(() => {
    onMessageRef.current = onMessage;
  });

  const listener = useCallback((message: WsMessage) => {
    onMessageRef.current(message);
  }, []);

  const disconnect = useCallback(() => {
    disconnectSharedSocket();
  }, []);

  useEffect(() => {
    listeners.add(listener);
    connectSharedSocket();

    return () => {
      listeners.delete(listener);
      if (listeners.size === 0) {
        disconnectSharedSocket();
      }
    };
  }, [listener]);

  return { disconnect };
}

/**
 * 返回 WebSocket 当前连接状态。
 * 断线（包括心跳超时、网络切换）时为 false，方便 UI 显示重连提示。
 */
export function useWsConnected(): boolean {
  const [connected, setConnected] = useState(IS_DEMO || isConnectedState);

  useEffect(() => {
    if (IS_DEMO) return;
    // 同步最新状态（组件挂载时 WS 可能已连接）
    setConnected(isConnectedState);
    statusListeners.add(setConnected);
    return () => {
      statusListeners.delete(setConnected);
    };
  }, []);

  return IS_DEMO ? true : connected;
}
