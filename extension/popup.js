import {PROTON, ACCOUNT, ADMIN, selectCookies, sessionState, bundleFor} from './core.js';
import {readProton, readKeySalts, mcpRequest} from './bridge.js';

const $ = id => document.getElementById(id);
let busy = false;
let selectedTab = null;
let storeId = null;

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
  if (!tab) throw new Error('请先打开 MCP 管理页并完成 Access 登录，然后重新打开扩展');
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
    $('salt').textContent = '重放获取中…';
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
    client:{
      ...(mail.client || {}),
      ...(salts.client || {})
    }
  };
  const bundle = bundleFor(uid, cookies, result);
  if (updateUi) {
    $('email').textContent = result.email;
    $('salt').textContent = '已获取';
  }
  return bundle;
}

async function inspect() {
  $('connect').disabled = true;
  const uid = $('proton').value;
  if (!uid) throw new Error('请选择 Proton 会话');
  for (const id of ['auth','sessionId','refresh']) $(id).textContent = '检测中…';
  $('salt').textContent = '待检测';

  const bundle = await captureBundle(uid, true);
  const data = await callMcp('accounts');
  $('account').replaceChildren(...data.accounts.map(a => new Option(`${a.label} · ${a.id} · ${a.email}`,a.id)));
  $('account').disabled = false;
  $('connect').disabled = !data.accounts.length;
  $('status').textContent = data.accounts.length
    ? `Bundle v${bundle.version} 已就绪，请核对目标 MCP 账号后连接。`
    : 'MCP 尚未配置 Proton 账号';
}

async function detect() {
  $('connect').disabled = true;
  $('email').textContent = '待检测';
  for (const id of ['auth','sessionId','refresh','salt']) $(id).textContent = '待检测';
  $('account').replaceChildren();

  const tabs = await chrome.tabs.query({url:PROTON + '/*'});
  const tab = tabs.find(t => t.active) || (tabs.length === 1 ? tabs[0] : null);
  if (!tab) throw new Error('请打开并切换到已登录的 mail.proton.me 标签页，再打开扩展');
  if (tab.incognito) throw new Error('第一版请使用普通浏览器窗口');

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
    $('status').textContent = '检测到多个会话，请选择后检测；不会合并不同账号的 Cookie。';
    return;
  }
  await inspect();
}

async function connect() {
  const uid = $('proton').value;
  if (!uid) throw new Error('请选择 Proton 会话');
  let bundle = await captureBundle(uid, true);
  let pair;
  try {
    const account = $('account').value;
    if (!account) throw new Error('请选择 MCP Proton 账号');
    pair = await callMcp('pair',{account,uid,email:bundle.email});
    if (!pair.token || pair.expiresAt <= Date.now()) throw new Error('配对响应无效');
    const response = await callMcp('import',{account,token:pair.token,bundle});
    if (!response.success) throw new Error('导入未确认，请查看管理页');
    $('status').textContent = response.refreshTestRequired
      ? '连接成功。Bundle v2 已加密保存；请到管理页执行一次“测试自动续期”。'
      : '连接成功。Session 和 KeySalt 已在服务端加密保存。';
    $('connect').disabled = true;
  } finally {
    bundle = null;
    pair = null;
  }
}

async function act(fn) {
  if (busy) return;
  busy = true;
  for (const id of ['connect','detect','login','proton','account']) $(id).disabled = true;
  try {
    await fn();
  } catch (e) {
    $('status').textContent = e instanceof Error ? e.message : '操作失败，请重新检测';
    $('connect').disabled = true;
  } finally {
    busy = false;
    $('detect').disabled = false;
    $('login').disabled = false;
    $('proton').disabled = !$('proton').options.length;
    $('account').disabled = !$('account').options.length;
  }
}

$('detect').onclick = () => act(detect);
$('proton').onchange = () => act(inspect);
$('connect').onclick = () => act(connect);
$('login').onclick = () => chrome.tabs.create({url:ADMIN});
void act(detect);
