# Proton Mail → Mail MCP Worker (Chrome / Edge extension)

[简体中文](README.md) · **English** · [Mail MCP Worker server](https://github.com/happy2first/mail-mcp-worker) · [Server deployment guide](https://github.com/happy2first/mail-mcp-worker/blob/main/docs/QUICK-START.en.md)

Import an **already authenticated Proton Mail browser session** from desktop Chrome/Edge into **your own self-hosted** [Mail MCP Worker](https://github.com/happy2first/mail-mcp-worker), enabling compatible clients such as ChatGPT or Claude to access Proton through your remote MCP server.

**Version 0.4.5 · Manifest V3 · Browser Session Bundle v3.** This is a **local browser extension**, **not** an MCP server, and does not need to be deployed to Cloudflare.

> **Deploy the server first.** The extension does not ask for your original Proton sign-in password, but after you confirm import it sends sensitive session Cookies and derived decryption material to the HTTPS MCP server you configured. Check that the destination really belongs to you.

## What belongs where?

| | Mail MCP Worker (server) | Proton Mail Chrome Extension (this repository) |
| --- | --- | --- |
| Runs on | Cloudflare Workers | Your desktop Chrome/Edge |
| Needs deployment? | **Yes**, deploy first | **No**, install locally with Load unpacked |
| Responsibility | Manage mailboxes, serve <code>/mcp</code>, encrypt Proton sessions in Durable Objects | Detect an authenticated Proton browser session, preview, confirm and upload |
| Authentication | Cloudflare Access / Managed OAuth | Existing Proton Mail tab and authenticated Worker management page |
| Where to open | <code>https://mail.example.com/proton/import</code> | Browser toolbar extension icon |

**End-to-end order:** Fork and deploy [Mail MCP Worker](https://github.com/happy2first/mail-mcp-worker) → configure domain, Access and Proton account → install this extension → import session → confirm real mail-body access → add the server's <code>/mcp</code> URL to ChatGPT.

If you only connect IMAP/SMTP providers (QQ, 163, Gmail, etc.), you do **not** need this extension.

## Requirements

1. A deployed compatible [Mail MCP Worker](https://github.com/happy2first/mail-mcp-worker/blob/main/README.en.md), with <code>PROTON_SESSIONS</code>, <code>PROTON_SESSION_KEY</code> and a configured <code>MAIL_<ID>_PROVIDER=proton</code> account. The configured address must match the browser's Proton mailbox or verified alias.
2. Access to <code>https://mail.example.com/proton/import</code>, protected by **Cloudflare Access**.
3. Desktop Chrome/Edge based on Chromium 120+, in a **normal window and the same browser profile**. Incognito sessions and partitioned Cookies are unsupported.
4. A signed-in [Proton Mail](https://mail.proton.me) tab; preferably leave both Proton and the Worker management tab open.
5. A valid HTTP <code>Date</code> response header from the server, used to calibrate pairing time.

## Step 1 — Install (no npm/build required)

1. Open [this GitHub repository](https://github.com/happy2first/protonmail-chrome-extension) and select the green **Code → Download ZIP** menu.
2. Extract the ZIP into a **persistent directory**. Do not attempt to run the files inside the archive.
3. In Chrome, visit <code>chrome://extensions</code>; in Edge, visit <code>edge://extensions</code>.
4. Enable **Developer mode**.
5. Select **Load unpacked** and choose the extracted **extension** subfolder, the one **directly containing <code>manifest.json</code>**. Do not select the repository's top-level folder.
6. The extension should display **Proton → Mail MCP Worker**, version **0.4.5**. Pin it to the toolbar if convenient.

Alternatively, download the <code>protonmail-chrome-extension-unpacked</code> artifact from a successful **Extension checks** [GitHub Actions run](https://github.com/happy2first/protonmail-chrome-extension/actions). A GitHub login may be required to download the artifact.

**Upgrade:** replace the contents of your existing loaded extension directory with a newer extracted release, click **Reload** on the extensions page, and refresh your Proton and management tabs. The saved server URL is preserved. Confirm the displayed version.

## Step 2 — Sign in to the Worker's management page

1. Visit <code>https://mail.example.com/proton/import</code>, replacing the host with your own deployed Worker domain.
2. Complete the Cloudflare Access login with an identity allowed by your application's policy.
3. The management page should show at least one Proton account. If there are none, return to the [server runtime-variable guide](https://github.com/happy2first/mail-mcp-worker/blob/main/docs/QUICK-START.en.md#step-5--configure-runtime-bindings) and check <code>MAIL_ACCOUNTS</code>, account <code>PROVIDER/EMAIL/CREDENTIAL</code> and <code>PROTON_SESSION_KEY</code>.
4. Keep the management tab open. **Do not bypass Access** for <code>/proton/import</code>.

## Step 3 — Configure the extension's MCP service URL (once)

1. Open the toolbar popup and expand **MCP 服务地址** ("MCP service address").
2. Enter **your own HTTPS site origin**, for example:

   ~~~text
   https://mail.example.com
   ~~~

   You may alternatively paste the full <code>https://mail.example.com/proton/import</code> management URL. **Do not** paste the <code>/mcp</code> endpoint. Extra subpaths, queries and fragments are not accepted.
3. Click **保存并授权** ("Save and authorize") and approve the browser's optional host-access permission **for that exact configured site**.
4. The permission dialog may close the popup: approve it and reopen the extension. In v0.4.5 the background worker completes the save without a second click.
5. Click **打开管理页** ("Open management page") and check that it opens **your** Worker domain, signed in via Cloudflare Access.

There is **no preconfigured personal service URL**. Extension storage saves only the public <code>mcpOrigin</code>, not your Proton password, Cookies or derived keys. Changing the server clears the preview and account selection and attempts to revoke permission for the old origin.

## Step 4 — Detect a Proton session

1. In the same Chrome/Edge browser profile, open <code>https://mail.proton.me</code> and sign into the correct Proton mailbox.
2. Return to that Proton tab, open the extension and choose **重新检测** ("Detect again") when needed.
3. Review **Proton 会话** (session), **AUTH**, **Session-Id**, **REFRESH**, and **解密材料** (decryption material) status.
4. Under **目标 MCP 账号** ("Target MCP account"), select the destination mailbox configured on your Worker.
5. With multiple Proton sessions, the extension prefers the current tab's LocalID; it also recognizes verified aliases and uniquely matched masked addresses. **Verify the selected email and target account**. The server performs its own full-match validation at pairing.

## Step 5 — Preview and import

1. Click **预览并连接** ("Preview and connect") and inspect the target site, Proton email, account, UID, Cookie status and decryption status.
2. Preview or cancel does **not** create a pairing token or upload the Bundle. Preview/export JSON **still contains sensitive Session Cookies**, although it excludes <code>keyPassword</code>.
3. Choose **确认导入** ("Confirm import"). The extension reuses the Access-authenticated management page and CSRF token to obtain a **five-minute, single-use** pairing token bound to identity, mailbox, UID and email. It then submits **Browser Session Bundle v3**.
4. **Keep the popup open during the upload**. Do not switch tabs or click away. Import POST calls are not automatically retried; after timeout, check management status before trying again.
5. Refresh <code>/proton/import</code> after successful import.

The server verifies Cookie ownership, Proton user/address and derived decryption material. It encrypts the accepted session with <code>PROTON_SESSION_KEY</code> in a Durable Object. Import **does not proactively refresh** Proton tokens, avoiding refresh-rotation races with the browser.

## Step 6 — Verify actual functionality

1. Confirm Session, Cookie and decryption material status on the management page.
2. Add <code>https://mail.example.com/mcp</code> to a remote-MCP-capable client (not <code>/proton/import</code>) and complete Cloudflare Access OAuth.
3. Run <code>mail_list_accounts</code>, then <code>mail_list_messages</code> and <code>mail_get_message</code> to **read a real message body**; this tests decryption, not just import acceptance.
4. If needed, explicitly test renewal on the management page. **It performs a real refresh and saves updated Cookies**; avoid repeated unnecessary tests.
5. If Proton revokes or expires the session later, sign into Proton again and re-import with the extension; the Worker usually does not need redeployment.

## Permissions and sensitive material

| Material / permission | Handling |
| --- | --- |
| Cookies: AUTH, REFRESH, Session-Id for selected UID | Read for the selected session and uploaded with Bundle v3 only after confirmation, preserving relevant cookie attributes |
| <code>keyPassword</code> | Derived decryption material recovered **in memory** from Proton's encrypted persistent browser session; uploaded after confirmation, but omitted from extension storage, logs, preview and exported JSON |
| Original Proton login password | **Never read or uploaded** |
| Encrypted session blob / ClientKey / private keys | Blob and ClientKey only used locally; none of these are uploaded |
| <code>cookies</code>, <code>scripting</code> | Read Proton state and perform same-origin requests on existing Proton/Worker tabs |
| Optional <code>https://*/*</code> host permission declaration | Does **not** automatically grant access to arbitrary sites on installation; each configured Worker site is authorized separately |
| <code>storage</code> / background worker | Persists only the nonsecret service origin and manages permission state |

If the preferred derived-key method fails, a KeySalt compatibility fallback may run. **KeySalt is not a decryption key** and may still require server-side password configuration. Long-term session validity is controlled by Proton and the server implementation.

## Troubleshooting

| Symptom | What to do |
| --- | --- |
| Popup closes during initial authorization | Allow the requested host, then reopen the popup. v0.4.5 persists the setting without a second save. |
| No Proton session or Cookies detected | Sign into Mail in the same normal browser profile, return to its tab, check permissions and detect again. Incognito and partitioned cookies are unsupported. |
| No matching server mailbox | Verify <code>MAIL_ACCOUNTS</code> and the email Secret on your Worker; ensure the selected Proton address or alias belongs to this session. |
| Management/CSRF/pairing error | Complete Cloudflare Access sign-in in the **same profile**, refresh <code>/proton/import</code> and verify the server supports Bundle v3. |
| Derived material unavailable | Open **诊断日志** ("Diagnostic logs") for the failing stage/status; switch the Proton Account tab to the matching account if necessary. |
| Timeout | Proton users/addresses API calls typically allow 30s, pairing 30s, import 60s. Check management status before resubmitting an import POST. |
| Clock / timestamp validation failed | The extension calibrates against the Worker's HTTP <code>Date</code>. Inspect the header and server time. |
| Preview expired or Cookies changed | Detect and preview again; material older than ~14 minutes or bound to changed Cookies is rejected. |
| Import succeeded but message body unreadable | Check server decryption validation, management status and specific read error. Success does not guarantee full message decryption. |
| Worker/domain changed | Update **MCP 服务地址** with the new HTTPS origin, authorize it, open management and import again. |

For issue reports, share the extension and Chrome/Edge versions, reproduction steps and **redacted diagnostic logs**. Never share Cookies, RefreshTokens, <code>keyPassword</code>, exported preview JSON or Cloudflare Secrets.

## Development and compatibility

The v0.4.5 server-side **Bundle v3** contract is documented in [docs/server-integration.md](docs/server-integration.md), including the pairing endpoints, CSRF and encrypted persistence.

Requires Node.js 20+ for development:

~~~sh
npm test
npm ci
npx playwright install --with-deps chromium
npm run test:browser
~~~

The earlier v0.4.5 [automated check](https://github.com/happy2first/protonmail-chrome-extension/actions/runs/37725067271) covered 48 unit tests, syntax checks and isolated Chromium MV3 integration scenarios using intercepted sample pages/API responses. Real mailbox body access and long-term refresh must be verified on your own deployment.

Review the source before use, keep all session material private and connect only to a trusted Worker you control. Server: [Mail MCP Worker](https://github.com/happy2first/mail-mcp-worker).
