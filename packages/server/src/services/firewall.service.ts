import os from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const EXEC_OPTIONS = { timeout: 5000, maxBuffer: 1024 * 1024 } as const;

type FirewallType = 'ufw' | 'firewalld' | 'iptables' | 'unknown';
type FirewallRuleAction = 'allow' | 'deny' | 'reject';
type FirewallProtocol = 'tcp' | 'udp' | 'any';
type FirewallDirection = 'in' | 'out' | 'any';

export interface FirewallStatus {
  enabled: boolean;
  type: FirewallType;
  version: string | null;
  defaultIncoming: string | null;
  defaultOutgoing: string | null;
}

export interface FirewallRule {
  id: string;
  type: FirewallRuleAction;
  protocol: FirewallProtocol;
  port: string;
  from: string;
  to: string;
  direction: FirewallDirection;
  comment: string | null;
  raw?: string;
}

export interface AddFirewallRuleInput {
  type: FirewallRuleAction;
  protocol: FirewallProtocol;
  port: string;
  from: string;
  to: string;
  direction: FirewallDirection;
  comment?: string;
}

const WINDOWS_STATUS: FirewallStatus = {
  enabled: false,
  type: 'unknown',
  version: null,
  defaultIncoming: null,
  defaultOutgoing: null,
};

const UNKNOWN_STATUS: FirewallStatus = { ...WINDOWS_STATUS };

function isWindows(): boolean {
  return os.platform() === 'win32';
}

async function execCommand(file: string, args: string[]): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, EXEC_OPTIONS);
    return [stdout, stderr].filter(Boolean).join('\n').trim();
  } catch {
    return null;
  }
}

async function detectVersion(file: string, args: string[], pattern: RegExp): Promise<string | null> {
  const output = await execCommand(file, args);
  if (!output) return null;
  const match = pattern.exec(output);
  return match?.[1] ?? output.split(/\s+/).find(Boolean) ?? null;
}

async function detectFirewall(): Promise<{ type: FirewallType; version: string | null }> {
  if (isWindows()) return { type: 'unknown', version: null };

  const ufwVersion = await detectVersion('ufw', ['version'], /ufw\s+([\w.-]+)/i);
  if (ufwVersion) return { type: 'ufw', version: ufwVersion };

  const firewalldVersion = await detectVersion('firewall-cmd', ['--version'], /([\d.]+)/);
  if (firewalldVersion) return { type: 'firewalld', version: firewalldVersion };

  const iptablesVersion = await detectVersion('iptables', ['--version'], /v([\d.]+)/i);
  if (iptablesVersion) return { type: 'iptables', version: iptablesVersion };

  return { type: 'unknown', version: null };
}

function normalizeRuleAction(value: string): FirewallRuleAction {
  const lowered = value.trim().toLowerCase();
  if (lowered.includes('reject')) return 'reject';
  if (lowered.includes('deny') || lowered.includes('drop')) return 'deny';
  return 'allow';
}

function normalizeProtocol(value: string | null | undefined): FirewallProtocol {
  const lowered = (value ?? '').trim().toLowerCase();
  if (lowered === 'tcp' || lowered === 'udp') return lowered;
  return 'any';
}

function normalizeDirection(value: string | null | undefined): FirewallDirection {
  const lowered = (value ?? '').trim().toLowerCase();
  if (lowered === 'in' || lowered === 'out') return lowered;
  return 'any';
}

function cleanupValue(value: string | null | undefined, fallback = 'any'): string {
  const trimmed = (value ?? '').trim();
  return trimmed ? trimmed : fallback;
}

