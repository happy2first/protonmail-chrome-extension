# Proton Mail → Mail MCP Worker（Chrome / Edge 扩展）

**简体中文** · [English](README.en.md) · [配套 Mail MCP Worker 服务端](https://github.com/happy2first/mail-mcp-worker) · [服务端零命令行部署教程](https://github.com/happy2first/mail-mcp-worker/blob/main/docs/USER-GUIDE.md)

将 Chrome / Edge 中**已经登录的 Proton Mail 浏览器会话**安全地导入你自己部署的 [Mail MCP Worker](https://github.com/happy2first/mail-mcp-worker)，以便 ChatGPT、Claude 等远程 MCP 客户端通过 Worker 访问 Proton 邮件。

**当前版本：0.4.5 · Manifest V3 · Browser Session Bundle v3。** 这是浏览器端会话导入工具，**不是 MCP Server**，也不必在 Cloudflare 部署这个扩展仓库。

> 先部署 Mail MCP Worker，再安装扩展。仅使用 QQ、163、Gmail 等 IMAP/SMTP 邮箱时，无需此扩展。扩展不会要求你输入 Proton 原始登录密码，但经过确认后会向**你自己配置的** Worker 发送敏感的 Cookie 与派生解密材料，务必核对服务端地址。

## 先理解两者的关系

| 项目 | Mail MCP Worker（服务端） | Proton Mail Chrome Extension（本仓库） |
| --- | --- | --- |
| 在哪里运行 | Cloudflare Workers | 你的桌面 Chrome / Edge |
| 是否要部署 | **是**，先部署 | 否，本地“加载已解压的扩展程序”即可 |
| 做什么 | 管理邮箱、提供 <code>/mcp</code>、加密保存 Proton Session | 从已登录 Proton 浏览器识别会话、预览、确认导入 |
| 登录与保护 | Cloudflare Access + Managed OAuth | 复用已登录的 Proton 标签页和 Worker 管理页 |
| 入口 | <code>https://mail.example.com/proton/import</code> | 浏览器工具栏上的扩展图标 |

**正确顺序：** Fork [服务端仓库](https://github.com/happy2first/mail-mcp-worker) → Cloudflare 部署 Worker → 配置自定义域名、Access 和 Proton 账号 → 安装本扩展 → 导入 Session → 测试读信 → 在 ChatGPT 中连接 Worker 的 <code>/mcp</code>。

## 使用前准备

1. **服务端已部署**：[Mail MCP Worker 中文 README](https://github.com/happy2first/mail-mcp-worker/blob/main/README.md)，尤其完成 Cloudflare Access、<code>PROTON_SESSION_KEY</code>、<code>PROTON_SESSIONS</code> 及至少一个 Proton 账号的变量配置。服务器邮箱必须与浏览器 Proton 邮箱或其已验证别名匹配。
2. 有可正常访问的受 Cloudflare Access 保护的管理页，例如 <code>https://mail.example.com/proton/import</code>。
3. 桌面 Chrome 或 Edge，Chromium 120 或更新版本，**普通窗口与同一个浏览器个人资料（Profile）**；不支持隐身窗口和分区 Cookie。
4. 在该浏览器中打开 [Proton Mail](https://mail.proton.me) 并保持登录；建议同时保持 Proton 标签页和 MCP 管理页打开。
5. Worker 返回有效的 HTTP <code>Date</code> 响应头，用于配对令牌与时间戳校准。

## 第一步：安装扩展（不用 npm，不用编译）

1. 在[本仓库首页](https://github.com/happy2first/protonmail-chrome-extension)点击绿色 **Code → Download ZIP**，下载项目压缩包。
2. 解压 ZIP，例如解压到你会长期保留的目录。不要直接在 ZIP 压缩包里打开文件。
3. 在 Chrome 地址栏输入 <code>chrome://extensions</code>；Edge 输入 <code>edge://extensions</code>。
4. 打开右上角或侧边栏的 **开发者模式 / Developer mode**。
5. 点击 **加载已解压的扩展程序 / Load unpacked**。
6. 选择解压后的 **extension** 子目录。**注意：必须直接包含 <code>manifest.json</code>，不能选择仓库最外层目录。**
7. 扩展列表应出现 **Proton → Mail MCP Worker**，版本 **0.4.5**。建议固定到浏览器工具栏，方便后续导入。

也可以在 [GitHub Actions](https://github.com/happy2first/protonmail-chrome-extension/actions) 的成功 **Extension checks** 工作流中下载 <code>protonmail-chrome-extension-unpacked</code> 产物（可能要求登录 GitHub），解压后仍按上述“Load unpacked”加载。

**更新版本：** 从仓库重新下载 ZIP，用新文件覆盖原先的扩展目录，在扩展管理页面点击 **重新加载 / Reload**，再刷新 Proton Mail 与 Worker 管理页。已保存的服务地址会保留；请核对实际显示版本。**不要**把旧目录删除后又选错了新的根目录。

## 第二步：在 Worker 管理页登录 Cloudflare Access

1. 浏览器打开你自己的地址，例如 <code>https://mail.example.com/proton/import</code>。
2. 如果跳出 Cloudflare Access 登录，选择已获允许的邮箱或身份完成登录。进入页面后应看到 Proton 账号列表。
3. 若页面提示没有 Proton 账号，请回到 [Mail MCP Worker 配置步骤](https://github.com/happy2first/mail-mcp-worker/blob/main/docs/USER-GUIDE.md#第-5-步variables-and-secrets最容易填错)，检查 <code>MAIL_ACCOUNTS</code>、<code>MAIL_<ID>_PROVIDER=proton</code>、<code>EMAIL</code>、<code>CREDENTIAL</code> 与 <code>PROTON_SESSION_KEY</code>。
4. **保持管理页标签打开**，不要对 <code>/proton/import</code> 配置 Access bypass。

## 第三步：配置扩展的 MCP 服务地址（首次只需一次）

1. 点击浏览器工具栏的 Proton → Mail MCP Worker 扩展。
2. 展开 **MCP 服务地址**，输入自己的 HTTPS 站点根地址，例如：

   ~~~text
   https://mail.example.com
   ~~~

   也可直接填写 <code>https://mail.example.com/proton/import</code>。**不要**填写 <code>/mcp</code>，不支持额外子路径、查询参数或 <code>#fragment</code>；必须是 HTTPS。
3. 点击 **保存并授权**，允许浏览器对**这个具体服务域名**授权。首次弹出的浏览器权限确认可能让小弹窗自动关闭，**只需批准权限并重新打开扩展**；0.4.5 会由后台完成保存，无须再次点击保存。
4. 点击 **打开管理页**，确认打开的是自己的域名，且已经完成 Cloudflare Access 登录。

扩展默认**不包含作者的私人服务地址**；只保存配置的公开 <code>mcpOrigin</code> 地址，不把原始 Proton 密码、Cookie 或解密密钥保存在扩展设置中。更换地址将清空预览与账号选择，并尝试撤销旧站点的可选权限。

## 第四步：检测浏览器 Proton 会话

1. 同一 Chrome/Edge Profile 打开 <code>https://mail.proton.me</code> 并确认已登录正确的 Proton 账号。
2. 切回 Proton Mail 标签页，点击扩展图标，必要时点 **重新检测**。
3. 观察 **Proton 会话**、**AUTH**、**Session-Id**、**REFRESH** 和 **解密材料** 状态。
4. 在 **目标 MCP 账号** 下拉框中选择对应账号。扩展优先根据当前 Proton 页面的 LocalID 识别会话，也可以匹配已验证别名或唯一对应的脱敏邮箱。
5. 如果有多个 Proton 账号，**一定要核对邮箱和目标账号对应关系**。别名无法唯一匹配时扩展不会猜测，服务端配对时也会重新校验归属。

## 第五步：预览并确认导入

1. 点击 **预览并连接**，核对弹窗中的 **目标服务、Proton 邮箱、目标账号、UID、Cookie 状态、解密材料状态**。
2. 预览或取消不会向服务端创建配对，也不会上传 Bundle。预览区域/导出的 JSON 虽不含 <code>keyPassword</code>，仍可能含**可用的 Session Cookie**，请当作密码保护。
3. 确认无误后点击 **确认导入**。扩展复用管理页的 Access 会话与 CSRF 校验，请求绑定身份/账号/UID/邮箱的**五分钟一次性配对令牌**，再提交 Browser Session Bundle v3。
4. **导入过程中不要关闭弹窗、切换标签页或点击弹窗外面。** POST 不会自动重试；如果超时，先检查管理页是否已经成功，避免重复导入。
5. 导入成功后，返回 Worker 的 <code>/proton/import</code> 页面刷新状态。

> 服务端导入时会验证会话、邮箱归属和派生解密材料，并用 <code>PROTON_SESSION_KEY</code> 加密保存到 Durable Object。导入时**不会自动执行 Proton RefreshToken 刷新**，以避免与浏览器正在使用的会话竞争旋转。

## 第六步：验证是否真正可用

1. 在管理页确认 Session 已保存、Cookie 及解密材料状态正常。
2. 通过 ChatGPT 或其他远程 MCP 客户端连接 **<code>https://mail.example.com/mcp</code>**，用 <code>mail_list_accounts</code> 确认账号，再调用 <code>mail_list_messages</code> / <code>mail_get_message</code> **实际读取一封 Proton 邮件正文**。
3. 如需验证自动续期，可以在管理页**显式**点击“测试自动续期”。这会真实刷新一次 Proton 会话并保存新 Cookie，**不要无故连续测试**。
4. 后续出现会话过期时，重新登录 Proton Mail 并通过扩展重新导入，不必重新部署 Worker。

## 材料与权限：实际会读取、上传什么？

| 内容 | 处理 |
| --- | --- |
| 所选 UID 的 AUTH、REFRESH、Session-Id Cookie | 读取并在用户确认后以 Bundle v3 发给自己部署的 Worker；保留 Cookie 属性并排除其他 UID 的凭证 |
| <code>keyPassword</code>（派生解密材料） | 从浏览器已有的加密持久会话**在内存中恢复**，经用户确认后上传；不存入扩展 Storage、日志、预览或导出 JSON |
| 原始 Proton 登录密码 | **不读取、不上传** |
| 本地加密 Session blob、ClientKey、私钥 | blob 与 ClientKey 只在本地恢复流程中使用，不上传；私钥不上传 |
| <code>cookies</code>、<code>scripting</code> 权限 | 读取 Proton 会话、在已打开的 Proton/MCP 页面上下文完成同源请求 |
| 可选的 <code>https://*/*</code> 权限声明 | 安装时不会自动授权所有站点；具体 MCP 域名须用户单独允许 |
| <code>storage</code> | 仅保存配置的服务地址 |

若恢复派生密钥失败，扩展会尝试兼容的 KeySalt 路径；KeySalt **不是**解密密钥，仍可能需要服务端密码配置才能解密。会话长期有效性受 Proton 服务端、Cookie 更新和 Worker 的续期逻辑影响。

## 常见问题

| 表现 | 解决办法 |
| --- | --- |
| 第一次授权后扩展弹窗关闭 | 先在浏览器权限框点允许，再重新打开扩展；0.4.5 不需要重新保存第二次。 |
| 检测不到 Proton 会话 / Cookie 缺失 | 同一普通浏览器 Profile 登录 Proton Mail，切回该标签页、检查权限并点“重新检测”；隐身窗口与分区 Cookie 不支持。 |
| 无法找到匹配的 MCP 账号 | 核对服务端 <code>MAIL_ACCOUNTS</code> 和邮箱 Secret；确认 Proton 别名属于当前账号，不要混用其他账号。 |
| 无法访问管理页、配对/CSRF 错误 | 在同一浏览器先登录 Cloudflare Access 并刷新 <code>/proton/import</code>，确认服务器使用 Bundle v3 接口。 |
| 解密材料检测失败 | 展开 **诊断日志**，看失败阶段与 HTTP 状态；若 Account 会话账号不同，切换到同一 Proton 账号再试。 |
| 导入超时 | users/addresses 单接口约 30 秒、配对约 30 秒、导入约 60 秒；先回管理页确认是否已成功，不要盲目重复提交。 |
| 时间校验失败 | 扩展根据 Worker HTTP <code>Date</code> 校准服务端时间；检查响应头及服务器时间。 |
| 预览过期 / Cookie 已更新 | 重新检测、重新预览并确认；预览超过约 14 分钟或 Cookie 已变化时旧数据不能继续上传。 |
| 成功导入但读不到正文 | 到管理页查解密状态及具体邮件读取错误；导入成功并不等于所有邮件均可解密。 |
| 换了 Worker/域名 | 在“MCP 服务地址”改成新 HTTPS 域名，重新授权、打开管理页和导入会话。 |

报告问题时请提供扩展版本、Chrome/Edge 版本、错误步骤及**脱敏诊断日志**，不要提交 Cookie、RefreshToken、<code>keyPassword</code>、导出的预览 JSON 或 Cloudflare Secret。

## 开发、验证与兼容性

扩展从 0.4.5 使用的 Bundle v3 服务器协议见 [docs/server-integration.md](docs/server-integration.md)，其中包含配对、CSRF、会话验证与服务端加密逻辑。

如需开发/测试：Node.js 20+，运行：

~~~sh
npm test
npm ci
npx playwright install --with-deps chromium
npm run test:browser
~~~

版本 0.4.5 的[既有自动测试](https://github.com/happy2first/protonmail-chrome-extension/actions/runs/37725067271)覆盖 48 项单元测试、语法检查及隔离的 Chromium MV3 扩展回归（使用模拟页面/API，不连接真实邮箱）。真实 Proton 邮件读取、长期自动续期需在自己的部署上验证。

**许可证和使用责任：** 使用前审查源码、只连接可信的自己部署的 Worker，并保护账号与会话材料。服务端：[Mail MCP Worker](https://github.com/happy2first/mail-mcp-worker)。
