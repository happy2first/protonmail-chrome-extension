# Proton → Personal Mail MCP

[简体中文](README.md) | English

Import an authenticated Proton Mail session from Chrome / Edge into [Personal Mail MCP](https://github.com/happy2first/personal-mail-mcp) for server-side mailbox access. No manual Cookie copying or Proton password entry in the extension is required.

**Current version: 0.4.5** · Manifest V3 · Browser Session Bundle v3

The extension identifies browser sessions, matches mailboxes and aliases, previews the import, and uploads after confirmation. Configure your own MCP service on first use; no personal management URL is preset.

## Requirements

- Desktop Chrome / Edge with Chromium 120 or later, using a regular window and the same browser profile.
- An authenticated [Proton Mail](https://mail.proton.me) session. Incognito windows and partitioned Cookies are currently unsupported.
- A deployed Personal Mail MCP service compatible with Bundle v3, with a target Proton account configured. Its email must belong to the current Proton session; aliases are supported.
- Access to the service's `/proton/import` management page with Cloudflare Access login completed. The service must return a valid HTTP `Date` response header.

See the [server integration protocol](docs/server-integration.md) (Chinese) for endpoints and authentication requirements. The extension requires a separate mailbox MCP service.

## Install and upgrade

**Installation requires no Node.js, npm, or build step.**

1. Select **Code → Download ZIP** in the repository and extract it.
2. Open `chrome://extensions` or `edge://extensions` and enable **Developer mode**.
3. Select **Load unpacked** and choose the repository's **extension** folder, which must directly contain `manifest.json`.

Alternatively, download the `protonmail-chrome-extension-unpacked` artifact from a successful `Extension checks` run in [GitHub Actions](https://github.com/happy2first/protonmail-chrome-extension/actions), extract it, and load the extension. Artifact downloads usually require a GitHub login.

To upgrade, replace the files in the existing loaded directory, select **Reload** on the extensions page, confirm version **0.4.5**, and refresh Proton Mail and the MCP management page. The saved service address is retained. A compatible server does not need redeployment for this extension update.

## First-time setup and import

The popup currently uses Chinese labels; their English meanings are included below.

1. Open the extension and enter your HTTPS service address under **MCP 服务地址** (MCP service address), for example `https://mail.example.com`. A full `/proton/import` management URL is also accepted. Click **保存并授权** (Save and authorize) once. Only that site is requested. If the permission prompt closes the popup, approve it and reopen the extension; the background worker completes the save.
2. Click **打开管理页** (Open management page), sign in, and leave the page open. Return to the Proton Mail tab you want to import and reopen the extension; use **重新检测** (Detect again) if needed.
3. Wait for session and decryption material detection. Check the Proton email, selected session, and target MCP account. With multiple sessions, the extension first tries to identify the account by the current page's LocalID; if exact mapping fails, it falls back and asks you to check the selection.
4. Click **预览并连接** (Preview and connect). Check the service, email, account, and material status. Previewing or cancelling does not create a pairing token or upload the session.
5. Click **确认导入** (Confirm import) and wait for success. **Keep the popup open during import**; do not switch tabs or click outside it.
6. Refresh the MCP management page and check account status. Read a message body through MCP to verify access and decryption. Use the management page's renewal test when you need to verify session renewal.

The account selector supports verified Proton aliases and uniquely matching masked server emails. It does not guess when a match is ambiguous; the server still validates the full email during pairing.

You can change the destination under **MCP 服务地址**. A change clears the preview and account selection, attempts to revoke the previous site's optional permission, and requires detection again. Addresses must be HTTPS site roots or `/proton/import` URLs; other subpaths, query strings, and fragments are unsupported.

## Session material and security

The extension does not read your original Proton login password. The normal flow recovers a derived decryption key, `keyPassword`, in memory from the browser's existing encrypted persistent session. **This is still a sensitive credential** and is uploaded with session Cookies to your configured service after confirmation.

| Material or permission | Purpose and handling |
| --- | --- |
| Session Cookies | Reads AUTH, REFRESH, Session-Id, and applicable Cookies for the selected UID, preserving Domain, Path, HttpOnly, Secure, SameSite, and expiration attributes. Excludes other UIDs' AUTH / REFRESH and expired Cookies. |
| `keyPassword` | Recovered in memory and uploaded after confirmation; excluded from extension storage, logs, previews, and exported JSON. |
| Encrypted session blob, ClientKey, private keys | The blob and ClientKey are used locally for recovery and are not uploaded. Private keys are not uploaded. |
| `cookies`, `scripting` | Reads Proton Cookies and runs same-origin requests in isolated contexts of open Proton / MCP pages, reusing their authenticated sessions. |
| Host permissions | Required hosts are limited to Proton domains. Each configured MCP site is authorized separately. Optional `https://*/*` does not grant access to all sites at installation. |
| `storage`, background worker | Stores only the public `mcpOrigin` service address. The worker handles authorization, persistence, and old-permission cleanup; it does not read mailbox sessions. |

If derived-key recovery fails, the extension tries the Mail / Account KeySalt compatibility path. KeySalt is not a decryption key; this path still depends on server-side password configuration.

Pairing happens on the authenticated server. The extension reuses the management page's Cloudflare Access session and CSRF protection to obtain a **single-use token valid for five minutes**, bound to the identity, account, UID, and email, then submits the Bundle. Server time is used to validate the token and calibrate the upload timestamp; server expiry limits remain enforced.

**Previews and exported JSON still contain sensitive Cookies.** They omit `keyPassword` and are not complete decryption backups. Do not publish them or attach them to issues; use diagnostic logs for troubleshooting.

The extension does not proactively refresh the session during import and does not handle background mail collection or long-term renewal. Closing the popup does not guarantee cancellation of a request already sent. Signing out of Proton or revoking the session may affect the imported session. Long-term validity depends on Proton and the server.

## Troubleshooting

| Symptom | Action |
| --- | --- |
| Popup closes during first authorization | Approve access and reopen the extension. Version 0.4.5 fixes interrupted configuration saves; no second save click is needed. |
| Session not found or Cookies missing | Sign in to Mail in the same browser profile, return to the target tab, check site permissions, and detect again. |
| No matching MCP account | Check that the configured server email belongs to the current Proton account. Ambiguous masked aliases require full matching information from the server. |
| Management page, CSRF, or pairing endpoint error | Sign in again, refresh the management page, and check support for the [server protocol](docs/server-integration.md). |
| Decryption material recovery fails | Check the failing stage and status code in logs. If the Account session does not match, switch it to the same Proton account. |
| Timeout | Proton users / addresses each allow 30 seconds, with one retry on timeout. Pairing allows 30 seconds and import 60 seconds; POST requests are not retried automatically. Check management-page status before retrying an import. |
| Time validation fails | Version 0.4.4 and later calibrate against server time. Check the service's HTTP `Date` response header and server clock. |
| Session changed or preview expired | Preview again and confirm. Changed Cookies or a preview older than 14 minutes prevent stale material from being uploaded. |
| Import succeeds but message-body reading fails | Check server decryption material and the specific read error. Import success alone does not prove body reading or renewal works. |

When reporting an issue, include extension and browser versions, steps, and diagnostic logs. Do not provide Cookie values, RefreshTokens, derived keys, or exported files. Proton page or API changes may require an extension update.

## Development and verification

Requires Node.js 20+. Unit tests need no third-party dependencies:

```sh
npm test
```

Chromium regression tests:

```sh
npm ci
npx playwright install --with-deps chromium
npm run test:browser
```

Version 0.4.5 passed [automated checks](https://github.com/happy2first/protonmail-chrome-extension/actions/runs/37725067271): 48 unit tests, syntax checks, and Chromium regression tests loading the real MV3 extension. Browser tests intercept fictional pages and API responses rather than accessing real mailboxes. Coverage includes three persistent-session formats, alias matching, slow responses, device clock skew, import confirmation, Cookie changes, and configuration persistence after popup closure during a save. Native permission-prompt clicks are outside the automated test scope.

Basic session import has also been confirmed in actual use. Message-body reading and long-term renewal should be verified separately in each deployment.
