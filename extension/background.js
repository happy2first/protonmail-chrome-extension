import {normalizeMcpOrigin} from './core.js';

let saving = false;

// A permission prompt may close the action popup. Keep the entire operation
// here so an approved address is persisted even if the sender disappears.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'saveMcpOrigin') return;
  const reply = result => { try { sendResponse(result); } catch {} };
  if (sender.id !== chrome.runtime.id || sender.url !== chrome.runtime.getURL('popup.html')) {
    reply({ok:false,error:'服务配置请求来源无效'});
    return;
  }
  if (saving) {
    reply({ok:false,error:'正在保存服务地址，请稍后重新打开扩展'});
    return;
  }
  let origin;
  let permission;
  try {
    origin = normalizeMcpOrigin(message.origin);
    // Click activation is forwarded by runtime.sendMessage. Do not await
    // anything before requesting the optional host permission.
    permission = chrome.permissions.request({origins:[origin + '/*']});
  } catch (error) {
    reply({ok:false,error:error.message});
    return;
  }
  saving = true;
  void (async () => {
    try {
      if (!await permission) throw new Error('未授权该服务地址的访问权限，配置未保存');
      const previous = (await chrome.storage.local.get('mcpOrigin')).mcpOrigin;
      await chrome.storage.local.set({mcpOrigin:origin});
      if (previous && previous !== origin) {
        // Persisted selection is authoritative even if cleanup fails.
        try { await chrome.permissions.remove({origins:[normalizeMcpOrigin(previous) + '/*']}); } catch {}
      }
      reply({ok:true,origin});
    } catch (error) {
      reply({ok:false,error:error.message || '保存服务地址失败'});
    } finally {
      saving = false;
    }
  })();
  return true;
});
