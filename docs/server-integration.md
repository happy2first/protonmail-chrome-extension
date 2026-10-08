# 服务端配套协议 v3

仓库：`happy2first/personal-mail-mcp`。服务端新增 `src/proton/extension-policy.js`、`src/proton/extension-session.js`；`src/entry.js` 加载扩展处理器；`import-page.js` 提供 CSRF meta、配对与导入路由。管理页仅保留当前高级手工故障排查流程：普通 Session Cookie + 专用 REFRESH Cookie + KeySalt JSON；旧 Session JSON / 旧 REFRESH-* 兼容导入及其通用 `/api/import` 入口已移除。

用户配置的服务地址下的 `/proton/import` 仍必须通过 Cloudflare Access。扩展在该页面的隔离上下文读取 `meta[name=proton-extension-csrf]`，沿用 HttpOnly 双提交 CSRF Cookie。普通跨站请求不放行；不为扩展添加 Access bypass。

## Browser Session Bundle v3

扩展上传的 `bundle`：

- `version: 3`
- `source: "proton-browser-session"`
- `uid`、`capturedAt`、`email`
- `session.cookies`：结构化 Cookie Jar，保留 Domain、Path、HostOnly、HttpOnly、Secure、SameSite、Expires 等浏览器属性
- 必须包含同一 UID 的 `AUTH-<UID>`、`REFRESH-<UID>` 和 `Session-Id`
- `user:{id,keyIds,passwordMode?}`
- `addresses:[{id,email}]`
- `keyPassword`：首选，来自当前 Proton Mail 持久会话解密出的 Proton 派生密钥；不是用户原始登录密码
- `keySalts:[{id,keySalt}]`：仅作为兼容 fallback
- `client:{mailAppVersion,accountAppVersion,locale}` 仅用于诊断，不作为秘密凭证或信任依据

Bundle 不包含 Proton 原始登录密码、AccessToken 或私钥。正常路径会包含敏感的派生 `keyPassword`，仅在确认导入时从扩展内存上传；预览和导出 JSON 会主动排除该字段。

扩展在上传前先在本地 Popup 中显示脱敏预览。用户可导出同一份脱敏 JSON，但其中不包含 `keyPassword`。只有点击“确认导入”后，扩展才把内存中的完整 Bundle 通过 `extension-pair` / `extension-import` 上传；取消预览不会创建配对，也不会上传 Bundle。

### 浏览器解密材料

正常路径不再要求扩展调用 `/core/v4/keys/salts`。扩展读取当前 Mail 页面 `ps-<LocalID>` 中的加密持久会话 blob，并使用当前 Cookie Session 调用 `GET /api/auth/v4/sessions/local/key` 获取 `ClientKey`。随后只在扩展内存中按 Proton WebClients 的持久会话格式执行 AES-GCM 解密，提取其中的派生 `keyPassword`。原始 blob 和 ClientKey 不上传；`keyPassword` 不写日志、不展示、不导出。

`REFRESH-<UID>` 必须能覆盖 `/api/auth/refresh`，服务端会解析其 URL-encoded JSON 内容并确认内部 UID 与 Bundle UID 一致。`AUTH-<UID>` 必须覆盖普通 Proton API 路径，且必须存在 `Session-Id`。

## 接口

所有请求必须来自同源已登录管理页，POST 使用 `Content-Type: application/json` 与 `x-csrf-token`，禁止缓存，正文上限沿用 128 KiB。

| 路径 | 输入 | 输出 |
| --- | --- | --- |
| GET `/proton/import/api/accounts` | 无 | 脱敏账号列表 |
| POST `/proton/import/api/extension-pair` | `account`, `uid`, `email` | `token`, `expiresAt`（毫秒） |
| POST `/proton/import/api/extension-import` | `account`, `token`, `bundle` | `success`, `account`, `bundleVersion`, `keyMaterialSource`, `decryptionVerified`, `refreshTestRequired` |
| POST `/proton/import/api/import-key-salts` | `account`, `keySalts` | 手工故障排查专用 KeySalt 导入结果 |

Access 身份由服务端从 Cloudflare Access JWT 注入，不信任扩展传入的身份字段。

配对摘要存入同一账号 Durable Object 的 `proton:extensionPair:v3`，使用现有 `PROTON_SESSION_KEY` 加密。记录仅保存 token SHA-256、UID、邮箱、Access 身份与过期时间；原始 token 不落盘。配对有效期 5 分钟；导入一旦消费 token，无论后续 Bundle 验证成功或失败，都需要重新配对。

## 服务端验证与持久化

导入使用独立 ProtonClient 验证，不执行密码登录，也不主动调用 `/auth/refresh`：

1. 校验 Bundle 版本、时间、UID、Cookie Domain/Path。
2. 校验同一 UID 的 AUTH / REFRESH / Session-Id。
3. 使用 Bundle Cookie Session 调用 `/core/v4/addresses` 与 `/core/v4/users`。
4. 校验配置邮箱、Bundle 邮箱、User ID。
5. 若 Bundle 含浏览器派生 `keyPassword`，用它实际解锁当前 Proton 用户/地址私钥；只有解锁成功才接受导入。若没有 `keyPassword`，才校验 KeySalt ID 至少匹配当前 Active User Key。
6. 仅在全部验证通过后替换所选账号的持久 Session。
7. 使用现有 `PROTON_SESSION_KEY` + account-bound AAD 加密保存 `proton:session:v2` 和 `proton:cookies:v1`；`keyPassword` 随 auth Session 一起加密，不单独明文落盘。
8. 清除事件游标与旧 human-verification 状态。

导入阶段不主动 refresh，避免扩展刚复制 Browser Session 时立即与浏览器竞争同一 REFRESH rotation。导入后管理页应显示 AUTH / Session-Id / REFRESH / 解密材料状态；用户可显式点击“测试自动续期”，该请求会真实调用 `POST /auth/refresh` 并保存 Proton 下发的最新 Cookie。

## x-pm-* Header

`x-pm-uid` 由 Bundle UID / Worker auth 状态自动生成；`x-pm-appversion`、`x-pm-apiversion`、locale 等属于协议参数，不要求用户复制，也不作为长期秘密保存。扩展分别在 mail/account 同源页面使用自己的 app-version 常量，Worker 使用服务端配置。

## 服务端验证命令

```sh
npm install
npm run check
npx wrangler deploy --dry-run --outdir dist
```

部署无需 Durable Object 迁移、无需新增 KV/D1/Secret。回滚服务端会使扩展提示配对接口未就绪；原手工导入页仍保留。


## 可配置服务地址（扩展 0.4.3+）

首次使用必须配置 HTTPS 服务地址，扩展只申请该站点的可选主机权限，并在注入请求时核对配置的 origin 与 `/proton/import` 路径。管理页、账号查询、配对及上传使用同一地址。变更地址会使旧预览失效。扩展兼容直接 JSON 和 `{ok:true,data:...}` 成功包装，仍拒绝业务失败；`expiresAt` 必须是未来的毫秒时间戳（数字或数字字符串）。不支持子路径部署。

扩展 0.4.4+ 使用已登录同源响应中的 HTTP `Date` 校准时间，服务端需保留有效 Date Header。Bundle capturedAt 转换为服务端时间；预览年龄通过浏览器单调时钟独立验证。一次性令牌的 5 分钟有效期仍由服务端强制检查。
