import {PROTON, ACCOUNT, ADMIN, selectCookies, sessionState, bundleFor} from './core.js';
import {readProton, readKeySalts, mcpRequest} from './bridge.js';

const $ = id => document.getElementById(id);
let busy = false;
let selectedTab = null;
let storeId = null;
let pendingImport = null;

const runIn = async (tabId, func, args) => {
  const results = await chrome.scripting.executeScript({target:{tabId,frameIds:[0]},world:'ISOLATED',func,args});
  if (!results[0]?.result) throw new Error('页面已关闭或不允许检测');
  return results[0].result;
};

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function waitForTab(tabId, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status === 'complete') return tab;
    await sleep(250);
  }
  throw new Error('account.proton.me 页面加载超时');
}

async function withAccountTab(fn) {
  const tabs = await chrome.tabs.query({url:ACCOUNT + '/*'});
  let tab = tabs.find(t => !t.incognito);
  let created = false;
  if (!tab) {
    tab = await chrome.tabs.create({url:ACCOUNT + '/mail', active:false});
    created = true;
  }
  try {
    await waitForTab(tab.id);
    const current = await chrome.tabs.get(tab.id);
    if (!current.url || new URL(current.url).origin !== ACCOUNT) throw new Error('account.proton.me 未保持登录状态');
    return await fn(tab.id);
  } finally {
    if (created) {
      try { await chrome.tabs.remove(tab.id); } catch {}
    }
  }
}

async function adminTab() {
  const tabs = await chrome.tabs.query({url:ADMIN + '*'});
  const tab = tabs.find(t => new URL(t.url).pathname === '/proton/import');
  if (!tab) throw new Error('请先打开 MCP 管理页并完成 Access 登录');
  return tab.id;
}

async function callMcp(operation, payload) {
  const result = await runIn(await adminTab(), mcpRequest, [operation,payload ?? null]);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function currentCookies() {
  if (!selectedTab || !storeId) throw new Error('请重新检测 Proton 页面');
  const tab = await chrome.tabs.get(selectedTab);
  if (new URL(tab.url).origin !== PROTON) throw new Error('Proton 页面已切换，请重新检测');
  return chrome.cookies.getAll({domain:'proton.me',storeId});
}

async function captureBundle(uid, updateUi = false) {
  const cookies = selectCookies(await currentCookies(), uid);
  const state = sessionState(cookies, uid);
  if (updateUi) {
    $('auth').textContent = state.auth ? '已获取' : '缺失';
    $('sessionId').textContent = state.sessionId ? '已获取' : '缺失';
    $('refresh').textContent = state.refresh ? '已获取' : '缺失';
    $('salt').textContent = '获取中…';
  }

  const mail = await runIn(selectedTab, readProton, [uid]);
  if (!mail.ok) throw new Error(mail.error);

  const salts = await withAccountTab(tabId => runIn(tabId, readKeySalts, [uid]));
  if (!salts.ok) throw new Error(salts.error);

  const result = {
    ok:true,
    email:mail.email,
    user:mail.user,
    addresses:mail.addresses,
    keySalts:salts.keySalts,
    client:{...(mail.client || {}),...(salts.client || {})}
  };
  const bundle = bundleFor(uid, cookies, result);
  if (updateUi) {
    $('email').textContent = result.email;
    $('salt').textContent = '已获取';
  }
  return bundle;
}

function accountMeta() {
  const option = $('account').selectedOptions[0];
  if (!option?.value) throw new Error('请选择目标 MCP 账号');
  return {
    id: option.value,
    label: option.dataset.label || option.textContent || option.value,
    email: option.dataset.email || ''
  };
}

function importEnvelope(bundle, account) {
  return {
    format:'personal-mail-mcp-proton-import',
    version:1,
    exportedAt:new Date().toISOString(),
    target:{
      accountId:account.id,
      label:account.label,
      configuredEmail:account.email
    },
    bundle
  };
}

function showPreview(bundle, account) {
  const envelope = importEnvelope(bundle, account);
  pendingImport = {bundle, account, envelope};
  $('previewEmail').textContent = bundle.email;
  $('previewAccount').textContent = account.label + (account.email ? ` · ${account.email}` : '');
  $('previewUid').textContent = bundle.uid.length > 8 ? '…' + bundle.uid.slice(-8) : bundle.uid;
  $('previewCookies').textContent = `${bundle.session.cookies.length} 个：${bundle.session.cookies.map(c => c.name).join(', ')}`;
  $('previewSalts').textContent = `${bundle.keySalts.length} 个`;
  $('previewJson').textContent = JSON.stringify(envelope, null, 2);
  $('previewDialog').showModal();
  $('status').textContent = '请核对导入内容；确认后才会上传。';
}

function clearPreview() {
  pendingImport = null;
  $('previewJson').textContent = '';
  if ($('previewDialog').open) $('previewDialog').close();
}

function exportPending() {
  if (!pendingImport) throw new Error('没有可导出的导入内容');
  const json = JSON.stringify(pendingImport.envelope, null, 2);
  const blob = new Blob([json], {type:'application/json'});
  const href = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[-:]/g,'').replace(/\.\d{3}Z$/,'Z');
  a.href = href;
  a.download = `proton-session-bundle-${stamp}.json`;
  a.style.display = 'none';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
  $('status').textContent = '已导出本次导入 JSON。该文件包含敏感 Session，请妥善保管。';
}