function sanitizeComment(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function parseUfwTarget(target: string): { port: string; protocol: FirewallProtocol; to: string } {
  const cleaned = target.replace(/\s*\(v6\)$/i, '').trim();
  const match = /^(?<port>[^/\s]+(?:[:-][^/\s]+)?)\/(?<protocol>tcp|udp)$/i.exec(cleaned);
  if (match?.groups) {
    return {
      port: match.groups.port,
      protocol: normalizeProtocol(match.groups.protocol),
      to: 'any',
    };
  }

  if (/^any(where)?$/i.test(cleaned)) {
    return { port: 'any', protocol: 'any', to: 'any' };
  }

  return { port: cleaned || 'any', protocol: 'any', to: cleaned || 'any' };
}

function parseUfwDefault(output: string, key: 'incoming' | 'outgoing'): string | null {
  const match = new RegExp(`([a-z]+)\\s*\\(${key}\\)`, 'i').exec(output);
  return match?.[1]?.toLowerCase() ?? null;
}

async function getUfwStatus(version: string | null): Promise<FirewallStatus> {
  const output = await execCommand('ufw', ['status', 'verbose']);
  if (!output) return UNKNOWN_STATUS;

  return {
    enabled: /status:\s+active/i.test(output),
    type: 'ufw',
    version,
    defaultIncoming: parseUfwDefault(output, 'incoming'),
    defaultOutgoing: parseUfwDefault(output, 'outgoing'),
  };
}

async function listUfwRules(): Promise<{ type: FirewallType; rules: FirewallRule[] }> {
  const output = await execCommand('ufw', ['status', 'numbered']);
  if (!output) return { type: 'unknown', rules: [] };
  if (/status:\s+inactive/i.test(output)) return { type: 'ufw', rules: [] };

  const rules: FirewallRule[] = [];
  for (const line of output.split(/\r?\n/)) {
    const match = /^\[\s*(\d+)\]\s+(.+?)\s{2,}(.+?)\s{2,}(.+)$/.exec(line.trim());
    if (!match) continue;

    const [, id, targetText, actionText, sourceText] = match;
    const [fromText, commentText] = sourceText.split(/\s+#\s*/, 2);
    const actionParts = actionText.trim().split(/\s+/);
    const parsedTarget = parseUfwTarget(targetText);

    rules.push({
      id,
      type: normalizeRuleAction(actionParts[0] ?? 'allow'),
      protocol: parsedTarget.protocol,
      port: parsedTarget.port,
      from: cleanupValue(fromText),
      to: parsedTarget.to,
      direction: normalizeDirection(actionParts[1]),
      comment: sanitizeComment(commentText),
      raw: line.trim(),
    });
  }

  return { type: 'ufw', rules };
}

async function getFirewalldStatus(version: string | null): Promise<FirewallStatus> {
  const state = await execCommand('firewall-cmd', ['--state']);
  if (!state) return UNKNOWN_STATUS;

  const listAll = await execCommand('firewall-cmd', ['--list-all']);
  const targetMatch = listAll ? /target:\s*(\S+)/i.exec(listAll) : null;

  return {
    enabled: /running/i.test(state),
    type: 'firewalld',
    version,
    defaultIncoming: targetMatch?.[1]?.toLowerCase() ?? null,
    defaultOutgoing: null,
  };
}

function parseFirewalldRichRule(raw: string, index: number): FirewallRule {
  const source = /source address="([^"]+)"/i.exec(raw)?.[1] ?? 'any';
  const destination = /destination address="([^"]+)"/i.exec(raw)?.[1] ?? 'any';
  const port = /port port="([^"]+)"/i.exec(raw)?.[1] ?? 'any';
  const protocol = /protocol="(tcp|udp)"/i.exec(raw)?.[1] ?? 'any';
  const typeMatch = /\b(accept|drop|reject)\b/i.exec(raw)?.[1] ?? 'accept';

  return {
    id: `rich:${index}`,
    type: normalizeRuleAction(typeMatch),
    protocol: normalizeProtocol(protocol),
    port,
    from: source,
    to: destination,
    direction: 'in',
    comment: null,
    raw,
  };
}

async function listFirewalldRules(): Promise<{ type: FirewallType; rules: FirewallRule[] }> {
  const status = await execCommand('firewall-cmd', ['--state']);
  if (!status) return { type: 'unknown', rules: [] };
  if (!/running/i.test(status)) return { type: 'firewalld', rules: [] };

  const output = await execCommand('firewall-cmd', ['--list-all']);
  if (!output) return { type: 'unknown', rules: [] };

  const rules: FirewallRule[] = [];
  const richRules: string[] = [];
  let collectingRichRules = false;

  for (const rawLine of output.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    if (/^ports:\s*/i.test(line)) {
      const ports = line.replace(/^ports:\s*/i, '').trim().split(/\s+/).filter(Boolean);
      ports.forEach((entry) => {
        const [port, protocol] = entry.split('/');
        rules.push({
          id: `port:${entry}`,
          type: 'allow',
          protocol: normalizeProtocol(protocol),
          port: cleanupValue(port),
          from: 'any',
          to: 'any',
          direction: 'in',
          comment: null,
          raw: entry,
        });
      });
      collectingRichRules = false;
      continue;
    }

    if (/^rich rules:/i.test(line)) {
      collectingRichRules = true;
      continue;
    }

    if (collectingRichRules) {
      richRules.push(line);
    }
  }

  richRules.forEach((rule, index) => rules.push(parseFirewalldRichRule(rule, index + 1)));
  return { type: 'firewalld', rules };
}

