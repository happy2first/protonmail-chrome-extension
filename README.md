# Proton → Personal Mail MCP

简体中文 | [English](README.en.md)

将 Chrome / Edge 中已登录的 Proton Mail 会话导入 [Personal Mail MCP](https://github.com/happy2first/personal-mail-mcp)，供服务端访问邮箱。无需手工复制 Cookie，也无需在扩展中输入 Proton 密码。

**当前版本：0.4.5** · Manifest V3 · Browser Session Bundle v3

扩展支持当前会话识别、邮箱与别名匹配、导入预览和确认上传。首次使用配置自己的 MCP 服务地址，仓库不预设任何个人管理地址。

## 使用前准备

- 桌面 Chrome / Edge，Chromium 120 或更高版本；使用普通窗口和同一浏览器配置文件。
- 已登录 [Proton Mail](https://mail.proton.me)。当前不支持隐身窗口和分区 Cookie。
- 已部署兼容 Bundle v3 的 Personal Mail MCP，并配置目标 Proton 账号。该账号的邮箱须属于当前 Proton 会话，可以是别名。
- MCP 的 `/proton/import` 管理页可访问，并已完成 Cloudflare Access 登录。服务须返回有效的 HTTP `Date` 响应头。

服务端接口与鉴权要求见 [配套协议](docs/server-integration.md)。扩展不能独立提供邮箱 MCP 服务。

## 安装与升级

**安装无需 Node.js、npm 或构建。**

1. 在仓库选择 **Code → Download ZIP**，解压。
2. 打开 `chrome://extensions` 或 `edge://extensions`，开启“开发者模式”。
3. 点击“加载已解压的扩展程序”，选择仓库中的 **extension** 文件夹。该目录须直接包含 `manifest.json`。

也可从 [GitHub Actions](https://github.com/happy2first/protonmail-chrome-extension/actions) 的成功 `Extension checks` 运行中下载 `protonmail-chrome-extension-unpacked` 产物，解压后加载。下载产物通常需要登录 GitHub。

升级时用新文件替换原加载目录内容，在扩展管理页点击“重新加载”，确认版本为 **0.4.5**，再刷新 Proton Mail 和 MCP 管理页。已保存的服务地址会保留；已兼容的服务端无需因本次扩展升级而重新部署。

## 首次配置与导入

1. 打开扩展，在“MCP 服务地址”填写自己的 HTTPS 地址，例如 `https://mail.example.com`，也可粘贴完整的 `/proton/import` 管理页地址。点击一次“保存并授权”。只申请该站点权限；若授权框使扩展弹窗关闭，允许后重新打开即可，后台会完成保存。
2. 点击“打开管理页”，完成登录并保持页面打开。切回要导入的 Proton Mail 标签页，再打开扩展；必要时点击“重新检测”。
3. 等待会话和解密材料检测完成，核对 Proton 邮箱、所选会话与目标 MCP 账号。多会话时优先按当前页面的 LocalID 识别账号；无法精确映射时会回退，并提示核对。
4. 点击“预览并连接”，核对目标服务、邮箱、账号和材料状态。预览或取消均不会创建配对或上传会话。
5. 点击“确认导入”，等待成功提示。**导入期间保持扩展弹窗打开**，不要切换标签页或点击弹窗外部。
6. 刷新 MCP 管理页检查账号状态，再通过 MCP 读取邮件正文验证访问与解密。需要验证续期时，使用管理页的续期测试功能。

账号下拉框支持匹配已验证的 Proton 别名，以及能唯一匹配的服务端脱敏邮箱。存在歧义时不会猜测；配对时服务端仍校验完整邮箱。

可随时在“MCP 服务地址”修改目标服务。更改后会清空预览和账号选择，尝试撤销旧站点的可选权限，并要求重新检测。地址仅支持 HTTPS 站点根地址或 `/proton/import`，不支持其他子路径、查询参数或片段。

## 会话材料与安全

扩展不读取 Proton 原始登录密码。正常流程从浏览器已有的加密持久会话中，在内存恢复派生解密密钥 `keyPassword`；**它仍是敏感凭证**，确认后会连同会话 Cookie 上传到你配置的服务。

| 材料或权限 | 用途与处理方式 |
| --- | --- |
| 会话 Cookie | 读取所选 UID 的 AUTH、REFRESH、Session-Id 及适用 Cookie，保留 Domain、Path、HttpOnly、Secure、SameSite、到期时间等属性；排除其他 UID 的 AUTH / REFRESH 和过期 Cookie。 |
| `keyPassword` | 在内存恢复，确认后上传；不写入扩展存储、日志、预览或导出 JSON。 |
| 加密会话 blob、ClientKey、私钥 | blob 和 ClientKey 仅用于本地恢复，不上传；不上传私钥。 |
| `cookies`、`scripting` | 读取 Proton Cookie，在已打开的 Proton / MCP 页面隔离上下文执行同源请求，复用登录状态。 |
| 主机权限 | 固定权限限于 Proton 相关域；MCP 站点按配置单独授权。声明可选的 `https://*/*` 不代表安装时获得所有站点权限。 |
| `storage`、后台 worker | 仅保存公开的 `mcpOrigin` 服务地址；后台负责授权、保存和旧权限撤销，不读取邮箱会话。 |

派生密钥恢复失败时会尝试 Mail / Account 的 KeySalt 兼容路径。KeySalt 不等于解密密钥，该路径仍依赖服务端密码配置。

配对由已鉴权的服务端完成：扩展复用管理页的 Cloudflare Access 会话和 CSRF 校验，获得绑定身份、账号、UID 与邮箱的 **5 分钟一次性令牌**，随后提交 Bundle。扩展依据服务端时间校验令牌并校准上传时间戳，不放宽服务端有效期。

**预览和导出 JSON 仍包含敏感 Cookie**，只是排除了 `keyPassword`，不能作为完整解密备份。不要公开或附在 Issue 中；排障优先提供诊断日志。

扩展不会在导入时主动刷新会话，也不负责后台收信或长期续期。关闭弹窗不会保证撤销已发送的请求；退出 Proton 或撤销会话可能影响已导入的会话。长期有效性由 Proton 和服务端处理。

## 常见问题

| 现象 | 处理方法 |
| --- | --- |
| 首次授权时弹窗关闭 | 允许授权后重新打开扩展即可；0.4.5 已修复保存被中断的问题，无需再点一次保存。 |
| 找不到会话，或 Cookie 缺失 | 在同一浏览器配置文件登录 Mail，切回目标标签页，检查站点权限并重新检测。 |
| 没有匹配的 MCP 账号 | 核对服务端配置邮箱是否属于当前 Proton 账号；脱敏别名存在歧义时需服务端提供完整匹配信息。 |
| 管理页、CSRF 或配对接口错误 | 重新登录并刷新管理页，确认服务端支持 [配套协议](docs/server-integration.md)。 |
| 解密材料恢复失败 | 查看日志中的失败阶段与状态码；若提示 Account 会话不匹配，先切换至同一 Proton 账号。 |
| 超时 | Proton users / addresses 每个接口等待 30 秒，超时最多重试一次；配对等待 30 秒、导入 60 秒，POST 不自动重试。导入超时后先检查管理页状态。 |
| 时间校验失败 | 0.4.4 起使用服务端时间校准；检查服务的 HTTP `Date` 响应头和服务器时间。 |
| 会话已更新或预览过期 | 重新预览并确认。Cookie 变化或预览超过 14 分钟时拒绝上传旧材料。 |
| 导入成功但正文读取失败 | 检查服务端解密材料及具体读取错误；导入成功不能单独证明正文读取和续期均正常。 |

报告问题请提供扩展版本、浏览器版本、操作步骤和诊断日志，不要提供 Cookie 值、RefreshToken、派生密钥或导出文件。Proton 页面和接口变更可能需要更新扩展。

## 开发与验证

需要 Node.js 20+。单元测试无需第三方依赖：

```sh
npm test
```

Chromium 回归：

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

0.4.5 的 [自动检查](https://github.com/happy2first/protonmail-chrome-extension/actions/runs/37725067271)已通过，包括 48 项单元测试、语法检查及加载真实 MV3 扩展的 Chromium 回归。浏览器测试使用拦截的虚构网页与 API，不访问真实邮箱；覆盖三种持久会话格式、别名匹配、慢响应、设备时间偏差、导入确认、Cookie 变化，以及保存过程中弹窗关闭后配置仍生效。原生权限框的点击不在自动测试范围内。

基础会话导入已获得实际使用验证。邮件正文读取和长期续期仍应在各自部署环境单独核验。
