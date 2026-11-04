/**
 * 会员批量导入 Definition。
 * 落库复用 admin-members.service.createMember（等级兜底、积分/钱包账户初始化、唯一冲突翻译）。
 */
import { isNull } from 'drizzle-orm';
import { MEMBER_STATUS_LABELS, type MemberStatus } from '@zenith/shared/member';
import { db } from '../../../db/index';
import { memberLevels, members } from '../../../db/schema';
import { createMember } from '../admin-members.service';
import { registerImport } from '../../../lib/import-center/registry';

const STATUS_BY_LABEL = new Map(
  (Object.entries(MEMBER_STATUS_LABELS) as [MemberStatus, string][]).map(([value, label]) => [label, value]),
);

const PHONE_RE = /^1\d{10}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface MemberRow {
  nickname: string;
  phone?: string;
  email?: string;
  username?: string;
  password?: string;
  levelId: number | null;
  status: MemberStatus;
  remark?: string;
}

interface Prepared {
  levelByName: Map<string, number>;
  phones: Set<string>;
  emails: Set<string>;
  usernames: Set<string>;
}

export function registerMembersImport(): void {
  registerImport<MemberRow, Prepared>({
    entity: 'member.members',
    title: '会员',
    module: '会员中心',
    permission: 'member:member:create',
    description: '批量导入前台会员账号，自动初始化积分与钱包账户；手机号/邮箱/用户名全局唯一',
    columns: [
      { key: 'nickname', header: '昵称', required: true, example: '张三' },
      { key: 'phone', header: '手机号', example: '13800001111', note: '11 位大陆手机号' },
      { key: 'email', header: '邮箱', example: 'zhangsan@example.com' },
      { key: 'username', header: '用户名', example: 'zhangsan', note: '4-32 位字母数字下划线' },
      { key: 'password', header: '初始密码', note: '留空则仅能通过验证码登录' },
      { key: 'level', header: '等级名称', example: '普通会员', note: '留空按成长值自动匹配初始等级' },
      { key: 'status', header: '状态', enumValues: Object.values(MEMBER_STATUS_LABELS), example: '正常' },
      { key: 'remark', header: '备注' },
    ],
    async prepare() {
      const [levels, existing] = await Promise.all([
        db.select({ id: memberLevels.id, name: memberLevels.name }).from(memberLevels),
        db.select({ phone: members.phone, email: members.email, username: members.username })
          .from(members).where(isNull(members.deletedAt)),
      ]);
      return {
        levelByName: new Map(levels.map((l) => [l.name, l.id])),
        phones: new Set(existing.map((m) => m.phone).filter((v): v is string => !!v)),
        emails: new Set(existing.map((m) => m.email).filter((v): v is string => !!v)),
        usernames: new Set(existing.map((m) => m.username).filter((v): v is string => !!v)),
      };
    },
    parseRow(cells, prepared) {
      const nickname = cells.nickname;
      if (!nickname) throw new Error('昵称为必填项');
      if (nickname.length > 32) throw new Error('昵称最长 32 字符');
      if (!cells.phone && !cells.email && !cells.username) {
        throw new Error('手机号、邮箱、用户名至少填写一项（否则会员无法登录）');
      }
      if (cells.phone) {
        if (!PHONE_RE.test(cells.phone)) throw new Error(`手机号格式不正确：${cells.phone}`);
        if (prepared.phones.has(cells.phone)) throw new Error(`手机号已存在：${cells.phone}`);
      }
      if (cells.email) {
        if (!EMAIL_RE.test(cells.email)) throw new Error(`邮箱格式不正确：${cells.email}`);
        if (prepared.emails.has(cells.email)) throw new Error(`邮箱已存在：${cells.email}`);
      }
      if (cells.username) {
        if (!/^\w{4,32}$/.test(cells.username)) throw new Error('用户名需为 4-32 位字母、数字或下划线');
        if (prepared.usernames.has(cells.username)) throw new Error(`用户名已存在：${cells.username}`);
      }
      if (cells.password && cells.password.length < 6) throw new Error('初始密码至少 6 位');
      let levelId: number | null = null;
      if (cells.level) {
        const id = prepared.levelByName.get(cells.level);
        if (!id) throw new Error(`等级名称不存在：${cells.level}`);
        levelId = id;
      }
      let status: MemberStatus = 'active';
      if (cells.status) {
        const mapped = STATUS_BY_LABEL.get(cells.status);
        if (!mapped) throw new Error(`状态值无效：${cells.status}（可选：${Object.values(MEMBER_STATUS_LABELS).join(' / ')}）`);
        status = mapped;
      }
      return {
        nickname,
        phone: cells.phone || undefined,
        email: cells.email || undefined,
        username: cells.username || undefined,
        password: cells.password || undefined,
        levelId,
        status,
        remark: cells.remark || undefined,
      };
    },
    async insertRow(row, prepared) {
      await createMember({ ...row, registerSource: 'import' });
      // 内存查重集合同步追加：拦截同一文件内的重复行
      if (row.phone) prepared.phones.add(row.phone);
      if (row.email) prepared.emails.add(row.email);
      if (row.username) prepared.usernames.add(row.username);
    },
    rowLabel: (row) => row.nickname,
  });
}
