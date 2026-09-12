import { useMemo, useState } from 'react';
import ModalFooter from '@/components/ModalFooter';
import { Divider, Form, Modal, SideSheet, Spin, Tag, Toast, Typography, Row, Col } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import ConfigurableTable from '@/components/ConfigurableTable';
import { CronBuilderPopover } from '@/components/CronBuilderPopover';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { FilterSelect, KeywordInput, StatusSelect } from '@/components/search-filters';
import { CreateButton } from '@/components/toolbar-controls';
import { dateTimeColumn, renderEllipsis, EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { useDictItems } from '@/hooks/useDictItems';
import { useEditModal } from '@/hooks/useEditModal';
import { usePermission } from '@/hooks/usePermission';
import { useListSearch } from '@/hooks/useListSearch';
import { compactParams } from '@/lib/query';
import { deleteAction, ListSearchToolbar, listTableProps, useStatusToggle } from '@/components/list-page';
import {
  directorySyncSourceKeys, useDirectorySyncSourceList, useDirectorySyncSourceDetail,
  useSaveDirectorySyncSource, useDeleteDirectorySyncSources,
  useTestDirectorySyncSource, useRunDirectorySyncSource, usePreviewDirectorySyncSource,
} from '@/hooks/queries/directory-sync';
import { useIdentityProviderList } from '@/hooks/queries/identity-providers';
import { useAllRoles } from '@/hooks/queries/roles';
import { directorySyncSourceContract, type DirectorySyncSource } from '@zenith/shared/identity';
import { USER_STATUSES, enumValueOf, type BodyOf } from '@zenith/shared/core';
import {
  SUPER_ADMIN_CODE,
  DIRECTORY_SYNC_SOURCE_TYPES, DIRECTORY_SYNC_SOURCE_TYPE_LABELS,
  DIRECTORY_SYNC_MATCH_KEYS, DIRECTORY_SYNC_MATCH_KEY_LABELS,
  DIRECTORY_SYNC_CONFLICT_POLICIES, DIRECTORY_SYNC_CONFLICT_POLICY_LABELS,
  DIRECTORY_SYNC_RUN_STATUS_LABELS,
  DIRECTORY_SYNC_CALLBACK_TYPES, DIRECTORY_SYNC_MAPPABLE_SOURCE_FIELDS,
  DIRECTORY_SYNC_SOURCE_FIELD_LABELS, DIRECTORY_SYNC_FIELD_IGNORE,
} from '@zenith/shared/identity';
import { DIRECTORY_SYNC_RUN_STATUS_TAG_COLOR } from './directory-sync-tag-colors';

const CALLBACK_TYPE_SET = new Set<string>(DIRECTORY_SYNC_CALLBACK_TYPES);

/** 保存载荷：创建入参的部分形态；密钥字段空串表示不修改，提交前在 beforeSave 收敛 */
type DirectorySyncSourceSavePayload = Partial<BodyOf<typeof directorySyncSourceContract.create>>;

/** 表单值：以实体字段为底，另带三个只写的密钥字段 */
type DirectorySyncSourceFormValues = Partial<DirectorySyncSource> & {
  contactSecret?: string | null;
  callbackToken?: string | null;
  callbackAesKey?: string | null;
};

const MAPPING_SOURCE_OPTIONS = DIRECTORY_SYNC_MAPPABLE_SOURCE_FIELDS.map((f) => ({
  value: f,
  label: DIRECTORY_SYNC_SOURCE_FIELD_LABELS[f],
}));

interface SearchParams {
  keyword: string;
  type?: string;
  status?: string;
}

const defaultSearchParams: SearchParams = { keyword: '', type: undefined, status: undefined };

export default function DirectorySyncSourcesPage() {
  const { hasPermission } = usePermission();

  const {
    page, pageSize, buildPagination,
    bind, bindKeyword, submittedParams,
    handleSearch, handleReset,
  } = useListSearch<SearchParams>({ defaults: defaultSearchParams, listKey: directorySyncSourceKeys.lists });

  // 已提交筛选 → 契约查询参数：只映射一次
  const filterQuery = useMemo(() => compactParams({
    keyword: submittedParams.keyword,
    type: enumValueOf(DIRECTORY_SYNC_SOURCE_TYPES, submittedParams.type),
    status: enumValueOf(USER_STATUSES, submittedParams.status),
  }), [submittedParams]);

  const listQuery = useDirectorySyncSourceList({ page, pageSize, ...filterQuery });

  // LDAP 绑定下拉：复用身份源域的列表查询（该域无 /all 端点）
  const providersQuery = useIdentityProviderList({ page: 1, pageSize: 100 });
  const ldapProviders = useMemo(
    () => (providersQuery.data?.list ?? []).filter((p) => p.type === 'ldap' || p.type === 'ad'),
    [providersQuery.data],
  );
  const rolesQuery = useAllRoles();
  // 自动建号永不授予平台保留角色（服务端同样拒绝），下拉里直接不给选
  const roleOptions = (rolesQuery.data ?? [])
    .filter((r) => r.code !== SUPER_ADMIN_CODE)
    .map((r) => ({ value: r.id, label: r.name }));

  const modal = useEditModal<DirectorySyncSource, DirectorySyncSourceFormValues, DirectorySyncSourceSavePayload>({
    entityName: '同步源',
    save: useSaveDirectorySyncSource(),
    useDetail: useDirectorySyncSourceDetail,
    defaults: {
      type: 'ldap',
      status: 'disabled',
      matchKey: 'phone',
      conflictPolicy: 'suspend',
      syncDepartments: true,
      circuitBreakerPercent: 30,
      lifecycle: { disableOnLeave: true, kickSessions: true, defaultRoleIds: [] },
    },
    toValues: (r) => ({
      name: r.name,
      type: r.type,
      status: r.status,
      identityProviderId: r.identityProviderId,
      oauthProvider: r.oauthProvider,
      matchKey: r.matchKey,
      conflictPolicy: r.conflictPolicy,
      syncDepartments: r.syncDepartments,
      cronExpression: r.cronExpression,
      circuitBreakerPercent: r.circuitBreakerPercent,
      lifecycle: r.lifecycle,
      scopeConfig: r.scopeConfig,
      fieldMapping: r.fieldMapping,
      remark: r.remark,
    }),
    beforeSave: (v): DirectorySyncSourceSavePayload => {
      const isPlatform = v.type !== 'ldap' && v.type !== 'scim';
      // 清掉映射里的空值（= 跟随默认）
      const fieldMapping = Object.fromEntries(
        Object.entries(v.fieldMapping ?? {}).filter(([, value]) => typeof value === 'string' && value !== ''),
      );
      return {
        ...v,
        remark: v.remark ?? undefined,
        fieldMapping,
        // 绑定字段按类型收敛，避免残留另一类型的绑定
        identityProviderId: v.type === 'ldap' ? v.identityProviderId : null,
        oauthProvider: isPlatform ? v.type : null,
        // 空串 = 不修改已保存的密钥
        contactSecret: v.type === 'wechat_work' && v.contactSecret?.trim() ? v.contactSecret.trim() : undefined,
        callbackToken: v.callbackToken?.trim() ? v.callbackToken.trim() : undefined,
        callbackAesKey: v.callbackAesKey?.trim() ? v.callbackAesKey.trim() : undefined,
        cronExpression: v.type === 'scim' ? null : (v.cronExpression?.trim() ? v.cronExpression.trim() : null),
      };
    },
    labelWidth: 110,
  });

  const toggleStatusMutation = useSaveDirectorySyncSource();
  const deleteMutation = useDeleteDirectorySyncSources();
  const testMutation = useTestDirectorySyncSource();
  const runMutation = useRunDirectorySyncSource();
  const previewMutation = usePreviewDirectorySyncSource();
  const [testingId, setTestingId] = useState<number | null>(null);

  const { items: statusItems } = useDictItems('common_status');

  const status = useStatusToggle<DirectorySyncSource>({
    toggle: (record, enabled) => toggleStatusMutation.mutateAsync({ id: record.id, values: { status: enabled ? 'enabled' : 'disabled' } }),
    confirmDisable: (record) => ({ title: '确认停用', content: `停用后「${record.name}」将不再自动同步，确认停用？` }),
    disabled: !hasPermission('system:dirsync-source:edit'),
    messages: { enabled: '已启用，将按 cron 表达式自动同步' },
  });

  function handleTest(record: DirectorySyncSource) {
    setTestingId(record.id);
    testMutation.mutate({ params: { id: record.id } }, {
      onSuccess: (result) => {
        if (result.ok) {
          const sample = result.sampleUsers.map((u) => u.nickname || u.username).join('、');
          Modal.info({
            title: '连接成功',
            content: sample ? `${result.message}：${sample}` : result.message,
            closeOnEsc: true,
          });
        } else {
          Modal.error({ title: '连接失败', content: result.message, closeOnEsc: true });
        }
      },
      onSettled: () => setTestingId(null),
    });
  }

  function handleRun(record: DirectorySyncSource, dryRun: boolean) {
    const doRun = () => {
      const submit = dryRun ? previewMutation : runMutation;
      submit.mutate({ params: { id: record.id } }, {
        onSuccess: () => Toast.success(
          dryRun ? '预览任务已提交，请稍后在「同步记录」查看差异（预览不落库）' : '同步任务已提交，可在「同步记录」跟踪进度',
        ),
      });
    };
    if (dryRun) doRun();
    else Modal.confirm({
      title: '确认立即同步',
      content: `将从「${record.name}」拉取组织与人员并应用变更，确认执行？建议先预览差异。`,
      onOk: doRun,
    });
  }

  const columns: ColumnProps<DirectorySyncSource>[] = [
    { title: '名称', dataIndex: 'name', minWidth: 180, render: renderEllipsis },
    {
      title: '类型', dataIndex: 'type', width: 110,
      render: (_: unknown, r: DirectorySyncSource) => <Tag color={r.type === 'ldap' ? 'purple' : 'blue'}>{DIRECTORY_SYNC_SOURCE_TYPE_LABELS[r.type]}</Tag>,
    },
    {
      title: '凭证来源', dataIndex: 'identityProviderName', width: 180,
      render: (_: unknown, r: DirectorySyncSource) => {
        if (r.type === 'ldap') return r.identityProviderName ? `身份源：${r.identityProviderName}` : EMPTY_PLACEHOLDER;
        if (r.type === 'scim') return 'IdP 推送（Bearer Token）';
        return `OAuth 配置：${DIRECTORY_SYNC_SOURCE_TYPE_LABELS[r.type]}`;
      },
    },
    {
      title: '调度', dataIndex: 'cronExpression', width: 130,
      render: (v: string | null, r: DirectorySyncSource) => {
        if (r.type === 'scim') return 'IdP 推送';
        return v ? <code>{v}</code> : '仅手动';
      },
    },
    {
      title: '上次同步', dataIndex: 'lastRunStatus', width: 110,
      render: (_: unknown, r: DirectorySyncSource) => r.lastRunStatus
        ? <Tag color={DIRECTORY_SYNC_RUN_STATUS_TAG_COLOR[r.lastRunStatus] ?? 'grey'}>{DIRECTORY_SYNC_RUN_STATUS_LABELS[r.lastRunStatus]}</Tag>
        : EMPTY_PLACEHOLDER,
    },
    dateTimeColumn('上次同步时间', 'lastRunAt'),
    dateTimeColumn('下次运行', 'nextRunAt'),
    status.column(),
    createOperationColumn<DirectorySyncSource>({
      width: 210,
      desktopInlineKeys: ['run', 'edit'],
      actions: (record) => [
        ...(record.type !== 'scim' && hasPermission('system:dirsync-source:run') ? [{
          key: 'run', label: '立即同步', onClick: () => handleRun(record, false),
        }] : []),
        ...(record.type !== 'scim' && hasPermission('system:dirsync-source:preview') ? [{
          key: 'preview', label: '预览差异', onClick: () => handleRun(record, true),
        }] : []),
        ...(hasPermission('system:dirsync-source:edit') ? [{
          key: 'edit', label: '编辑', onClick: () => modal.openEdit(record),
        }] : []),
        ...(record.type !== 'scim' && hasPermission('system:dirsync-source:test') ? [{
          key: 'test', label: testingId === record.id ? '测试中…' : '测试连接', onClick: () => handleTest(record),
        }] : []),
        deleteAction({
          hidden: !hasPermission('system:dirsync-source:delete'),
          title: `确定要删除同步源「${record.name}」吗？`,
          content: '删除后其绑定关系与同步记录将一并清除，本地已同步的用户和部门保留',
          run: () => deleteMutation.mutateAsync([record.id]),
        }),
      ],
    }),
  ];

  return (
    <div className="page-container">
      <ListSearchToolbar
        keyword={(
          <KeywordInput
            placeholder="搜索名称..."
            {...bindKeyword('keyword')}
          />
        )}
        filters={<><FilterSelect
          placeholder="全部类型"
          items={DIRECTORY_SYNC_SOURCE_TYPES.map((t) => ({ value: t, label: DIRECTORY_SYNC_SOURCE_TYPE_LABELS[t] }))}
          {...bind('type')}
        /><StatusSelect
          items={statusItems}
          {...bind('status')}
        /></>}
        onSearch={handleSearch}
        onReset={handleReset}
        create={(
          hasPermission('system:dirsync-source:create')
            ? <CreateButton onClick={modal.openCreate} /> : null
        )}
        filterTitle="筛选条件"
      />

      <ConfigurableTable<DirectorySyncSource>
        columns={columns}
        {...listTableProps(listQuery, {
          pagination: buildPagination,
          empty: '暂无同步源，点击「新增」接入 LDAP/AD 或钉钉通讯录',
        })}
      />

      <SideSheet
        title={modal.modalProps.title}
        visible={modal.visible}
        onCancel={modal.close}
        closeOnEsc
        width={660}
        footer={<ModalFooter {...modal.footerProps} okText="保存" />}
      >
        <Spin spinning={modal.detailLoading} wrapperClassName="modal-spin-wrapper">
          <Form key={modal.formKey} {...modal.formProps}>
            {({ formState }) => {
              const type = (formState.values as { type?: string }).type ?? 'ldap';
              return (
                <>
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Input field="name" label="名称" placeholder="如：总部 AD 域"
                        rules={[{ required: true, message: '名称不能为空' }]} />
                    </Col>
                    <Col span={12}>
                      <Form.Select field="type" label="源类型" style={{ width: '100%' }}
                        disabled={modal.isEdit}
                        optionList={DIRECTORY_SYNC_SOURCE_TYPES.map((t) => ({ value: t, label: DIRECTORY_SYNC_SOURCE_TYPE_LABELS[t] }))}
                        rules={[{ required: true, message: '请选择源类型' }]} />
                    </Col>
                  </Row>
                  {type === 'ldap' && (
                    <Form.Select field="identityProviderId" label="企业身份源" style={{ width: '100%' }}
                      placeholder="选择 LDAP/AD 身份源（连接与凭证复用该配置）"
                      optionList={ldapProviders.map((p) => ({ value: p.id, label: p.name }))}
                      loading={providersQuery.isFetching}
                      rules={[{ required: true, message: 'LDAP 源必须绑定企业身份源' }]}
                      helpText="连接地址、Bind 凭证与属性映射在「企业身份源」页维护，此处仅引用" />
                  )}
                  {type === 'dingtalk' && (
                    <Form.Slot label="凭证来源">
                      <Tag color="blue">OAuth 配置 → 钉钉（appKey / appSecret）</Tag>
                      <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 4 }}>
                        复用「OAuth 配置」页的钉钉凭证；需在钉钉开放平台为该应用开通通讯录只读权限
                      </div>
                    </Form.Slot>
                  )}
                  {type === 'wechat_work' && (
                    <>
                      <Form.Slot label="凭证来源">
                        <Tag color="green">OAuth 配置 → 企业微信（Corp ID）</Tag>
                        <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 4 }}>
                          Corp ID 复用「OAuth 配置」页；通讯录同步使用独立的通讯录 Secret（≠ 应用 Secret），在下方填写
                        </div>
                      </Form.Slot>
                      <Form.Input field="contactSecret" label="通讯录 Secret" type="password"
                        placeholder={modal.isEdit && modal.editing?.contactSecretSet ? '已配置；留空保持不变' : '企业微信管理后台 → 通讯录同步 → Secret'}
                        rules={modal.isEdit && modal.editing?.contactSecretSet ? [] : [{ required: true, message: '企业微信源必须填写通讯录 Secret' }]} />
                    </>
                  )}
                  {type === 'feishu' && (
                    <Form.Slot label="凭证来源">
                      <Tag color="cyan">OAuth 配置 → 飞书（App ID / App Secret）</Tag>
                      <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 4 }}>
                        复用「OAuth 配置」页的飞书凭证；需在飞书开放平台为该应用开通通讯录读取权限
                      </div>
                    </Form.Slot>
                  )}
                  {type === 'scim' && (
                    <>
                      <Form.Slot label="SCIM Base URL">
                        {modal.isEdit && modal.editing?.callbackUrlKey ? (
                          <Typography.Text code copyable>
                            {`${window.location.origin}/api/directory-sync/scim/${modal.editing.callbackUrlKey}/v2`}
                          </Typography.Text>
                        ) : (
                          <Typography.Text type="tertiary">保存后自动生成，配置到 Azure AD / Okta 的租户 URL</Typography.Text>
                        )}
                      </Form.Slot>
                      <Form.Input field="callbackToken" label="Bearer Token" type="password"
                        placeholder={modal.isEdit && modal.editing?.callbackTokenSet ? '已配置；留空保持不变' : 'IdP 侧 Secret Token，建议 32 位以上随机串'}
                        rules={modal.isEdit && modal.editing?.callbackTokenSet ? [] : [{ required: true, message: 'SCIM 源必须设置 Bearer Token' }]}
                        helpText="IdP 以 Authorization: Bearer <token> 调用本端 SCIM 接口" />
                    </>
                  )}
                  {type !== 'scim' && (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Select field="matchKey" label="匹配键" style={{ width: '100%' }}
                          optionList={DIRECTORY_SYNC_MATCH_KEYS.map((k) => ({ value: k, label: DIRECTORY_SYNC_MATCH_KEY_LABELS[k] }))}
                          helpText="未绑定的外部用户按此字段匹配本地账号" />
                      </Col>
                      <Col span={12}>
                        <Form.Select field="conflictPolicy" label="冲突策略" style={{ width: '100%' }}
                          optionList={DIRECTORY_SYNC_CONFLICT_POLICIES.map((p) => ({ value: p, label: DIRECTORY_SYNC_CONFLICT_POLICY_LABELS[p] }))} />
                      </Col>
                    </Row>
                  )}
                  {type !== 'scim' && (
                    <Row gutter={16}>
                      <Col span={12}>
                        <Form.Switch field="syncDepartments" label="同步部门树" />
                      </Col>
                      <Col span={12}>
                        <Form.InputNumber field="circuitBreakerPercent" label="熔断阈值 (%)" style={{ width: '100%' }}
                          min={0} max={100}
                          helpText="单次计划禁用人数占已绑定人数比例超过该值时中止同步" />
                      </Col>
                    </Row>
                  )}
                  <Row gutter={16}>
                    <Col span={12}>
                      <Form.Switch field="lifecycle.disableOnLeave" label="离职自动禁用" />
                    </Col>
                    <Col span={12}>
                      <Form.Switch field="lifecycle.kickSessions" label="禁用时强制下线" />
                    </Col>
                  </Row>
                  <Form.Select field="lifecycle.defaultRoleIds" label="默认角色" multiple style={{ width: '100%' }}
                    placeholder="新建账号自动授予的角色（可空）"
                    extraText="只能选择本租户的普通角色；平台保留角色需由平台管理员手动分配"
                    optionList={roleOptions} loading={rolesQuery.isFetching} />
                  {type !== 'scim' && (
                    <>
                      <Form.Input field="cronExpression" label="定时表达式"
                        placeholder="如 0 2 * * *（每天 2 点），留空则仅手动同步"
                        helpText="由系统调度每分钟扫描到期源"
                        addonAfter={(
                          <CronBuilderPopover
                            value={(formState.values as { cronExpression?: string }).cronExpression ?? ''}
                            onApply={(expr) => modal.formApi.current?.setValue('cronExpression', expr)}
                          />
                        )} />
                      <Form.TagInput field="scopeConfig.deptExternalIds" label="部门范围"
                        placeholder="外部部门 ID，回车添加；留空同步全部" />
                      <Form.TagInput field="scopeConfig.excludeUserExternalIds" label="排除人员"
                        placeholder="外部用户 ID，回车添加" />
                    </>
                  )}
                  {CALLBACK_TYPE_SET.has(type) && (
                    <>
                      <Divider align="left">事件回调（准实时增量）</Divider>
                      <Form.Slot label="回调 URL">
                        {modal.isEdit && modal.editing?.callbackUrlKey ? (
                          <Typography.Text code copyable>
                            {`${window.location.origin}/api/directory-sync/callbacks/${modal.editing.callbackUrlKey}`}
                          </Typography.Text>
                        ) : (
                          <Typography.Text type="tertiary">保存后自动生成，配置到平台的事件订阅地址</Typography.Text>
                        )}
                      </Form.Slot>
                      <Form.Input field="callbackToken" label="回调 Token" type="password"
                        placeholder={modal.isEdit && modal.editing?.callbackTokenSet ? '已配置；留空保持不变' : type === 'feishu' ? 'Verification Token（可空）' : '与平台回调配置一致的 Token'}
                        helpText="收到事件后置位标记，由系统调度在一分钟内触发一次幂等同步" />
                      <Form.Input field="callbackAesKey" label="回调 AES Key" type="password"
                        placeholder={modal.isEdit && modal.editing?.callbackAesKeySet ? '已配置；留空保持不变' : type === 'feishu' ? 'Encrypt Key（明文模式可空）' : '43 位 EncodingAESKey'} />
                    </>
                  )}
                  {type !== 'scim' && (
                    <>
                      <Divider align="left">字段映射</Divider>
                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Select field="fieldMapping.username" label="登录名来源" style={{ width: '100%' }}
                            placeholder="默认：登录名（username）" showClear
                            optionList={MAPPING_SOURCE_OPTIONS}
                            helpText="仅建号时使用" />
                        </Col>
                        <Col span={12}>
                          <Form.Select field="fieldMapping.nickname" label="姓名来源" style={{ width: '100%' }}
                            placeholder="默认：姓名（nickname）" showClear
                            optionList={[...MAPPING_SOURCE_OPTIONS, { value: DIRECTORY_SYNC_FIELD_IGNORE, label: '不同步' }]} />
                        </Col>
                      </Row>
                      <Row gutter={16}>
                        <Col span={12}>
                          <Form.Select field="fieldMapping.email" label="邮箱来源" style={{ width: '100%' }}
                            placeholder="默认：邮箱（email）" showClear
                            optionList={[...MAPPING_SOURCE_OPTIONS, { value: DIRECTORY_SYNC_FIELD_IGNORE, label: '不同步' }]} />
                        </Col>
                        <Col span={12}>
                          <Form.Select field="fieldMapping.phone" label="手机号来源" style={{ width: '100%' }}
                            placeholder="默认：手机号（phone）" showClear
                            optionList={[...MAPPING_SOURCE_OPTIONS, { value: DIRECTORY_SYNC_FIELD_IGNORE, label: '不同步' }]} />
                        </Col>
                      </Row>
                    </>
                  )}
                  <Form.TextArea field="remark" label="备注" placeholder="选填" rows={2} />
                </>
              );
            }}
          </Form>
        </Spin>
      </SideSheet>
    </div>
  );
}
