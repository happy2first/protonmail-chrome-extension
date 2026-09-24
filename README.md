# Proton → Personal Mail MCP

桌面 Chrome / Edge Manifest V3 扩展。把当前浏览器中选定的 Proton Browser Session Bundle v2 导入自己的 `mail.mcp.happyfirst.top`，不读取、保存或上传 Proton 密码。会在 `mail.proton.me` 读取会话，在 `account.proton.me` 同源重放 KeySalt 请求。

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
7. 切回 Proton 标签页，点击扩展图标。扩展会从 Cookie Jar 识别 UID，读取同一 UID 的 `AUTH-*`、`REFRESH-*`、`Session-Id` 与必要辅助 Cookie，并请求 users / addresses。
8. 扩展会自动打开一个后台 `account.proton.me/mail` 标签页，在该同源环境重放 `GET /api/core/v4/keys/salts`，取得 KeySalt 后自动关闭该临时标签页。多个会话需要先选择，再核对显示的邮箱地址。
9. 选择对应 MCP 账号，核对固定上传域名，点击“一键连接 Personal Mail MCP”。**连接过程中保持 Popup 打开**。
10. 成功后在 MCP 管理页刷新状态，检查 AUTH、Session-Id、REFRESH 和 KeySalt。扩展不会在导入阶段主动 refresh；需要验证实际续期时使用管理页“测试自动续期”。

也可从 GitHub Actions 的 `protonmail-chrome-extension-unpacked` artifact 下载扩展文件，解压后加载含 `manifest.json` 的目录。

## 实现范围与安全边界

- `chrome.cookies.getAll({domain:'proton.me',storeId})` 读取正确 Cookie Store，包含受 Path 限制的 HttpOnly Cookie；不会使用 `document.cookie`。
- 保留 Domain、Path、HttpOnly、Secure、SameSite、HostOnly、Session、Expires（`expirationDate` 为秒，`expiresAt` 为毫秒）。会话 Cookie 的到期时间为 null。
- Bundle v2 强制要求同一 UID 的 `AUTH-<UID>`、`REFRESH-<UID>` 与 `Session-Id`，并保留适用于 mail.proton.me 的辅助 Cookie；排除其他 UID、其他域名与过期 Cookie。第一版拒绝隐身和分区 Cookie，避免错误重放。
- mail API 请求在 `mail.proton.me` 标签页的 **ISOLATED world** 中执行；KeySalt 请求在 `account.proton.me` 同源标签页的 **ISOLATED world** 中执行。只读取用户 ID、密钥 ID、地址和 KeySalt；不访问网页存储、密码框、页面 JS 内存，不导出加密/解密私钥。
- 使用已登录 MCP 管理页发起同源请求，复用 Access 与 CSRF。令牌有效期 5 分钟，绑定 Access 身份、目标账号、邮箱、UID；使用后失效，失败也必须重新配对。令牌和 Cookie 不进入 URL。
- 无 service worker、定时器轮询、storage 权限、遥测、控制台敏感输出、远程脚本或可配置上传地址。Popup 只在内存处理敏感数据；关闭后没有持久化副本。JS 字符串无法保证物理内存安全擦除。
- 服务端独立核对真实邮箱归属和密钥 ID，通过后复用 AES-GCM 加密并原子写入会话和 Cookie。失败不替换原会话。Proton 网页退出登录或撤销 Session 后，服务端会话也可能失效。
- 当前协议 Header 版本 `web-mail@5.0.133.5` 与 `web-account@5.0.420.1` 位于 `extension/bridge.js`；它们不是用户凭证，也不要求用户手工复制。Proton 非公开接口可能调整；403/9101/版本错误时扩展停止，不自动密码登录、不绕过 2FA 或 Access。

## 测试

Node.js 20+：`npm test`。测试使用虚构 Cookie，不连接真实邮箱。GitHub Actions 执行测试、语法检查并产出 unpacked 文件。

已在开发环境通过扩展单元测试、服务端配对/导入测试、原有后端完整测试与 Workers dry-run（最终结果见提交说明）。真实浏览器安装与真实 Proton Session 导入需按上述步骤在桌面验证，未声称通过云端端到端测试。

手动验收：未登录提示、多会话选择、错误目标账号拒绝、成功导入后管理页状态、关闭 Popup 再打开重新检测、无本地敏感存储。不要将 Cookie/KeySalt、配对 token 或包含它们的网络截图贴到 Issue。