function parseIptablesPolicies(output: string): Pick<FirewallStatus, 'defaultIncoming' | 'defaultOutgoing' | 'enabled'> {
  const inputPolicy = /Chain\s+INPUT\s+\(policy\s+(\w+)\)/i.exec(output)?.[1] ?? null;
  const outputPolicy = /Chain\s+OUTPUT\s+\(policy\s+(\w+)\)/i.exec(output)?.[1] ?? null;
  const ruleCount = output.split(/\r?\n/).filter((line) => /^\s*\d+\s+/.test(line)).length;

  const enabled = ruleCount > 0
    || (inputPolicy !== null && inputPolicy.toUpperCase() !== 'ACCEPT')
    || (outputPolicy !== null && outputPolicy.toUpperCase() !== 'ACCEPT');

  return {
    enabled,
    defaultIncoming: inputPolicy?.toLowerCase() ?? null,
    defaultOutgoing: outputPolicy?.toLowerCase() ?? null,
  };
}

async function getIptablesStatus(version: string | null): Promise<FirewallStatus> {
  const output = await execCommand('iptables', ['-L', '-n', '--line-numbers']);
  if (!output) return UNKNOWN_STATUS;

  const policies = parseIptablesPolicies(output);
  return {
    enabled: policies.enabled,
    type: 'iptables',
    version,
    defaultIncoming: policies.defaultIncoming,
    defaultOutgoing: policies.defaultOutgoing,
  };
}

async function listIptablesRules(): Promise<{ type: FirewallType; rules: FirewallRule[] }> {
  const output = await execCommand('iptables', ['-L', '-n', '--line-numbers']);
  if (!output) return { type: 'unknown', rules: [] };

  const rules: FirewallRule[] = [];
  let currentChain = '';

  for (const line of output.split(/\r?\n/)) {
    const chainMatch = /^Chain\s+(INPUT|OUTPUT|FORWARD)\s+\(policy\s+\w+\)/i.exec(line.trim());
    if (chainMatch) {
      currentChain = chainMatch[1].toUpperCase();
      continue;
    }
    if (!/^\s*\d+\s+/.test(line) || !currentChain) continue;

    const parts = line.trim().split(/\s+/);
    if (parts.length < 6) continue;

    const number = parts[0] ?? '';
    const target = parts[1] ?? 'ACCEPT';
    const protocol = parts[2] ?? 'all';
    const source = parts[4] ?? 'any';
    const destination = parts[5] ?? 'any';
    const port = /dpt:(\S+)/i.exec(line)?.[1] ?? 'any';

    rules.push({
      id: `${currentChain}:${number}`,
      type: normalizeRuleAction(target),
      protocol: normalizeProtocol(protocol === 'all' ? 'any' : protocol),
      port,
      from: cleanupValue(source),
      to: cleanupValue(destination),
      direction: currentChain === 'INPUT' ? 'in' : currentChain === 'OUTPUT' ? 'out' : 'any',
      comment: null,
      raw: line.trim(),
    });
  }

  return { type: 'iptables', rules };
}

async function reloadFirewalld(): Promise<void> {
  await execCommand('firewall-cmd', ['--reload']);
}

async function addUfwRule(input: AddFirewallRuleInput): Promise<void> {
  const args: string[] = [input.type];
  if (input.direction !== 'any') args.push(input.direction);
  args.push('from', cleanupValue(input.from), 'to', cleanupValue(input.to));
  if (input.port !== 'any') args.push('port', input.port.trim());
  if (input.protocol !== 'any') args.push('proto', input.protocol);
  const comment = sanitizeComment(input.comment);
  if (comment) args.push('comment', comment);
  await execCommand('ufw', args);
}

function buildFirewalldRichRule(input: AddFirewallRuleInput, protocol: Exclude<FirewallProtocol, 'any'>): string {
  const segments = ['rule'];
  if (input.from !== 'any') segments.push(`source address="${input.from}"`);
  if (input.to !== 'any') segments.push(`destination address="${input.to}"`);
  if (input.port !== 'any') segments.push(`port port="${input.port}" protocol="${protocol}"`);
  segments.push(input.type === 'allow' ? 'accept' : input.type === 'deny' ? 'drop' : 'reject');
  return segments.join(' ');
}

async function addFirewalldRule(input: AddFirewallRuleInput): Promise<void> {
  const requiresRichRule = input.type !== 'allow'
    || input.from !== 'any'
    || input.to !== 'any'
    || input.protocol === 'any'
    || input.direction !== 'in';

  if (!requiresRichRule && input.port !== 'any') {
    await execCommand('firewall-cmd', ['--permanent', `--add-port=${input.port}/${input.protocol}`]);
    await reloadFirewalld();
    return;
  }

  const protocols: Exclude<FirewallProtocol, 'any'>[] = input.protocol === 'any' ? ['tcp', 'udp'] : [input.protocol];
  for (const protocol of protocols) {
    await execCommand('firewall-cmd', ['--permanent', `--add-rich-rule=${buildFirewalldRichRule(input, protocol)}`]);
  }
  await reloadFirewalld();
}

