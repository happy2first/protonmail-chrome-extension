# 服务端配套协议 v1

仓库：`happy2first/personal-mail-mcp`。新增文件 `src/proton/extension-policy.js`、`src/proton/extension-session.js`；`src/entry.js` 加载扩展处理器；`import-page.js` 增加 CSRF meta 和两条路由；`cookies.js` 保留属性。

现有 `/proton/import` 仍必须通过 Cloudflare Access。扩展在该页面的隔离上下文读取 `meta[name=proton-extension-csrf]`，沿用 HttpOnly 双提交 CSRF Cookie。普通跨站请求不放行；不应为扩展添加 Access bypass。

## 接口

所有请求必须来自同源已登录管理页，`Content-Type: application/json`、`x-csrf-token`，禁止缓存，正文上限沿用 128 KiB。

| 路径 | 输入 | 输出 |
| --- | --- | --- |
| GET `/proton/import/api/accounts` | 无 | 现有脱敏账号列表 |
| POST `/proton/import/api/extension-pair` | `account`, `uid`, `email` | `token`, `expiresAt`（毫秒） |
| POST `/proton/import/api/extension-import` | `account`, `token`, `bundle` | `success`, `account`, `keySaltCount` |

`bundle` 包含 `version:1`、`source:"https://mail.proton.me"`、`uid`、`capturedAt`（毫秒）、`email`、`user:{ID,keyIds}`、`addresses:[{ID,Email}]`、`keySalts:[{ID,KeySalt}]`、结构化 `cookies`。没有密码或私钥字段。服务端只采用显式白名单字段；邮箱归属及密钥 ID 通过上游再次验证，不信任客户端快照。

配对摘要存入同一账号 Durable Object 的 `proton:extensionPair:v1`；只保留一个未使用配对，新配对使旧配对失效。记录不含原始 token 或 Session。令牌通过事务原子消费，过期记录即使尚存在也不能使用；下一次配对会覆盖，不增加清理定时任务。

导入使用独立客户端验证，禁止密码登录和显式 refresh；失败不覆盖原 Session。通过后用现有加密函数与相同 account-bound AAD 原子更新 `proton:session:v2` 与 `proton:cookies:v1`，清除事件游标并重建非敏感会话状态。该操作会替换**所选账号**的旧 Session，不影响其他账号。

## 服务端验证命令

```sh
npm install
npm run check
node --experimental-test-module-mocks --test test/proton-extension.integration.js
npx wrangler deploy --dry-run --outdir dist
```

部署通过原有 GitHub / Cloudflare 流程完成；无迁移、无需删 Worker。回滚服务端会使扩展提示接口未就绪；原手动导入页仍保留。
