# Antigravity CLI Assistant and Web OAuth Flow

## Goal

Provide a unified, frictionless authentication experience for Google Antigravity on 9Router by combining:
1. **Antigravity CLI Assistant:** Seamlessly auto-capture existing active logins directly from the system keyring (Windows Credential Manager / macOS Keychain) and ADC with 1-click import, or guide the user through launching `agy auth login` and auto-capturing the resulting token.
2. **Direct Web OAuth Flow:** Allow users to authenticate Google Antigravity accounts directly through the browser using Google OAuth without requiring any local CLI installation.

## Architecture and Components

### 1. Antigravity CLI Assistant (Native Keyring + ADC Discovery)
- **Native Keyring Reader (`src/lib/oauth/antigravityLocal.js`):**
  - **Windows:** Queries Windows Credential Manager via PowerShell / `CredReadW` for the target `gemini:antigravity`.
  - **macOS:** Queries macOS Keychain via `security find-generic-password` for service `gemini` and account `antigravity`.
  - **Fallback:** Scans standard Google Cloud SDK ADC (`application_default_credentials.json`).
- **Token Ingestion & Project Discovery:**
  - When credentials are found in the keyring or ADC, the server refreshes the token using `ANTIGRAVITY_CONFIG.clientId` / `clientSecret`.
  - Runs `antigravity.postExchange()` to fetch user email and resolve `projectId` via `loadCodeAssist`.
  - Saves the connection to SQLite `providerConnections` via `createProviderConnection`.
  - Strips all secret tokens from the HTTP response.
- **CLI Login Helper:**
  - An optional modal / helper that checks if `agy` is installed.
  - If the user wants to log in a new account via CLI, launches or guides the user through `agy auth login`, polls or captures the newly written keyring credential, and imports it immediately.

### 2. Direct Web OAuth Flow
- **Initiation (`src/lib/oauth/providers/antigravity.js` & `src/lib/oauth/services/antigravity.js`):**
  - Constructs Google OAuth authorization URL with:
    - `client_id`: Antigravity IDE OAuth Client ID
    - `scopes`: `https://www.googleapis.com/auth/cloud-platform`, `https://www.googleapis.com/auth/userinfo.email`, `https://www.googleapis.com/auth/cclog`
    - `redirect_uri`: Host callback `/api/oauth/callback/antigravity`
    - `access_type`: `offline` (for refresh token)
    - `prompt`: `consent`
- **Callback Processing (`/api/oauth/callback/antigravity`):**
  - Exchanges authorization code for `access_token` and `refresh_token`.
  - Resolves `userInfo` and `projectId` via `loadCodeAssist`.
  - Saves connection and redirects back to `/dashboard/providers/antigravity` with a success toast.

### 3. User Interface (`src/app/(dashboard)/dashboard/providers/[id]/page.js`)
- Replaces the generic "Import Local ADC" button with a clear, localized **"Import from Antigravity CLI"** button with a terminal icon (`terminal`).
- Displays clear status toasts:
  - "Antigravity CLI credentials imported successfully (account@example.com)"
  - Or actionable guidance if no CLI session is found.
- The primary **"Add Connection"** button continues to trigger the Direct Web OAuth modal for adding new accounts directly in the browser.

## Security and Privacy

- Secret credentials (`access_token`, `refresh_token`, `apiKey`) are never returned in client API responses.
- All local-import operations are restricted to local loopback or authenticated dashboard sessions via `dashboardGuard`.
- Tokens are stored encrypted / protected in the local database (`data.sqlite`).

## Verification & Testing

1. **Unit Tests:**
   - Keyring credential extraction from Windows Credential Manager and macOS Keychain (`tests/unit/antigravity-local-import.test.js`).
   - Token refresh and Antigravity project mapping.
   - Fallback behavior when credentials are not found.
2. **Integration Checks:**
   - `POST /api/oauth/antigravity/local-import` endpoint returns safe payload.
   - UI renders "Import from Antigravity CLI" and updates connection list reactively.
