import {PROTON, ACCOUNT, ADMIN, selectCookies, sessionState, sessionCandidates, bundleFor, bundleForAccount} from './core.js';
import {readProton, readPersistedSessionUid, readPersistedSessionIndex, readLocalSessions, readSessionKeyPassword, readKeySalts, mcpRequest} from './bridge.js';

const $ = id => document.getElementById(id);
let busy = false;
let selectedTab = null;
let storeId = null;
let pendingImport = null;
let diagnosticLog = [];
let ready = false;

function uidSuffix(uid) {
  const value = String(uid || '');
  return value ? '…' + value.slice(-6) : '—';
}

function localIdFromUrl(url) {
  try {
    return new URL(url).pathname.match(/^\/u\/(\d+)(?:\/|$)/)?.[1] || null;
  } catch {
    return null;
  }
}

function logEvent(scope, message, details = null) {
  const time = new Date().toLocaleTimeString();
  const suffix = details && Object.keys(details).length
    ? ' ' + Object.entries(details).map(([k,v]) => `${k}=${String(v)}`).join(' ')
    : '';
  diagnosticLog.push(`[${time}] ${scope}: ${message}${suffix}`);
  diagnosticLog = diagnosticLog.slice(-80);
  if ($('logOutput')) $('logOutput').textContent = diagnosticLog.join('\n') || '暂无日志';
}

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

async function withAccountTab(expectedUid, fn) {
  // Account and Mail can keep different LocalID slot numbers for the same UID.
  // Always resolve the Account-side slot by UID instead of reusing Mail's LocalID.
  const tab = await chrome.tabs.create({url:ACCOUNT + '/mail', active:false});
  try {
    logEvent('KeySalt', '打开 Account 页面', {uid:uidSuffix(expectedUid)});
    await waitForTab(tab.id);
    await sleep(900);

    let current = await chrome.tabs.get(tab.id);
    if (!current.url || new URL(current.url).origin !== ACCOUNT) {
      throw new Error('account.proton.me 未保持登录状态');
    }

    let index = await runIn(tab.id, readPersistedSessionIndex, []);
    if (!index.ok) throw new Error(index.error || '无法读取 Account 会话索引');
    logEvent('KeySalt', '读取 Account 会话索引', {sessions:index.sessions.length});

    let match = index.sessions.find(item => item.uid === expectedUid) || null;

    if (!match) {
      const accountLocalId = localIdFromUrl(current.url);
      if (accountLocalId !== null) {
        const active = await runIn(tab.id, readPersistedSessionUid, [Number(accountLocalId)]);
        if (active.ok) {
          const mapping = await runIn(tab.id, readLocalSessions, [active.uid]);
          if (mapping.ok) {
            const exact = mapping.sessions.find(item => item.uid === expectedUid);
            if (exact) {
              match = {localID:exact.localID,uid:exact.uid};
              logEvent('KeySalt', 'Account API 映射找到目标 UID', {
                accountLocalID:exact.localID,
                uid:uidSuffix(exact.uid)
              });
            }
          }
        }
      }
    }

    if (!match) {
      throw new Error(`Account 应用中没有当前 Mail UID 的会话：${uidSuffix(expectedUid)}。请先在 account.proton.me 切换到同一 Proton 账号后重试。`);
    }

    logEvent('KeySalt', 'Account UID 匹配', {
      accountLocalID:match.localID,
      uid:uidSuffix(match.uid)
    });

    const targetUrl = `${ACCOUNT}/u/${match.localID}/mail`;
    if (localIdFromUrl(current.url) !== String(match.localID)) {
      await chrome.tabs.update(tab.id,{url:targetUrl});
      await waitForTab(tab.id);
      await sleep(900);
      current = await chrome.tabs.get(tab.id);
    }

    if (!current.url || new URL(current.url).origin !== ACCOUNT) {
      throw new Error('Account 会话切换失败');
    }

    const actualLocalId = localIdFromUrl(current.url);
    const persisted = actualLocalId === null
      ? {ok:false}
      : await runIn(tab.id, readPersistedSessionUid, [Number(actualLocalId)]);
    logEvent('KeySalt', 'Account 目标会话已就绪', {
      accountLocalID:actualLocalId || 'none',
      uid:persisted.ok ? uidSuffix(persisted.uid) : 'unknown'
    });
    if (!persisted.ok || persisted.uid !== expectedUid) {
      throw new Error('Account 页面没有切换到与 Mail 相同的 Proton UID');
    }

    const accountCookies = await chrome.cookies.getAll({
      url:ACCOUNT + '/api/core/v4/keys/salts',
      storeId
    });
    const authName = `AUTH-${expectedUid}`;
    const hasAuth = accountCookies.some(cookie => cookie.name === authName && cookie.value);
    logEvent('KeySalt', 'Account Cookie 检查', {
      auth:hasAuth ? 'yes' : 'no',
      cookieCount:accountCookies.length
    });
    if (!hasAuth) {
      throw new Error('Account 域缺少当前 UID 的 AUTH Cookie，请在 account.proton.me 切换到同一账号后重试');
    }

    return await fn(tab.id);
  } finally {
    try { await chrome.tabs.remove(tab.id); } catch {}
  }
}