async function addIptablesRule(input: AddFirewallRuleInput): Promise<void> {
  const chain = input.direction === 'out' ? 'OUTPUT' : 'INPUT';
  const target = input.type === 'allow' ? 'ACCEPT' : input.type === 'deny' ? 'DROP' : 'REJECT';
  const protocols: FirewallProtocol[] = input.protocol === 'any' && input.port !== 'any'
    ? ['tcp', 'udp']
    : [input.protocol];

  for (const protocol of protocols) {
    const args = ['-A', chain];
    if (protocol !== 'any') args.push('-p', protocol);
    if (input.from !== 'any') args.push('-s', input.from);
    if (input.to !== 'any') args.push('-d', input.to);
    if (input.port !== 'any') args.push('--dport', input.port);
    args.push('-j', target);
    await execCommand('iptables', args);
  }
}

async function deleteUfwRule(id: string): Promise<void> {
  await execCommand('ufw', ['--force', 'delete', id]);
}

async function deleteFirewalldRule(id: string): Promise<void> {
  if (id.startsWith('port:')) {
    await execCommand('firewall-cmd', ['--permanent', `--remove-port=${id.slice(5)}`]);
    await reloadFirewalld();
    return;
  }

  const { rules } = await listFirewalldRules();
  const rule = rules.find((item) => item.id === id);
  if (!rule?.raw) return;

  await execCommand('firewall-cmd', ['--permanent', `--remove-rich-rule=${rule.raw}`]);
  await reloadFirewalld();
}

async function deleteIptablesRule(id: string): Promise<void> {
  const [chain, lineNumber] = id.split(':', 2);
  if (!chain || !lineNumber) return;
  await execCommand('iptables', ['-D', chain, lineNumber]);
}

async function setUfwEnabled(enabled: boolean): Promise<void> {
  await execCommand('ufw', ['--force', enabled ? 'enable' : 'disable']);
}

async function setFirewalldEnabled(enabled: boolean): Promise<void> {
  await execCommand('systemctl', [enabled ? 'start' : 'stop', 'firewalld']);
}

async function setIptablesEnabled(enabled: boolean): Promise<void> {
  if (enabled) return;

  await execCommand('iptables', ['-P', 'INPUT', 'ACCEPT']);
  await execCommand('iptables', ['-P', 'FORWARD', 'ACCEPT']);
  await execCommand('iptables', ['-P', 'OUTPUT', 'ACCEPT']);
  await execCommand('iptables', ['-F']);
}

export async function getFirewallStatus(): Promise<FirewallStatus> {
  if (isWindows()) return WINDOWS_STATUS;

  const detected = await detectFirewall();
  switch (detected.type) {
    case 'ufw':
      return getUfwStatus(detected.version);
    case 'firewalld':
      return getFirewalldStatus(detected.version);
    case 'iptables':
      return getIptablesStatus(detected.version);
    default:
      return UNKNOWN_STATUS;
  }
}

export async function listFirewallRules(): Promise<{ type: FirewallStatus['type']; rules: FirewallRule[] }> {
  if (isWindows()) return { type: 'unknown', rules: [] };

  const detected = await detectFirewall();
  switch (detected.type) {
    case 'ufw':
      return listUfwRules();
    case 'firewalld':
      return listFirewalldRules();
    case 'iptables':
      return listIptablesRules();
    default:
      return { type: 'unknown', rules: [] };
  }
}

export async function addFirewallRule(input: AddFirewallRuleInput): Promise<void> {
  if (isWindows()) return;

  const normalizedInput: AddFirewallRuleInput = {
    ...input,
    port: cleanupValue(input.port),
    from: cleanupValue(input.from),
    to: cleanupValue(input.to),
    comment: sanitizeComment(input.comment) ?? undefined,
  };

  const detected = await detectFirewall();
  switch (detected.type) {
    case 'ufw':
      await addUfwRule(normalizedInput);
      return;
    case 'firewalld':
      await addFirewalldRule(normalizedInput);
      return;
    case 'iptables':
      await addIptablesRule(normalizedInput);
      return;
    default:
      return;
  }
}

export async function deleteFirewallRule(id: string): Promise<void> {
  if (isWindows()) return;

  const detected = await detectFirewall();
  switch (detected.type) {
    case 'ufw':
      await deleteUfwRule(id);
      return;
    case 'firewalld':
      await deleteFirewalldRule(id);
      return;
    case 'iptables':
      await deleteIptablesRule(id);
      return;
    default:
      return;
  }
}

export async function setFirewallEnabled(enabled: boolean): Promise<void> {
  if (isWindows()) return;

  const detected = await detectFirewall();
  switch (detected.type) {
    case 'ufw':
      await setUfwEnabled(enabled);
      return;
    case 'firewalld':
      await setFirewalldEnabled(enabled);
      return;
    case 'iptables':
      await setIptablesEnabled(enabled);
      return;
    default:
      return;
  }
}
