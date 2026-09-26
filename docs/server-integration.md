# 服务端配套协议 v2

仓库：`happy2first/personal-mail-mcp`。服务端新增 `src/proton/extension-policy.js`、`src/proton/extension-session.js`；`src/entry.js` 加载扩展处理器；`import-page.js` 提供 CSRF meta、配对与导入路由。管理页仅保留当前高级手工故障排查流程：普通 Session Cookie + 专用 REFRESH Cookie + KeySalt JSON；旧 Session JSON / 旧 REFRESH-* 兼容导入及其通用 `/api/import` 入口已移除。

现有 `/proton/import` 仍必须通过 Cloudflare Access。扩展在该页面的隔离上下文读取 `meta[name=proton-extension-csrf]`，沿用 HttpOnly 双提交 CSRF Cookie。普通跨站请求不放行；不为扩展添加 Access bypass。

## Browser Session Bundle v2

扩展上传的 `bundle`：

- `version: 2`
- `source: "proton-browser-session"`
- `uid`、`capturedAt`、`email`
- `session.cookies`：结构化 Cookie Jar，保留 Domain、Path、HostOnly、HttpOnly、Secure、SameSite、Expires 等浏览器属性
- 必须包含同一 UID 的 `AUTH-<UID>`、`REFRESH-<UID>` 和 `Session-Id`
- `user:{id,keyIds,passwordMode?}`
- `addresses:[{id,email}]`
- `keySalts:[{id,keySalt}]`
- `client:{mailAppVersion,accountAppVersion,locale}` 仅用于诊断，不作为秘密凭证或信任依据

Bundle 不包含 Proton 密码、AccessToken、私钥或页面存储内容。

`REFRESH-<UID>` 必须能覆盖 `/api/auth/refresh`，服务端会解析其 URL-encoded JSON 内容并确认内部 UID 与 Bundle UID 一致。`AUTH-<UID>` 必须覆盖普通 Proton API 路径，且必须存在 `Session-Id`。

## 接口

所有请求必须来自同源已登录管理页，POST 使用 `Content-Type: application/json` 与 `x-csrf-token`，禁止缓存，正文上限沿用 128 KiB。

| 路径 | 输入 | 输出 |
| --- | --- | --- |
| GET `/proton/import/api/accounts` | 无 | 脱敏账号列表 |
| POST `/proton/import/api/extension-pair` | `account`, `uid`, `email` | `token`, `expiresAt`（毫秒） |
| POST `/proton/import/api/extension-import` | `account`, `token`, `bundle` | `success`, `account`, `bundleVersion`, `keySaltCount`, `refreshTestRequired` |
| POST `/proton/import/api/import-key-salts` | `account`, `keySalts` | 手工故障排查专用 KeySalt 导入结果 |

Access 身份由服务端从 Cloudflare Access JWT 注入，不信任扩展传入的身份字段。

配对摘要存入同一账号 Durable Object 的 `proton:extensionPair:v2`，使用现有 `PROTON_SESSION_KEY` 加密。记录仅保存 token SHA-256、UID、邮箱、Access 身份与过期时间；原始 token 不落盘。配对有效期 5 分钟；导入一旦消费 token，无论后续 Bundle 验证成功或失败，都需要重新配对。

## 服务端验证与持久化

导入使用独立 ProtonClient 验证，不执行密码登录，也不主动调用 `/auth/refresh`：

1. 校验 Bundle 版本、时间、UID、Cookie Domain/Path。
2. 校验同一 UID 的 AUTH / REFRESH / Session-Id。
3. 使用 Bundle Cookie Session 调用 `/core/v4/addresses` 与 `/core/v4/users`。
4. 校验配置邮箱、Bundle 邮箱、User ID。
5. 校验 KeySalt ID 至少匹配一个当前 Active User Key。
6. 仅在全部验证通过后替换所选账号的持久 Session。
7. 使用现有 AES-GCM account-bound AAD 保存 `proton:session:v2`、`proton:cookies:v1` 与 KeySalt。
8. 清除事件游标与旧 human-verification 状态。

导入阶段不主动 refresh，避免扩展刚复制 Browser Session 时立即与浏览器竞争同一 REFRESH rotation。导入后管理页应显示 AUTH / Session-Id / REFRESH / KeySalt 状态；用户可显式点击“测试自动续期”，该请求会真实调用 `POST /auth/refresh` 并保存 Proton 下发的最新 Cookie。

## x-pm-* Header

`x-pm-uid` 由 Bundle UID / Worker auth 状态自动生成；`x-pm-appversion`、`x-pm-apiversion`、locale 等属于协议参数，不要求用户复制，也不作为长期秘密保存。扩展分别在 mail/account 同源页面使用自己的 app-version 常量，Worker 使用服务端配置。

## 服务端验证命令

```sh
npm install
npm run check
npx wrangler deploy --dry-run --outdir dist
```

部署无需 Durable Object 迁移、无需新增 KV/D1/Secret。回滚服务端会使扩展提示配对接口未就绪；原手工导入页仍保留。
