# Antigravity CLI Assistant and Web OAuth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Provide a seamless authentication experience for Antigravity on 9Router by enabling 1-click native CLI keyring/ADC token import and direct browser OAuth onboarding.

**Architecture:** The server-side importer (`src/lib/oauth/antigravityLocal.js`) extracts active tokens from Windows Credential Manager (`gemini:antigravity`), macOS Keychain, or Google ADC, refreshes them with Antigravity OAuth client credentials, discovers project IDs via `loadCodeAssist`, and stores connections in SQLite `providerConnections`. The UI (`src/app/(dashboard)/dashboard/providers/[id]/page.js`) provides an "Import from Antigravity CLI" button with clear status toasts and maintains direct web OAuth via "Add Connection".

**Tech Stack:** Next.js, Node.js (`child_process`, `crypto`), SQLite (`node:sqlite`), Vitest, TailwindCSS.

## Global Constraints

- Never expose `accessToken`, `refreshToken`, or `apiKey` in client-facing API responses.
- Restrict `local-import` endpoint to local loopback or authenticated sessions via `dashboardGuard`.
- Preserve existing compatibility with Google ADC fallback for headless environments.

---

### Task 1: Verify and solidify Keyring extraction in `antigravityLocal.js`

**Files:**
- Modify: `src/lib/oauth/antigravityLocal.js`
- Test: `tests/unit/antigravity-local-import.test.js`

**Interfaces:**
- Consumes: Native OS keyring (Windows Credential Manager / macOS Keychain)
- Produces: `readKeyringCredentials()`, `readLocalAntigravityCredentials()`, `importLocalAntigravity()`

- [ ] **Step 1: Write the failing unit tests for keyring edge cases**

```javascript
// in tests/unit/antigravity-local-import.test.js
it("handles empty or malformed keyring output gracefully", async () => {
  const execImpl = vi.fn(async () => ({ stdout: "   " }));
  const creds = await readKeyringCredentials({ execImpl, platform: "win32" });
  expect(creds).toBeNull();
});

it("handles keyring command failure gracefully without throwing", async () => {
  const execImpl = vi.fn(async () => { throw new Error("Key not found"); });
  const creds = await readKeyringCredentials({ execImpl, platform: "win32" });
  expect(creds).toBeNull();
});
```

- [ ] **Step 2: Run test to verify behavior**

Run: `npx vitest run unit/antigravity-local-import.test.js`
Expected: PASS with new edge case coverage.

- [ ] **Step 3: Verify and ensure implementation in `src/lib/oauth/antigravityLocal.js` matches**

Ensure `readKeyringCredentials` handles whitespace, errors, and empty JSON without unhandled rejections.

- [ ] **Step 4: Commit**

```bash
git add src/lib/oauth/antigravityLocal.js tests/unit/antigravity-local-import.test.js
git commit -m "feat(antigravity): robust keyring credential extraction with error handling"
```

---

### Task 2: Update Local Import Route and Error Messaging

**Files:**
- Modify: `src/app/api/oauth/antigravity/local-import/route.js`
- Test: `tests/unit/antigravity-local-import-route.test.js`

**Interfaces:**
- Consumes: `importLocalAntigravity()` from `src/lib/oauth/antigravityLocal.js`
- Produces: `POST /api/oauth/antigravity/local-import` returning `{ success: true, connection: { id, provider, email, name } }`

- [ ] **Step 1: Update error response message for clear CLI guidance**

In `src/app/api/oauth/antigravity/local-import/route.js`:
Update `NO_LOCAL_CREDENTIALS_MESSAGE` to:
`"No Antigravity CLI or Google ADC credentials found on this machine. Run 'agy auth login' in your terminal or use 'Add Connection' for web login."`

- [ ] **Step 2: Update route unit test**

In `tests/unit/antigravity-local-import-route.test.js`:
Update expected error message to verify new actionable guidance.

- [ ] **Step 3: Run test to verify it passes**

Run: `npx vitest run unit/antigravity-local-import-route.test.js`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add src/app/api/oauth/antigravity/local-import/route.js tests/unit/antigravity-local-import-route.test.js
git commit -m "feat(antigravity): enhance local-import error guidance for CLI and web users"
```

---

### Task 3: UI Enhancement on Antigravity Provider Page

**Files:**
- Modify: `src/app/(dashboard)/dashboard/providers/[id]/page.js:1565-1576` and `1658-1670`

**Interfaces:**
- Consumes: `POST /api/oauth/antigravity/local-import`
- Produces: Localized button with terminal icon (`terminal`), loading state, and reactive connection list refresh.

- [ ] **Step 1: Update button label and icon**

Change button from:
`icon="download"`, `"Import Local ADC"`, title `"Import Google ADC credentials from this machine"`
To:
`icon="terminal"`, `"Import from Antigravity CLI"`, title `"Import credentials from Antigravity CLI or ADC on this machine"`

- [ ] **Step 2: Enhance success and error toasts**

In `handleLocalAntigravityImport`:
When successful, display:
`setLocalImportMessage({ type: "success", text: `Antigravity CLI account imported: ${data.connection?.email || data.connection?.name || "Connected"}` })`
On error:
`setLocalImportMessage({ type: "error", text: error.message })`

- [ ] **Step 3: Verify build / lint / syntax**

Run: `node -c src/app/(dashboard)/dashboard/providers/[id]/page.js`

- [ ] **Step 4: Commit**

```bash
git add src/app/\(dashboard\)/dashboard/providers/\[id\]/page.js
git commit -m "feat(dashboard): update Antigravity connection UI with CLI assistant import button"
```

---

### Task 4: End-to-End Verification and Validation

**Files:**
- Run all test suites
- Test live local import from current machine

- [ ] **Step 1: Run comprehensive unit test suites**

Run:
```bash
npx vitest run unit/gemini-3.8-antigravity.test.js unit/antigravity-local-import.test.js unit/antigravity-local-import-route.test.js unit/antigravity-array-schema-and-400-lock.test.js unit/google-validation-unlock.test.js
```
Expected: All tests PASS.

- [ ] **Step 2: Verify alias snapshot baseline**

Run: `node tests/__baseline__/verify-alias.mjs`
Expected: 117 tokens byte-for-byte equal.

- [ ] **Step 3: Commit all remaining changes and clean up**

```bash
git status
```