async function adminTab() {
  const tabs = await chrome.tabs.query({url:ADMIN + '*'});
  const tab = tabs.find(t => new URL(t.url).pathname === '/proton/import');
  if (!tab) throw new Error('请先打开 MCP 管理页并完成 Access 登录');
  return tab.id;
}

async function callMcp(operation, payload, tabId = null) {
  const result = await runIn(tabId ?? await adminTab(), mcpRequest, [operation,payload ?? null]);
  if (!result.ok) throw new Error(result.error);
  return result.data;
}

async function currentCookies() {
  if (!selectedTab || !storeId) throw new Error('请重新检测 Proton 页面');
  const tab = await chrome.tabs.get(selectedTab);
  if (new URL(tab.url).origin !== PROTON) throw new Error('Proton 页面已切换，请重新检测');
  const urls = [PROTON + '/api/core/v4/addresses', PROTON + '/api/auth/refresh'];
  const batches = await Promise.all(urls.map(url => chrome.cookies.getAll({url,storeId})));
  const unique = new Map();
  for (const cookie of batches.flat()) {
    const key = [cookie.storeId || storeId,cookie.domain,cookie.path,cookie.name].join('|');
    unique.set(key,cookie);
  }
  return [...unique.values()];
}

async function captureBundle(uid, updateUi = false) {
  const rows = await currentCookies();
  const state = sessionState(rows, uid);
  if (updateUi) {
    $('auth').textContent = state.auth ? '已获取' : '缺失';
    $('sessionId').textContent = state.sessionId ? '已获取' : '缺失';
    $('refresh').textContent = state.refresh ? '已获取' : '缺失';
    $('salt').textContent = state.ready ? '获取中…' : '待检测';
  }
  if (!state.auth) throw new Error('未找到当前会话的 AUTH Cookie');
  if (!state.refresh) throw new Error('未找到当前会话的 REFRESH Cookie');
  if (!state.sessionId) throw new Error('未找到 Proton Session-Id Cookie');

  const cookies = selectCookies(rows, uid);
  const mailTab = await chrome.tabs.get(selectedTab);
  const pageLocalId = localIdFromUrl(mailTab.url);
  const index = await runIn(selectedTab, readPersistedSessionIndex, []);
  const matching = (index.sessions || []).filter(item => item.uid === uid);
  const session = matching.find(item => String(item.localID) === pageLocalId) || matching[0];
  const localId = session ? String(session.localID) : null;
  logEvent('Session', 'Cookie 材料就绪', {
    uid:uidSuffix(uid),
    localID:localId || 'none',
    cookieCount:cookies.length
  });

  const mail = await runIn(selectedTab, readProton, [uid]);
  if (!mail.ok) {
    logEvent('Mail API', '读取用户信息失败', {uid:uidSuffix(uid),error:mail.error});
    throw new Error(mail.error);
  }
  logEvent('Mail API', 'users/addresses 成功', {uid:uidSuffix(uid),addressCount:mail.addresses?.length || 0});

  let keyPassword = '';
  let salts = {keySalts:[],client:{}};
  let keyMaterialSource = '';
  try {
    logEvent('解密材料', '从当前 Mail 持久会话恢复', {uid:uidSuffix(uid),localID:localId});
    const recovered = localId === null
      ? {ok:false,stage:'local-session',error:'未找到所选 UID 的 Mail 持久会话'}
      : await runIn(selectedTab, readSessionKeyPassword, [Number(localId), uid]);
    if (recovered.ok) {
      keyPassword = recovered.keyPassword;
      keyMaterialSource = 'browser-key-password';
      logEvent('解密材料', '浏览器 keyPassword 恢复成功', {
        uid:uidSuffix(uid),
        payloadVersion:recovered.diagnostics?.payloadVersion || 'n/a',
        status:recovered.diagnostics?.status || 200
      });
    } else {
      logEvent('解密材料', '浏览器 keyPassword 恢复失败，回退 KeySalt', {
        uid:uidSuffix(uid),
        stage:recovered.stage || 'n/a',
        status:recovered.status || 'n/a',
        protonCode:recovered.protonCode || 'n/a'
      });

      logEvent('KeySalt', '尝试 Mail 当前会话同源重放', {uid:uidSuffix(uid)});
      salts = await runIn(selectedTab, readKeySalts, [uid]);
      if (!salts.ok) {
        const mailFailure = salts.error || 'Mail 同源 KeySalt 获取失败';
        try {
          salts = await withAccountTab(uid, tabId => runIn(tabId, readKeySalts, [uid]));
        } catch (accountError) {
          const accountMessage = accountError instanceof Error ? accountError.message : 'Account 兼容路径失败';
          throw new Error(`浏览器解密材料恢复失败：${recovered.error}；KeySalt Mail：${mailFailure}；Account：${accountMessage}`);
        }
        if (!salts.ok) {
          throw new Error(`浏览器解密材料恢复失败：${recovered.error}；KeySalt Mail：${mailFailure}；Account：${salts.error}`);
        }
      }
      keyMaterialSource = 'key-salt';
      logEvent('KeySalt', '兼容路径获取成功', {
        uid:uidSuffix(uid),
        count:salts.keySalts?.length || 0
      });
    }
  } catch (error) {
    if (updateUi) $('salt').textContent = '获取失败';
    throw error;
  }

  const result = {
    ok:true,
    email:mail.email,
    user:mail.user,
    addresses:mail.addresses,
    keyPassword,
    keySalts:salts.keySalts || [],
    keyMaterialSource,
    client:{...(mail.client || {}),...(salts.client || {})}
  };
  // Proton may rotate cookies while the API calls above are in flight.
  const freshCookies = selectCookies(await currentCookies(), uid);
  const bundle = bundleFor(uid, freshCookies, result);
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

function publicBundle(bundle) {
  const copy = structuredClone(bundle);
  if (copy.keyPassword) {
    delete copy.keyPassword;
    copy.keyMaterial = {
      source:'browser-key-password',
      secretIncluded:false,
      note:'导出/预览不包含 keyPassword；确认导入时仅以内存中的实际 Bundle 上传'
    };
  }
  return copy;
}

function importEnvelope(bundle, account) {
  return {
    format:'personal-mail-mcp-proton-import-preview',
    version:2,
    exportedAt:new Date().toISOString(),
    target:{
      accountId:account.id,
      label:account.label,
      configuredEmail:account.email
    },
    bundle:publicBundle(bundle)
  };
}

function showPreview(bundle, account) {
  const envelope = importEnvelope(bundle, account);
  pendingImport = {bundle, account, envelope};
  $('previewEmail').textContent = bundle.email;
  $('previewAccount').textContent = account.label + (account.email ? ` · ${account.email}` : '');
  $('previewUid').textContent = bundle.uid.length > 8 ? '…' + bundle.uid.slice(-8) : bundle.uid;
  $('previewCookies').textContent = `${bundle.session.cookies.length} 个：${bundle.session.cookies.map(c => c.name).join(', ')}`;
  $('previewSalts').textContent = bundle.keyPassword
    ? '浏览器解密密钥已获取（不显示）'
    : `${bundle.keySalts?.length || 0} 个 KeySalt`;
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
  $('status').textContent = '已导出预览 JSON。文件包含 Session Cookie，但不包含浏览器 keyPassword。';
}

async function inspect() {
  ready = false;
  clearPreview();
  $('account').replaceChildren();
  $('connect').disabled = true;
  const uid = $('proton').value;
  if (!uid) throw new Error('请选择 Proton 会话');
  for (const id of ['auth','sessionId','refresh']) $(id).textContent = '检测中…';
  $('salt').textContent = '待检测';

  const bundle = await captureBundle(uid, true);
  const data = await callMcp('accounts');
  const matchingAccounts = data.accounts.filter(a => bundle.addresses.some(address =>
    address.email.toLowerCase() === String(a.email || '').trim().toLowerCase()));
  $('account').replaceChildren(...matchingAccounts.map(a => {
    const option = new Option(`${a.label} · ${a.email}`, a.id);
    option.dataset.label = a.label;
    option.dataset.email = a.email;
    return option;
  }));
  ready = matchingAccounts.length > 0;
  $('account').disabled = !ready;
  $('connect').disabled = !ready;
  $('status').textContent = ready
    ? `已就绪：Bundle v${bundle.version}。点击“预览并连接”核对后导入。`
    : 'MCP 中没有与当前 Proton 邮箱匹配的账号，请检查服务端账号配置';
}

async function detect() {
  ready = false;
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
  const mailLocalId = localIdFromUrl(tab.url);
  logEvent('检测', '找到 Proton Mail 标签页', {localID:mailLocalId || 'none',version:chrome.runtime.getManifest().version});
  const stores = await chrome.cookies.getAllCookieStores();
  storeId = stores.find(s => s.tabIds.includes(tab.id))?.id;
  if (!storeId) throw new Error('无法确定 Proton Cookie Store');

  const rows = await currentCookies();
  logEvent('Cookie', '读取完成', {
    total:rows.length,
    sessionId:rows.some(x => x.name === 'Session-Id') ? 'yes' : 'no',
    auth:rows.filter(x => x.name.startsWith('AUTH-')).length,
    refresh:rows.filter(x => x.name.startsWith('REFRESH-')).length
  });
  const candidates = sessionCandidates(rows);
  if (!candidates.length) throw new Error('没有找到同时包含 AUTH 和 REFRESH 的 Proton Session');

  let selectedUid = candidates[0].uid;
  let selectionMode = 'latest-fallback';
  if (mailLocalId !== null) {
    const persisted = await runIn(selectedTab, readPersistedSessionUid, [Number(mailLocalId)]);
    if (persisted.ok && candidates.some(item => item.uid === persisted.uid)) {
      selectedUid = persisted.uid;
      selectionMode = 'persisted-localid';
      logEvent('会话映射', 'ps-LocalID 精确匹配 UID', {
        localID:mailLocalId,
        uid:uidSuffix(selectedUid)
      });
    } else {
      logEvent('会话映射', 'ps-LocalID 映射不可用，尝试 API 映射', {
        localID:mailLocalId,
        persisted:persisted.ok ? uidSuffix(persisted.uid) : 'none'
      });
      const mapping = await runIn(selectedTab, readLocalSessions, [candidates[0].uid]);
      if (mapping.ok) {
        const exact = mapping.sessions.find(item => String(item.localID) === String(mailLocalId));
        if (exact && candidates.some(item => item.uid === exact.uid)) {
          selectedUid = exact.uid;
          selectionMode = 'api-localid';
          logEvent('会话映射', 'API LocalID 精确匹配 UID', {
            localID:mailLocalId,
            uid:uidSuffix(selectedUid),
            sessions:mapping.sessions.length
          });
        } else {
          logEvent('会话映射', 'API 未找到 LocalID 对应 UID，回退最新会话', {
            localID:mailLocalId,
            remoteSessions:mapping.sessions.length
          });
        }
      } else {
        logEvent('会话映射', 'API 映射读取失败，回退最新会话', {
          localID:mailLocalId,
          status:mapping.status || 'n/a',
          protonCode:mapping.protonCode || 'n/a'
        });
      }
    }
  }

  const ordered = [...candidates].sort((a,b) => {
    if (a.uid === selectedUid) return -1;
    if (b.uid === selectedUid) return 1;
    return b.expires-a.expires;
  });
  $('proton').replaceChildren(...ordered.map((item,i) =>
    new Option(`${item.uid===selectedUid
      ? (selectionMode!=='latest-fallback'?'当前页面会话':'最新会话')
      : '其他会话 '+(i+1)} · UID …${item.uid.slice(-6)}`,item.uid)
  ));
  $('proton').disabled = false;
  $('proton').value = selectedUid;
  logEvent('检测', selectionMode!=='latest-fallback'?'默认选择当前页面会话':'默认选择最新会话', {
    uid:uidSuffix(selectedUid),
    candidates:candidates.length,
    localID:mailLocalId || 'none'
  });
  $('status').textContent = selectionMode !== 'latest-fallback'
    ? `已按 LocalID ${mailLocalId} 选择当前页面会话。`
    : (candidates.length > 1
      ? `检测到 ${candidates.length} 个会话，LocalID 映射不可用，已回退最新会话。`
      : '已找到 Proton 会话，正在检测。');
  await inspect();
}

async function previewImport() {
  const uid = $('proton').value;
  if (!uid) throw new Error('请选择 Proton 会话');
  const account = accountMeta();
  const bundle = bundleForAccount(await captureBundle(uid, true), account);
  showPreview(bundle, account);
}

async function confirmImport() {
  const pending = pendingImport;
  if (!pending) throw new Error('预览已失效，请重新预览');
  $('previewDialog').close();
  $('status').textContent = '正在导入…';
  try {
    if (Date.now() - pending.bundle.capturedAt > 14 * 60 * 1000) {
      throw new Error('预览已过期，请重新预览后导入');
    }
    const current = selectCookies(await currentCookies(), pending.bundle.uid);
    const credentialRows = rows => rows.filter(c => /^(AUTH-|REFRESH-|Session-Id$)/.test(c.name))
      .map(c => JSON.stringify([c.name,c.domain,c.path,c.value])).sort();
    if (JSON.stringify(credentialRows(current)) !== JSON.stringify(credentialRows(pending.bundle.session.cookies))) {
      throw new Error('Proton 会话已更新，请重新预览后导入');
    }
    // Keep pair/import on the same authenticated management document.
    const targetTab = await adminTab();
    const pair = await callMcp('pair',{
      account:pending.account.id,
      uid:pending.bundle.uid,
      email:pending.bundle.email
    }, targetTab);
    if (!pair.token || !Number.isFinite(pair.expiresAt) || pair.expiresAt <= Date.now()) throw new Error('配对响应无效');
    const response = await callMcp('import',{
      account:pending.account.id,
      token:pair.token,
      bundle:pending.bundle
    }, targetTab);
    if (!response.success) throw new Error('导入未确认，请查看管理页');
    $('status').textContent = response.refreshTestRequired
      ? '导入成功。建议到管理页执行一次“测试续期”。'
      : '导入成功。';
    $('connect').disabled = true;
    ready = false;
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
    ready = false;
    const message = e instanceof Error ? e.message : '操作失败，请重新检测';
    logEvent('错误', message);
    $('status').textContent = message;
    if ($('diagnostics')) $('diagnostics').open = true;
  } finally {
    busy = false;
    $('detect').disabled = false;
    $('login').disabled = false;
    $('proton').disabled = !$('proton').options.length;
    $('account').disabled = !$('account').options.length;
    $('connect').disabled = !ready;
    $('closePreview').disabled = false;
    $('cancelPreview').disabled = false;
    $('exportBundle').disabled = !pendingImport;
    $('confirmImport').disabled = !pendingImport;
    $('copyLog').disabled = false;
    $('clearLog').disabled = false;
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
$('copyLog').onclick = async () => {
  try {
    await navigator.clipboard.writeText(diagnosticLog.join('\n') || '暂无日志');
    $('status').textContent = '诊断日志已复制。';
  } catch {
    $('status').textContent = '复制日志失败，请直接在日志框中查看。';
  }
};
$('clearLog').onclick = () => {
  diagnosticLog = [];
  $('logOutput').textContent = '暂无日志';
};

logEvent('扩展', '启动', {version:chrome.runtime.getManifest().version});
void act(detect);
