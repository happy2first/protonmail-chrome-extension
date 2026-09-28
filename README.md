# Proton → Personal Mail MCP

桌面 Chrome / Edge Manifest V3 扩展。把当前浏览器中选定的 Proton Browser Session Bundle v3 导入自己的 `mail.mcp.happyfirst.top`。扩展不会读取 Proton 原始登录密码；它会从当前 Proton Mail 的加密持久会话恢复 Proton 已派生的 `keyPassword`，用于后端解锁邮件私钥。

## 先部署配套服务端

原有 personal-mail-mcp 没有一次性扩展配对接口。需要先合并并部署本次配套变更（见 `docs/server-integration.md`），否则扩展会明确提示接口未就绪，不会上传 Session。

- 沿用现有 Cloudflare Access、`PROTON_SESSIONS` Durable Object 和 `PROTON_SESSION_KEY`。
- 不添加新 Secret、KV、D1、绑定或外部 CORS 白名单，也不删除重建 Worker。
- 必须已有目标 Proton 账号配置；检测出的邮箱应与该账号配置的邮箱一致。
- 扩展导入不等于免密码解密：读取正文仍依赖服务端原有的解密配置。不要把 Proton 密码填进扩展。

## 本地加载（无需构建、无需 npm install）

1. 在 GitHub 点 **Code → Download ZIP**，完整解压。
2. Chrome 打开 `chrome://extensions`；Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，点“加载已解压的扩展程序”。
4. 选择仓库内 **extension** 文件夹（里面直接有 `manifest.json`），不要选仓库根目录。
5. 使用普通窗口登录 `https://mail.proton.me`。
6. 打开 `https://mail.mcp.happyfirst.top/proton/import` 并完成 Cloudflare Access 登录。部署过服务端更新后刷新此页。保持页面打开。
7. 切回 Proton 标签页，点击扩展图标。扩展会按实际 Proton API URL 读取 Cookie，并从当前 Proton 页面自己的 `ps-<LocalID>` 持久会话记录中只读取 `UID` 字段来精确确定 `/u/<LocalID>/...` 对应的会话；不会读取或上传其中的加密 `blob`。如果该映射不可用，才调用 `GET /api/auth/v4/sessions/local`，最后才回退到按 `AUTH-*` 到期时间选择最新会话。
8. AUTH、REFRESH、Session-Id 就绪后，扩展读取当前 `ps-<LocalID>` 的加密持久会话 blob，并通过当前 Mail Session 请求 `GET /api/auth/v4/sessions/local/key` 获取 `ClientKey`。扩展仅在内存中用 AES-GCM 解密 blob，提取 Proton 已派生的 `keyPassword`；不会读取用户原始登录密码。若该流程失败，才回退到原 KeySalt 兼容路径。
9. 选择对应 MCP 账号，点击“预览并连接”。扩展会先显示 Proton 邮箱、目标 MCP 账号、UID、Cookie 名称和解密材料状态；此时尚未发起配对或上传 Bundle。预览 JSON 不显示 `keyPassword`。
10. 如需留档或排障，可在确认窗口点击“导出 JSON”。导出文件包含 Session Cookie，但主动排除 `keyPassword`；仍应按敏感凭证保管。
11. 核对无误后点击“确认导入”。只有此时扩展才创建一次性配对并上传 Bundle。**导入过程中保持 Popup 打开**。
12. 成功后在 MCP 管理页刷新状态。扩展不会在导入阶段主动 refresh；需要验证实际续期时使用管理页“测试续期”。

也可从 GitHub Actions 的 `protonmail-chrome-extension-unpacked` artifact 下载扩展文件，解压后加载含 `manifest.json` 的目录。

## 实现范围与安全边界

- 扩展分别按 `https://mail.proton.me/api/core/v4/addresses` 和 `https://mail.proton.me/api/auth/refresh` 查询 Cookie，让 Chrome 直接返回实际会随这两个请求发送的 HttpOnly Cookie，避免自行猜测 Domain/Path；同时声明 `https://proton.me/*` 主机权限，以读取 `Domain=proton.me` 的 `Session-Id` 父域 Cookie。不会使用 `document.cookie`。
- 保留 Domain、Path、HttpOnly、Secure、SameSite、HostOnly、Session、Expires（`expirationDate` 为秒，`expiresAt` 为毫秒）。会话 Cookie 的到期时间为 null。
- Bundle v3 强制要求同一 UID 的 `AUTH-<UID>`、`REFRESH-<UID>` 与 `Session-Id`，并优先携带从当前 Proton 持久会话恢复的派生 `keyPassword`；如果该恢复不可用，才允许 KeySalt 兼容材料。排除其他 UID、其他域名与过期 Cookie。
- mail API 与派生解密材料恢复都在当前 `mail.proton.me` 标签页的 **ISOLATED world** 中执行。扩展会读取当前 `ps-<LocalID>` 的加密 `blob`，但只在本地内存中解密并提取 `keyPassword`；不会上传原始 blob、`ClientKey`、密码框内容或用户原始登录密码。
- 使用已登录 MCP 管理页发起同源请求，复用 Access 与 CSRF。令牌有效期 5 分钟，绑定 Access 身份、目标账号、邮箱、UID；使用后失效，失败也必须重新配对。令牌和 Cookie 不进入 URL。
- 无 service worker、定时器轮询、storage 权限、遥测、控制台敏感输出、远程脚本或可配置上传地址。`keyPassword` 仅保存在 Popup/页面执行上下文的内存中，并在确认导入时上传；预览和导出 JSON 会主动排除它。JS 字符串无法保证物理内存安全擦除。
- 服务端独立核对真实邮箱归属和密钥 ID，通过后复用 AES-GCM 加密并原子写入会话和 Cookie。失败不替换原会话。Proton 网页退出登录或撤销 Session 后，服务端会话也可能失效。
- 当前协议 Header 版本 `web-mail@5.0.133.5` 与 `web-account@5.0.420.1` 位于 `extension/bridge.js`；它们不是用户凭证，也不要求用户手工复制。Proton 非公开接口可能调整；403/9101/版本错误时扩展停止，不自动密码登录、不绕过 2FA 或 Access。

## 测试

Node.js 20+：`npm test`。测试使用虚构 Cookie，不连接真实邮箱。GitHub Actions 执行测试、语法检查并产出 unpacked 文件。

已在开发环境通过扩展单元测试、服务端配对/导入测试、原有后端完整测试与 Workers dry-run（最终结果见提交说明）。真实浏览器安装与真实 Proton Session 导入需按上述步骤在桌面验证，未声称通过云端端到端测试。

手动验收：未登录提示、Mail `ps-<LocalID>`→UID 精确会话选择、`/auth/v4/sessions/local/key` 获取、持久会话 AES-GCM 解密、派生 `keyPassword` 恢复、KeySalt fallback、Session-Id、导入前预览、确认前不上传、导出 JSON 不含 `keyPassword`、成功导入后管理页状态。Popup 提供“诊断日志”，仅显示步骤、HTTP 状态、Proton Code、LocalID 和 UID 尾号，不记录 Cookie 值、RefreshToken、KeySalt 或密码。除用户主动导出的 JSON 外，不应留下本地敏感存储。
