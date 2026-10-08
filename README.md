# Proton → Personal Mail MCP

将桌面浏览器中已登录的 Proton Mail 会话导入 [Personal Mail MCP](https://github.com/happy2first/personal-mail-mcp)，供服务端访问邮箱。扩展提供会话检测、账号匹配、导入预览和确认上传，不负责后台收信或自动续期。

当前扩展版本：**0.4.4**。使用 Manifest V3，导入协议为 **Browser Session Bundle v3**。

扩展不会读取 Proton 原始登录密码。正常流程会从浏览器已有的加密会话中恢复派生解密密钥 `keyPassword`，并在你确认导入后连同会话 Cookie 上传到指定 MCP 服务端。

## 使用条件

- 桌面 Chrome / Edge；扩展声明的最低 Chromium 版本为 120，建议使用浏览器稳定版。
- 使用普通浏览器窗口，并已登录 [Proton Mail](https://mail.proton.me)。当前不支持隐身窗口和分区 Cookie。
- 首次使用填写自己的 MCP HTTPS 服务地址，授权该站点访问；在同一浏览器配置文件中打开该服务的 `/proton/import` 管理页，完成 Cloudflare Access 登录。
- 服务端已配置目标 Proton 账号，并支持 Bundle v3 的账号查询、一次性配对和导入接口。配置邮箱须属于当前 Proton 会话，可以是其别名地址。

本仓库不预设管理服务地址。首次使用在“MCP 服务地址”填写自己的 HTTPS 域名（也可粘贴 `/proton/import` 管理页地址），点击“保存并授权”。扩展仅保存该地址，按需申请指定站点访问权限；以后可在同一位置修改。修改后会清空预览、撤销旧服务的可选权限并要求重新检测。服务端接口与配置要求见 [配套协议](docs/server-integration.md)；已有兼容部署无需重复部署，不能仅凭扩展版本判断线上服务端是否已更新。

## 安装与升级

**安装不需要 Node.js、npm 或构建步骤。**

1. 在本仓库选择 **Code → Download ZIP**，解压全部文件。
2. Chrome 打开 `chrome://extensions`，Edge 打开 `edge://extensions`。
3. 开启“开发者模式”，点击“加载已解压的扩展程序”。
4. 选择仓库内的 **extension** 文件夹，确保该目录直接包含 `manifest.json`，不要选择仓库根目录。

也可在 [GitHub Actions](https://github.com/happy2first/protonmail-chrome-extension/actions) 中打开一次成功的 `Extension checks`，下载 `protonmail-chrome-extension-unpacked` 产物，解压后加载包含 `manifest.json` 的目录。下载 Actions 产物通常需要登录 GitHub。

**升级已有扩展：** 用新版本文件替换原加载目录的内容，在扩展管理页点击“重新加载”，确认版本为 **0.4.4**；随后刷新 Proton Mail 和 MCP 管理页。

## 导入流程

1. 首次使用先配置自己的 MCP 服务地址并授权。点击“打开管理页”完成登录；登录 Proton Mail，保持两个页面打开。
2. 切回要导入的 Proton Mail 标签页，点击扩展图标。
3. 等待 AUTH、Session-Id、REFRESH 和解密材料检测完成。多账号时核对所选 Proton 会话及显示的邮箱。
4. 选择目标 MCP 账号。下拉框只显示能匹配当前 Proton 会话地址的账号，包括别名；兼容服务端脱敏邮箱列表，仅在当前地址列表中唯一匹配时列出。服务端在配对时仍核对完整邮箱；没有匹配项或别名脱敏结果有歧义时不能导入。
5. 点击“预览并连接”，核对目标服务域名、Proton 邮箱、目标账号和材料状态。此时尚未创建配对或上传会话。
6. 点击“确认导入”，等待成功提示。**上传期间保持扩展弹窗打开**，不要切换标签页或点击弹窗外部。
7. 成功后刷新 MCP 管理页，检查账号状态，并通过 MCP 读取一封邮件正文，验证实际访问与解密。需要验证续期时，再使用管理页的续期测试功能。

取消预览不会上传会话。导入成功后连接按钮会停用；需要再次导入时点击“重新检测”。关闭并重新打开扩展也会重新检测。

扩展不会在导入时主动刷新 Proton 会话，也不会在后台维持登录。导入不等于已验证长期续期；后续由服务端处理。Proton 网页退出登录或撤销会话可能影响已导入的会话。

## 数据与权限

| 数据或权限 | 实际用途与处理方式 |
| --- | --- |
| `cookies` | 从浏览器 Cookie Jar 读取适用于 Proton API 的 Cookie，包括 HttpOnly Cookie；保留 Domain、Path、Secure、SameSite、到期时间等属性。 |
| `scripting` | 在已打开的 Proton / MCP 页面隔离上下文中执行同源请求，复用登录状态。 |
| Proton 主机权限 | `proton.me` 用于父域 Cookie，`mail.proton.me` 用于当前会话；`account.proton.me` 用于 KeySalt 兼容路径。 |
| MCP 主机权限 | 通过可选主机权限申请用户配置的 HTTPS 站点，通过该站点已登录管理页完成配对与导入；声明 `https://*/*` 只用于按需授权，并不在安装时取得所有 HTTPS 站点权限。 |
| `storage` | 仅在扩展本地保存 `mcpOrigin` 服务地址，不保存 Cookie、配对令牌或解密材料。 |
| 会话 Cookie | 必须包含所选 UID 的 AUTH、REFRESH 及 Session-Id；排除其他 UID 的 AUTH / REFRESH、无关域和过期 Cookie。确认后上传。 |
| `keyPassword` | 从所选会话的加密持久记录中在内存恢复；确认后上传，不显示在预览或导出文件中。 |
| 原始登录密码、私钥 | 扩展不读取密码输入框，不上传原始登录密码或私钥。 |
| 加密会话 blob、ClientKey | 仅用于浏览器内恢复解密材料，不随 Bundle 上传。 |

派生密钥恢复失败时，扩展会尝试 KeySalt 兼容路径：先请求 Mail，再尝试 Account。**KeySalt 不等于解密密钥**，该路径仍依赖服务端的密码配置。

扩展没有后台 service worker、收信轮询或遥测；storage 权限仅用于保存服务地址。上传使用管理页现有 Access 和 CSRF 校验，不绕过登录或二步验证。服务端验证和加密保存规则见 [配套协议](docs/server-integration.md)。内存中的 JavaScript 字符串无法保证物理安全擦除。

### 预览与导出

“导出 JSON”仅供本地核对或排障，**不是包含所有解密材料的完整备份**。预览和导出会排除 `keyPassword`；实际确认上传使用内存中的 Bundle。

预览及导出保留会话 Cookie；若使用 KeySalt 兼容路径，也会包含 KeySalt。文件仍是敏感凭证，请勿公开或直接附在 Issue 中。一般排障优先提供“诊断日志”，不要提供导出文件。

Proton 用户信息读取的每个接口最多等待 30 秒，仅超时会再尝试一次；HTTP 错误不自动重试。失败日志包含具体接口、尝试次数和耗时。

### 配对与鉴权

配对由服务端完成。扩展在用户已登录的管理页中发送同源 POST，复用 Cloudflare Access 会话，并携带 CSRF Header。服务端生成一次性令牌，绑定验证后的登录身份、目标账号、Proton UID 和邮箱，有效期 5 分钟；服务端消费令牌并验证 Bundle 后才接受导入。失败后重新预览会创建新的配对，不复用旧令牌。

扩展兼容直接返回的配对对象和 `{ok:true,data:...}` 响应，将数字字符串形式的毫秒到期时间转换为数字。HTTP 200 的业务失败仍会拒绝。配对日志只记录令牌是否存在、到期字段类型和有效性，不记录令牌内容。扩展请求配对等待 30 秒、导入等待 60 秒，不自动重试 POST；超时后先检查管理页状态。令牌校验和上传时间戳使用已鉴权服务的 HTTP `Date` 时间，并通过单调时钟计算预览年龄，避免设备时钟偏差导致误报过期。服务须返回有效的 `Date` 响应头；扩展不修改系统时间，也不放宽服务端令牌有效期。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 找不到 Proton 标签页或会话 | 在同一浏览器配置文件的普通窗口登录 Mail，切回该标签页，再打开扩展。 |
| AUTH / REFRESH / Session-Id 缺失 | 确认 Mail 登录仍有效，刷新页面后重新检测，并检查扩展的站点访问权限。 |
| 没有匹配的 MCP 账号 | 核对 Proton 会话及服务端配置邮箱；目标邮箱须在当前 Proton 地址列表中。 |
| 管理页登录、CSRF 或接口未就绪错误 | 重新打开并登录管理页，刷新页面；确认服务端部署支持 Bundle v3 配套接口。 |
| 无法恢复解密材料，兼容路径也失败 | 查看诊断日志中的失败阶段与状态码；如提示 Account 会话不匹配，在 Account 页面切换到同一账号后重新检测。 |
| 提示会话已更新或预览已过期 | 重新预览后确认，避免上传旧 Cookie。预览超过 14 分钟会被拒绝。 |
| 上传中弹窗关闭 | 回管理页核对是否已导入；需要重试时重新打开扩展并检测。不要假定关闭弹窗会撤销已经发送的请求。 |
| 导入成功但读取正文失败 | 检查服务端部署、解密材料状态及读取错误。扩展导入成功不能单独证明邮件读取和续期均正常。 |

报告问题时提供扩展版本、浏览器版本、操作步骤及诊断日志。日志用于记录步骤、HTTP 状态、Proton Code 和会话定位信息，不应包含 Cookie 值、RefreshToken 或解密材料。Proton 接口并非稳定的公开集成协议，接口或页面格式调整后可能需要更新扩展。

## 开发与测试

开发测试需要 Node.js 20+。单元测试无需安装第三方依赖：

```sh
npm test
```

浏览器回归使用 Playwright：

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

单元测试包含将注入函数序列化后放入独立上下文运行的回归，防止模块内测试掩盖浏览器注入依赖丢失的问题。浏览器测试加载真实 MV3 扩展，但网页和 API 响应均为拦截后的虚构数据，不访问真实邮箱或线上 MCP。

覆盖内容包括三种持久会话加密格式、HttpOnly 父域 Cookie、账号切换与别名匹配、预览与确认上传、Cookie 变化、检测失败和 KeySalt 兼容路径。GitHub Actions 通过单元测试、语法检查及 Chromium 回归后，才上传扩展产物。

0.4.2 修复脱敏邮箱匹配与慢响应处理；0.4.4 修复设备与服务端时钟偏差导致的令牌误判和 Bundle 时间戳问题；0.4.3 增加首次配置服务地址、可选站点授权、目标服务预览，以及配对响应格式兼容和安全诊断。

**验证状态：** 0.4.1 的 [GitHub Actions 检查](https://github.com/happy2first/protonmail-chrome-extension/actions/runs/37087689842)已全部通过。真实账号与线上 Worker 的端到端导入、正文读取和续期仍需在实际环境验收。