async function inspect() {
  $('connect').disabled = true;
  const uid = $('proton').value;
  if (!uid) throw new Error('请选择 Proton 会话');
  for (const id of ['auth','sessionId','refresh']) $(id).textContent = '检测中…';
  $('salt').textContent = '待检测';

  const bundle = await captureBundle(uid, true);
  const data = await callMcp('accounts');
  $('account').replaceChildren(...data.accounts.map(a => {
    const option = new Option(`${a.label} · ${a.email}`, a.id);
    option.dataset.label = a.label;
    option.dataset.email = a.email;
    return option;
  }));
  $('account').disabled = false;
  $('connect').disabled = !data.accounts.length;
  $('status').textContent = data.accounts.length
    ? `已就绪：Bundle v${bundle.version}。点击“预览并连接”核对后导入。`
    : 'MCP 尚未配置 Proton 账号';
}

async function detect() {
  clearPreview();
  $('connect').disabled = true;
  $('email').textContent = '待检测';
  for (const id of ['auth','sessionId','refresh','salt']) $(id).textContent = '待检测';
  $('account').replaceChildren();

  const tabs = await chrome.tabs.query({url:PROTON + '/*'});
  const tab = tabs.find(t => t.active) || (tabs.length === 1 ? tabs[0] : null);
  if (!tab) throw new Error('请打开并切换到已登录的 mail.proton.me 标签页');
  if (tab.incognito) throw new Error('当前版本请使用普通浏览器窗口');

  selectedTab = tab.id;
  const stores = await chrome.cookies.getAllCookieStores();
  storeId = stores.find(s => s.tabIds.includes(tab.id))?.id;
  if (!storeId) throw new Error('无法确定 Proton Cookie Store');

  const rows = await currentCookies();
  const uids = [...new Set(rows.filter(c =>
    c.name.startsWith('AUTH-') &&
    c.value &&
    (c.expirationDate === undefined || c.expirationDate * 1000 > Date.now())
  ).map(c => c.name.slice(5)))];

  $('proton').replaceChildren(...uids.map((uid,i) => new Option(`会话 ${i+1} · UID …${uid.slice(-6)}`,uid)));
  $('proton').disabled = uids.length === 0;
  if (!uids.length) throw new Error('没有已登录的 Proton Session');

  if (uids.length > 1) {
    const prompt = new Option('请选择会话并核对邮箱','',true,true);
    prompt.disabled = true;
    $('proton').prepend(prompt);
    $('status').textContent = '检测到多个 Proton 会话，请先选择。';
    return;
  }
  await inspect();
}

async function previewImport() {
  const uid = $('proton').value;
  if (!uid) throw new Error('请选择 Proton 会话');
  const account = accountMeta();
  const bundle = await captureBundle(uid, true);
  showPreview(bundle, account);
}

async function confirmImport() {
  const pending = pendingImport;
  if (!pending) throw new Error('预览已失效，请重新预览');
  $('previewDialog').close();
  $('status').textContent = '正在导入…';
  try {
    const pair = await callMcp('pair',{
      account:pending.account.id,
      uid:pending.bundle.uid,
      email:pending.bundle.email
    });
    if (!pair.token || pair.expiresAt <= Date.now()) throw new Error('配对响应无效');
    const response = await callMcp('import',{
      account:pending.account.id,
      token:pair.token,
      bundle:pending.bundle
    });
    if (!response.success) throw new Error('导入未确认，请查看管理页');
    $('status').textContent = response.refreshTestRequired
      ? '导入成功。建议到管理页执行一次“测试续期”。'
      : '导入成功。';
    $('connect').disabled = true;
  } finally {
    pendingImport = null;
    $('previewJson').textContent = '';
  }
}

async function act(fn) {
  if (busy) return;
  busy = true;
  document.querySelectorAll('button,select').forEach(el => { el.disabled = true; });
  try {
    await fn();
  } catch (e) {
    $('status').textContent = e instanceof Error ? e.message : '操作失败，请重新检测';
  } finally {
    busy = false;
    $('detect').disabled = false;
    $('login').disabled = false;
    $('proton').disabled = !$('proton').options.length;
    $('account').disabled = !$('account').options.length;
    $('connect').disabled = !$('account').options.length || !$('proton').value;
    $('closePreview').disabled = false;
    $('cancelPreview').disabled = false;
    $('exportBundle').disabled = !pendingImport;
    $('confirmImport').disabled = !pendingImport;
  }
}

$('detect').onclick = () => act(detect);
$('proton').onchange = () => act(inspect);
$('connect').onclick = () => act(previewImport);
$('login').onclick = () => chrome.tabs.create({url:ADMIN});
$('closePreview').onclick = clearPreview;
$('cancelPreview').onclick = clearPreview;
$('exportBundle').onclick = () => {
  try { exportPending(); }
  catch (e) { $('status').textContent = e instanceof Error ? e.message : '导出失败'; }
};
$('confirmImport').onclick = () => act(confirmImport);
$('previewDialog').addEventListener('cancel', event => {
  event.preventDefault();
  clearPreview();
});

void act(detect);
