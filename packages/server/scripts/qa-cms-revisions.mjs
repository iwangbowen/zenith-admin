/** Opt-in live regression. Retains clearly named fixtures in the supplied development environment. */
import { writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import sharp from 'sharp';

const base = process.env.CMS_QA_BASE ?? 'http://localhost:5373';
const siteId = Number(process.env.CMS_QA_SITE_ID ?? 3);
const channelId = Number(process.env.CMS_QA_CHANNEL_ID ?? 5);
const report = { startedAt: new Date().toISOString(), base, siteId, channelId, checks: [], fixtures: {} };
let token;
async function request(path, method = 'GET', body, expected = 200) {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const payload = await response.json();
  assert.equal(response.status, expected, `${method} ${path}: ${response.status} ${payload.message}`);
  if (expected === 200) assert.equal(payload.code, 0, `${path}: ${payload.message}`);
  return payload.data;
}
function check(name) { report.checks.push(name); console.log(`PASS ${name}`); }
async function upload(path, color) {
  const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background: color } }).png().toBuffer();
  const form = new FormData(); form.append('file', new Blob([bytes], { type: 'image/png' }), 'qa-cms-version.png');
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, Origin: new URL(base).origin }, body: form });
  const payload = await response.json(); assert.equal(response.status, 200, payload.message); assert.equal(payload.code, 0, payload.message);
  return payload.data;
}
async function awaitRelease(id, wanted = ['active']) {
  const until = Date.now() + 180_000;
  while (Date.now() < until) {
    const release = await request(`/api/cms/releases/${id}`);
    if (release.status === 'failed') throw new Error(`Release ${id}: ${release.error}`);
    if (wanted.includes(release.status)) return release;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error(`Release ${id} did not reach ${wanted.join('/')}`);
}
async function latestRelease(contentId) {
  const list = await request(`/api/cms/releases?siteId=${siteId}&page=1&pageSize=100`);
  const release = list.list.find((row) => row.items.some((item) => item.contentId === contentId));
  assert.ok(release, 'implicit content release exists');
  return release;
}
try {
  assert.ok(process.env.CMS_QA_USERNAME && process.env.CMS_QA_PASSWORD, 'Set CMS_QA_USERNAME and CMS_QA_PASSWORD');
  const auth = await request('/api/auth/login', 'POST', { username: process.env.CMS_QA_USERNAME, password: process.env.CMS_QA_PASSWORD });
  token = auth.token.accessToken;
  const prefix = `QA-CMS-FINAL-${Date.now()}`;
  const site = await request(`/api/cms/sites/${siteId}`);
  const channel = await request(`/api/cms/channels/${channelId}`);
  let content = await request('/api/cms/contents', 'POST', { siteId, channelId, title: `${prefix}-A`, slug: prefix.toLowerCase(), body: '<h2>公开版本 A</h2><p>完整正文与字段快照。</p>', summary: '验收内容摘要', titleStyle: { bold: true, color: '#123456' }, seoTitle: `${prefix}-SEO-A` });
  const contentId = content.id;
  report.fixtures.contentId = contentId;
  const path = `/api/cms/contents/${contentId}`;
  const publicPath = `/__cms/${site.code}/${channel.path}/${content.slug}.html`;
  report.fixtures.publicPath = publicPath;
  assert.equal(content.editorialStatus, 'draft');
  content = await request(`${path}/publish`, 'POST', { expectedVersion: content.version });
  const firstRelease = await latestRelease(contentId);
  report.fixtures.firstReleaseId = firstRelease.id;
  const first = await awaitRelease(firstRelease.id);
  content = await request(path);
  assert.equal(content.editorialStatus, 'clean');
  assert.ok(content.publishedRevisionId);
  const firstRevisionId = content.publishedRevisionId;
  check('initial publication builds and activates an immutable generation');
  const publicA = await fetch(`${base}${publicPath}`).then((response) => response.text());
  assert.ok(publicA.includes(`${prefix}-A`), 'public A rendered');
  const stale = content.version;
  content = await request(path, 'PUT', { expectedVersion: stale, title: `${prefix}-B`, body: '<h2>工作稿 B</h2>', titleStyle: { bold: false, color: '#abcdef' }, seoTitle: `${prefix}-SEO-B` });
  await request(path, 'PUT', { expectedVersion: stale, title: 'stale overwrite' }, 409);
  await request(path, 'PUT', { title: 'missing CAS' }, 400);
  const publicAfterEdit = await fetch(`${base}${publicPath}`).then((response) => response.text());
  assert.ok(publicAfterEdit.includes(`${prefix}-A`) && !publicAfterEdit.includes(`${prefix}-B`));
  check('working-copy saves leave public generation unchanged and reject stale/missing CAS');
  content = await request(`${path}/submit`, 'POST', { expectedVersion: content.version });
  const submittedId = content.submittedRevisionId;
  content = await request(path, 'PUT', { expectedVersion: content.version, title: `${prefix}-C`, body: '<p>送审后继续修改 C</p>' });
  const submitted = await request(`${path}/versions/${submittedId}`);
  assert.equal(submitted.snapshot.title, `${prefix}-B`);
  check('submission remains frozen while a newer working copy is edited');
  content = await request(`${path}/versions/${firstRevisionId}/restore`, 'POST', { expectedVersion: content.version });
  assert.equal(content.title, `${prefix}-A`);
  assert.equal(content.titleStyle.color, '#123456');
  assert.equal(content.seoTitle, `${prefix}-SEO-A`);
  assert.equal(content.editorialStatus, 'draft');
  check('restoration restores full fields into a draft without publishing');
  const note = await request(`/api/cms/editorial/${contentId}/notes`, 'POST', { message: 'QA：核对完整快照', fieldPath: 'title', mentionedUserIds: [] });
  await request(`/api/cms/editorial/${contentId}/notes/${note.id}`, 'PUT', { resolved: true });
  const quality = await request(`/api/cms/editorial/${contentId}/quality`);
  assert.ok(Array.isArray(quality.issues));
  const translation = await request(`/api/cms/editorial/${contentId}/translations`, 'POST', { locale: 'en-US', channelId, title: `${prefix}-English` });
  report.fixtures.translationId = translation.id;
  await request(`/api/cms/editorial/${contentId}/translations`, 'POST', { locale: 'en-US', channelId, title: 'duplicate' }, 409);
  const variants = await request(`/api/cms/editorial/${contentId}/translations`);
  assert.equal(variants.length, 2);
  check('notes, quality report, manual translation and duplicate-language protection');
  content = await request(path, 'PUT', { expectedVersion: content.version, title: `${prefix}-D` });
  await request(`${path}/publish`, 'POST', { expectedVersion: content.version });
  const secondRelease = await latestRelease(contentId);
  report.fixtures.secondReleaseId = secondRelease.id;
  const second = await awaitRelease(secondRelease.id);
  assert.ok((await fetch(`${base}${publicPath}`).then((response) => response.text())).includes(`${prefix}-D`));
  await request(`/api/cms/releases/${first.id}/rollback`, 'POST', { expectedGenerationId: second.activeGenerationId });
  assert.ok((await fetch(`${base}${publicPath}`).then((response) => response.text())).includes(`${prefix}-A`));
  const afterRollback = await request(path);
  assert.equal(afterRollback.title, `${prefix}-D`);
  assert.equal(afterRollback.hasUnpublishedChanges, true);
  assert.equal(afterRollback.editorialStatus, 'draft');
  await request(`/api/cms/releases/${second.id}/activate`, 'POST', { expectedGenerationId: second.activeGenerationId }, 409);
  check('generation rollback changes delivery and stale activation CAS is rejected');
  await request(`/api/cms/releases/content/${contentId}/suppress`, 'POST', { reason: 'QA emergency withdrawal' });
  assert.equal((await fetch(`${base}${publicPath}`)).status, 404);
  await request(`/api/cms/releases/content/${contentId}/unsuppress`, 'POST', { reason: 'QA restore visibility' });
  assert.equal((await fetch(`${base}${publicPath}`)).status, 200);
  check('emergency withdrawal and restoration apply to active generation');
  const list = await request(`/api/cms/contents?siteId=${siteId}&page=1&pageSize=10&keyword=${prefix}`);
  assert.ok(list.total >= 2);
  await request(`/api/cms/contents?siteId=${siteId}&page=1&pageSize=10&calendarFrom=2026-09-01&calendarTo=2026-10-01`);
  check('working-copy list, search and calendar SQL execute on PostgreSQL');
  const asset = await upload(`/api/cms/resources/upload?siteId=${siteId}`, '#123456');
  report.fixtures.assetId = asset.id;
  await request(`/api/cms/resources/${asset.id}/rights`, 'PUT', { source: 'QA generated bitmap', license: 'QA fixture', alt: '蓝色色块', revoked: false });
  let illustrated = await request('/api/cms/contents', 'POST', { siteId, channelId, title: `${prefix}-asset`, slug: `${prefix.toLowerCase()}-asset`, coverImage: `cms-res://${asset.id}`, body: `<p>素材固定版本</p><img src="cms-res://${asset.id}" alt="色块">` });
  report.fixtures.assetContentId = illustrated.id;
  await request(`/api/cms/contents/${illustrated.id}/publish`, 'POST', { expectedVersion: illustrated.version });
  await awaitRelease((await latestRelease(illustrated.id)).id);
  illustrated = await request(`/api/cms/contents/${illustrated.id}`);
  const assetRevision = await request(`/api/cms/contents/${illustrated.id}/versions/${illustrated.publishedRevisionId}`);
  const pinnedUrl = assetRevision.snapshot.coverImage;
  const imagePath = `/__cms/${site.code}/${channel.path}/${illustrated.slug}.html`;
  const replacement = await upload(`/api/cms/resources/${asset.id}/replace`, '#abcdef');
  assert.notEqual(replacement.url, pinnedUrl);
  assert.ok((await request(`/api/cms/resources/${asset.id}/versions`)).length >= 2);
  const pinnedHtml = await fetch(`${base}${imagePath}`).then((r) => r.text());
  assert.ok(pinnedHtml.includes(pinnedUrl) && !pinnedHtml.includes(replacement.url));
  await request(`/api/cms/resources/${asset.id}/rights`, 'PUT', { revoked: true });
  assert.equal((await fetch(`${base}${imagePath}`)).status, 404);
  await request(`/api/cms/resources/${asset.id}/rights`, 'PUT', { revoked: false });
  assert.equal((await fetch(`${base}${imagePath}`)).status, 200);
  check('asset replacement preserves the published binary version and rights revoke delivery');
  const modelFields = [{ name: 'sku', label: '编号', fieldType: 'text', required: true, showInList: true, configuration: { unique: true } }];
  let model = await request('/api/cms/models', 'POST', { ownerSiteId: siteId, name: `${prefix}-model`, code: `${prefix.toLowerCase()}-model`, fields: modelFields });
  const oldModelVersion = model.publishedVersionId;
  report.fixtures.modelId = model.id;
  let typed = await request('/api/cms/contents', 'POST', { siteId, channelId, modelId: model.id, title: `${prefix}-typed`, slug: `${prefix.toLowerCase()}-typed`, body: '<p>独立内容类型</p>', extend: { sku: 'QA-001' } });
  report.fixtures.typedContentId = typed.id;
  await request(`/api/cms/models/${model.id}?siteId=${siteId}`, 'PUT', { fields: [...modelFields, { name: 'new_required', label: '新版必填字段', fieldType: 'text', required: true }] });
  model = await request(`/api/cms/models/${model.id}/publish?siteId=${siteId}`, 'POST');
  assert.notEqual(model.publishedVersionId, oldModelVersion);
  assert.equal(typed.modelVersionId, oldModelVersion);
  await request(`/api/cms/contents/${typed.id}/publish`, 'POST', { expectedVersion: typed.version });
  await awaitRelease((await latestRelease(typed.id)).id);
  typed = await request(`/api/cms/contents/${typed.id}`);
  const typedList = await request(`/api/cms/contents?siteId=${siteId}&page=1&pageSize=10&keyword=${prefix}-typed`);
  assert.ok(typedList.list[0].modelFields.some((field) => field.name === 'sku'));
  assert.ok(!typedList.list[0].modelFields.some((field) => field.name === 'new_required'));
  check('model versions remain pinned for validation and list display after schema publication');
  const page = await request('/api/cms/pages', 'POST', { siteId, name: `${prefix}-page-A`, slug: `${prefix.toLowerCase()}-page`, seoTitle: `${prefix}-page-A`, blocks: [{ id: 'main', type: 'richtext', props: { html: '<p>冻结页面 A</p>' } }] });
  report.fixtures.pageId = page.id;
  const group = await request('/api/cms/releases', 'POST', { siteId, name: `${prefix}-group`, revisionIds: [typed.publishedRevisionId, illustrated.publishedRevisionId], pageIds: [page.id] });
  report.fixtures.groupReleaseId = group.id;
  await request(`/api/cms/pages/${page.id}`, 'PUT', { name: `${prefix}-page-B`, seoTitle: `${prefix}-page-B` });
  await request(`/api/cms/releases/${group.id}/build`, 'POST');
  const ready = await awaitRelease(group.id, ['ready']);
  const preview = await request(`/api/cms/releases/${group.id}/preview?path=${encodeURIComponent(`/p/${page.slug}/`)}`);
  assert.equal(preview.status, 200);
  assert.ok(preview.html.includes(`${prefix}-page-A`) && !preview.html.includes(`${prefix}-page-B`));
  await request(`/api/cms/releases/${group.id}/activate`, 'POST', { expectedGenerationId: ready.activeGenerationId });
  check('group releases freeze content and page configuration before candidate build and activation');
  const runs = await request('/api/system-scheduler/runs?taskName=cms-scheduled-publish&page=1&pageSize=10');
  report.schedulerRuns = runs.list.map((run) => ({ status: run.status, startedAt: run.startedAt, message: run.message }));
  report.status = 'passed';
} catch (error) {
  report.status = 'failed'; report.error = error instanceof Error ? error.message : String(error); console.error(report.error); process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  await writeFile(process.env.CMS_QA_REPORT ?? 'cms-final-api-results.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report.fixtures));
}
