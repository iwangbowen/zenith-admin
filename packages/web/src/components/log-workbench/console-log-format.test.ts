import { describe, expect, it } from 'vitest';
import { formatConsoleLogLine } from './console-log-format';

describe('formatConsoleLogLine', () => {
  it('使用本地时间和级别显示正文，忽略 pid/hostname 并保留链路与元数据', () => {
    const localTime = new Date(2026, 9, 23, 16, 8, 5);
    const entry = {
      level: 30, time: localTime.toISOString(), pid: 123, hostname: 'server-01',
      role: 'api', correlationId: 'request-123', msg: '启动成功', count: 0, enabled: false, details: { keys: ['中文'] },
    };
    expect(formatConsoleLogLine(JSON.stringify(entry))).toBe('[2026-10-23 16:08:05] INFO: 启动成功 {"role":"api","correlationId":"request-123","count":0,"enabled":false,"details":{"keys":["中文"]}}');
    expect(formatConsoleLogLine(JSON.stringify({ level: 20, time: localTime.getTime(), msg: 'epoch' }))).toBe('[2026-10-23 16:08:05] DEBUG: epoch');
  });

  it('err/error 错误栈展开真实多行，保留错误类型、错误码与嵌套原因', () => {
    const err = { type: 'Error', message: '读取失败', stack: 'Error: 读取失败\r\n    at read (reader.ts:42)', code: 'EACCES', cause: { message: 'denied' } };
    expect(formatConsoleLogLine(JSON.stringify({ level: 50, msg: '作业失败', err }))).toBe('ERROR: 作业失败 {"err":{"type":"Error","message":"读取失败","code":"EACCES","cause":{"message":"denied"}}}\n    Error: 读取失败\n        at read (reader.ts:42)');
    expect(formatConsoleLogLine(JSON.stringify({ level: 60, error: { stack: 'fatal stack' } }))).toBe('FATAL:\n    fatal stack');
  });

  it('console 多行正文、无法解析的输出和非日志 JSON 保持可读且不丢字段', () => {
    expect(formatConsoleLogLine('{"level":"warn","msg":"第一行\\n第二行","time":"invalid"}')).toBe('WARN: 第一行\n第二行 {"time":"invalid"}');
    for (const line of ['plain text', '{partial json', '{"answer":42}', '[]', 'null', '{"level":"constructor","msg":"unknown"}']) {
      expect(formatConsoleLogLine(line)).toBe(line);
    }
  });
});
