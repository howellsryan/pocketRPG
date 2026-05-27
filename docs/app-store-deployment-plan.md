# PocketRPG — iOS App Store Deployment Plan

> **Goal**: Ship PocketRPG to the **Apple App Store** (iPhone) **without forking the codebase and without owning a Mac**. One web build powers the browser and iOS; the native shell is a thin wrapper.
>
> **Approach**: **Capacitor** (by Ionic) wraps the existing Vite/Preact build in a native WebView and produces a standard `.ipa`. **Codemagic** (cloud CI on Apple hardware) builds, signs, and publishes that `.ipa` to **TestFlight** and, eventually, the App Store — so no MacBook is required.
>
> **Scope**: iOS only for now. Android is deferred; because the codebase stays single-source, Android can be added later with no rework (`npx cap add android` against the same `www/` build). Android-specific notes are out of scope here.
>
> **Monetisation**: In-app purchases (credits, skip-hour, remove-ads) are **hidden inside the app**. Stripe stays web-only at `pocketrpg.co.uk`. Fastest path to approval; avoids Apple's mandatory native-IAP rules. (To sell inside the app later, add StoreKit — see Appendix C.)
>
> **Cross-platform / client-agnostic**: web and app are the **same client over one server** — same login, shared progress, and shared PvP / trading / leaderboards across both. This is already how the backend is built; §10 explains the guarantees and the one risk to manage (save divergence).

---

## 1. The toolchain at a glance

| Piece | Role | Cost |
|---|---|---|
| **Capacitor** | Wraps the web build in a native iOS shell; produces the Xcode project | **Free**, open source (MIT) |
| **Codemagic** | Cloud Macs build + sign + upload to TestFlight/App Store | **Free tier** (~500 build-min/mo); paid above that |
| **Apple Developer Program** | Required to use TestFlight and submit | **$99/yr (~£79)** — needed before any tester sees a build |
| **Your iPhone** | Test device via TestFlight | Already own |
| **Your dev machine** (Win/Linux/Mac) | All web dev + `npx cap sync` | Already own |

**You never need to buy or rent a Mac.** Codemagic runs the macOS build for you. (A cloud Mac like MacinCloud is only a fallback if you ever need to debug signing interactively — see Appendix B.)

### What's shared vs iOS-specific

~95% of the repo is shared and runs identically in browser and app:

| Shared (no change) | iOS-specific (thin shims / config) |
|---|---|
| `src/engine/**` (pure game logic) | API base URL resolver (`src/cloud/api.js`) |
| `src/screens/**`, `src/components/**` | OAuth launch (system browser + deep link) |
| `src/state/**`, `src/db/**`, `src/data/**` | Purchase UI gating (hide in native) |
| Cloudflare Functions `functions/**` (the API) | `capacitor.config.ts`, generated `ios/` project, `codemagic.yaml`, icons/splash |

The "app vs web" split is **runtime branches** (`if (Capacitor.isNativePlatform())`), not two codebases.

---

## 2. Prerequisites

### Accounts & money
- **Apple Developer Program** — $99/yr (~£79). Enrolment can take 24–48h; **start this first**. Required for TestFlight *and* submission.
- **Codemagic account** — free; sign up with the GitHub repo.
- **App Store Connect API key** — created in App Store Connect (Users and Access → Integrations → App Store Connect API). You'll download a `.p8` key + note the Issuer ID and Key ID. Codemagic uses this for automatic signing and publishing.
- **Privacy policy URL** (`pocketrpg.co.uk/privacy`) and a **support URL / contact email** — both required by Apple.

### Tooling (on your own machine — any OS)
- **Node 20+** (already used).
- **Capacitor CLI** (added below).
- You do **not** install Xcode locally. Codemagic provides it.

> One caveat: without local Xcode you can't sideload/live-debug on a device. Your test loop is **push → Codemagic builds → TestFlight → install on iPhone**. The iOS Simulator (needs a Mac) is therefore skipped; rely on the browser for fast iteration and TestFlight for on-device checks.

---

## 3. Critical pre-work in the codebase (Phase 0)

These are the blockers, and the bulk of the real effort. They're all testable in a normal browser before any iOS build exists.

### 3.1 Produce a self-contained, offline-capable web bundle ⚠️ **highest priority**

The committed root `index.html` is the **CDN single-file build** (`build_single.cjs`): it pulls Preact/idb from `esm.sh`, Tailwind from `cdn.tailwindcss.com`, and fonts from Google Fonts. **A packaged app must not depend on CDNs** — the game is offline-first, App Review tests offline, and remote-script execution invites rejection.

**Action**: ship the **bundled Vite build** (which already compiles Preact + Tailwind locally via `@preact/preset-vite` and `@tailwindcss/vite`), not the CDN single-file:

1. Add a dedicated app entry HTML (e.g. `app/index.html`) referencing `src/main.jsx`. Do **not** reuse the generated CDN `index.html`.
2. Self-host the three fonts (`Cinzel`, `Nunito`, `JetBrains Mono`) — add the `.woff2` files + `@font-face` to `src/index.css`; drop the Google Fonts `<link>` for the app build.
3. Add `vite.config.app.js` with **`base: './'`** (the current `base: '/pocketrpg/'` breaks asset paths under `capacitor://`). Keeps the web build untouched.
4. Add a script:
   ```jsonc
   "build:app": "vite build --config vite.config.app.js --outDir www"
   ```
   `www/` becomes Capacitor's `webDir`.
5. Verify it boots with **zero network requests** (DevTools → offline).

### 3.2 Make API calls use an absolute base URL ⚠️ **blocker**

`src/cloud/api.js` (`request()`, ~line 109) and `src/cloud/pvp.js` (~line 20) call `fetch('/api/...')` with **relative** paths. In the app the shell loads from `capacitor://localhost`, so `/api/...` hits the local bundle and **every API call 404s**.

```js
// src/cloud/apiBase.js
import { Capacitor } from '@capacitor/core'
export const API_BASE = Capacitor.isNativePlatform() ? 'https://pocketrpg.co.uk' : ''
export const apiUrl = (path) => `${API_BASE}${path}`
```

Update `api.js` (`fetch` + `sendBeacon('/api/idle')`), `pvp.js`, and the OAuth launchers to use `apiUrl(...)`.

**Server CORS**: the Cloudflare Functions must allow the native origin. Add `capacitor://localhost` (iOS) to the `Access-Control-Allow-Origin` allowlist, allow headers `Authorization`, `X-Character-Id`, `Content-Type`, and handle `OPTIONS` preflight. Auth is a Bearer token in `localStorage` (not cookies), so there are no SameSite issues — but CORS must still be opened.

### 3.3 Fix OAuth for native (system browser + deep link) ⚠️ **blocker**

`AuthScreen.jsx` → `startGitHubLogin/Google` do `window.location.href = '/api/auth/...'`. Broken in a WebView: relative path (3.2) **and** Google rejects embedded WebViews (`disallowed_useragent`; the app already detects this via `isEmbeddedBrowser`).

**Native pattern** — open OAuth in the **system browser**, return via a **deep link**:
1. Add `@capacitor/browser` + `@capacitor/app`. Choose scheme `pocketrpg://auth/callback`.
2. Server: in `functions/api/auth/github.js` & `google.js`, when the request is flagged native (`?platform=native`), redirect to `pocketrpg://auth/callback#token=…` instead of the web URL. Register `pocketrpg://` as an allowed redirect in the **GitHub OAuth App** and **Google Cloud OAuth client**.
3. Client:
   ```js
   import { Browser } from '@capacitor/browser'
   import { App } from '@capacitor/app'
   export async function startGitHubLoginNative() {
     App.addListener('appUrlOpen', ({ url }) => {
       if (url.startsWith('pocketrpg://auth/callback')) {
         const token = new URL(url).hash.match(/token=([^&]+)/)?.[1]
         if (token) setToken(decodeURIComponent(token))
         Browser.close()
       }
     })
     await Browser.open({ url: apiUrl('/api/auth/github?platform=native') })
   }
   ```
4. Branch in `AuthScreen.jsx`: native flow when `isNativePlatform()`, else existing redirect.

> **Sign in with Apple**: if you offer Google/GitHub social login, Apple has historically required Apple as an option (Guideline 4.8). Budget for adding it (new server endpoint + Apple key) — can be a fast-follow if a reviewer flags it. Confirm against the current guidelines at submission.

### 3.4 Hide in-app purchases in the native build

Gate every purchase / credit-spend entry behind `!isNativePlatform()` so the app shows **no path to buy digital goods** (Apple 3.1.1/3.1.3 forbid selling *or linking out* to buy digital content):
- `src/App.jsx:1751` — pass `null` for `onBuyCredits`/`onSkip1h` to `<Header>` in native.
- `src/App.jsx:2188` — never open `showBuyCreditsModal` in native.
- `src/components/Header.jsx` — hide the buy affordance (showing credit *balance* is fine).
- `src/components/BuyCreditsModal.jsx` — unreachable in native.
- Skip-hour (`handleSkip1h` → `api.skipHour`) spends credits — hide its trigger natively too.

> No ad SDK exists in the client today, so "remove ads" only needs the purchase button hidden.

### 3.5 App icons, splash & manifest

None exist yet. Generate from one 1024×1024 source with **`@capacitor/assets`**. A `manifest.webmanifest` is optional (also makes the web build an installable PWA).

### 3.6 Account deletion ⚠️ **App Review blocker**

Apple **5.1.1(v)**: any app with account creation must allow **in-app account deletion**. PocketRPG has accounts (OAuth + characters) but only `deleteSave`/`resetOneLife` today — no full account delete.

**Action**: add `DELETE /api/auth/account` (purge user, characters, saves, trading-post offers, collection log, PvP records) + a "Delete account" button in settings/auth UI. **Required before production review** (TestFlight tolerates its absence, but don't ship to review without it).

---

## 4. Phase 1 — Add Capacitor (iOS)

After Phase 0 is merged and `www/` builds clean:

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/app @capacitor/browser \
      @capacitor/network @capacitor/status-bar @capacitor/splash-screen
npx cap init "PocketRPG" "uk.co.pocketrpg.app" --web-dir=www
npm i @capacitor/ios
npx cap add ios
```

`capacitor.config.ts`:
```ts
import type { CapacitorConfig } from '@capacitor/cli'
const config: CapacitorConfig = {
  appId: 'uk.co.pocketrpg.app',   // reverse-DNS; must match the App Store bundle ID
  appName: 'PocketRPG',
  webDir: 'www',
  ios: { contentInset: 'always' },
  plugins: { SplashScreen: { launchShowDuration: 600, backgroundColor: '#0f0f0f' } },
}
export default config
```

Commit the generated `ios/` folder (it's your native project). `.gitignore`: `www/`, `ios/App/Pods`, `ios/App/App/public`, `DerivedData`, etc.

Local loop (no Mac needed — `cap sync` just copies files):
```bash
npm run build:app && npx cap sync ios
```

### iOS native config (set once, in the `ios/` project or `Info.plist`)
- **Bundle identifier** = `uk.co.pocketrpg.app` (match `appId` and App Store Connect).
- **URL scheme** `pocketrpg` under URL Types (OAuth deep link, 3.3).
- **ATS**: all traffic is HTTPS — add no exceptions (no `NSAllowsArbitraryLoads`).
- **Safe areas**: build already sets `viewport-fit=cover`; verify `env(safe-area-inset-*)` so the header clears the notch/Dynamic Island.
- **Orientation**: lock to portrait (mobile-first UI).
- **Privacy usage strings**: add only for capabilities used — likely **none**.

> You can edit `Info.plist` and these settings as plain files in the repo without Xcode; Codemagic compiles them.

---

## 5. Phase 2 — Codemagic CI → TestFlight → Production

This replaces owning a Mac. Codemagic checks out the repo, runs the web + Capacitor build on a macOS VM, signs with your App Store Connect API key, and uploads to TestFlight.

### One-time setup
1. In **App Store Connect**: create the app record with bundle ID `uk.co.pocketrpg.app`; create an **App Store Connect API key** (`.p8`, Issuer ID, Key ID).
2. In **Codemagic**: connect the GitHub repo; add the App Store Connect API key under **Teams → Integrations** (enables **automatic code signing** — Codemagic creates/fetches the distribution certificate and provisioning profile).
3. Add `codemagic.yaml` to the repo root:

```yaml
workflows:
  ios-testflight:
    name: PocketRPG iOS → TestFlight
    instance_type: mac_mini_m2
    max_build_duration: 60
    integrations:
      app_store_connect: PocketRPG ASC Key   # the key you added in Codemagic
    environment:
      ios_signing:
        distribution_type: app_store
        bundle_identifier: uk.co.pocketrpg.app
      vars:
        BUNDLE_ID: "uk.co.pocketrpg.app"
      node: 20
      xcode: latest
      cocoapods: default
    scripts:
      - name: Install deps
        script: npm ci
      - name: Build web bundle
        script: npm run build:app
      - name: Capacitor sync iOS
        script: npx cap sync ios
      - name: Set build number
        script: |
          cd ios/App
          agvtool new-version -all $(($BUILD_NUMBER + 1))
      - name: Install pods
        script: cd ios/App && pod install
      - name: Build & sign IPA
        script: |
          xcode-project use-profiles
          xcode-project build-ipa \
            --workspace "ios/App/App.xcworkspace" \
            --scheme "App"
    artifacts:
      - build/ios/ipa/*.ipa
    publishing:
      app_store_connect:
        auth: integration
        submit_to_testflight: true
        # submit_to_app_store: false   # flip to true (with release notes) when ready for production
```

### The loop
- **Push to the branch** → Codemagic builds → `.ipa` lands in **TestFlight** automatically.
- Add **yourself as an internal tester** in App Store Connect → install via the **TestFlight app** on your iPhone. Internal builds need **no review** and appear within minutes.
- Iterate: web change → push → new TestFlight build → test on device.

### Going to production
When TestFlight looks good: complete the App Store listing (below), then either set `submit_to_app_store: true` in `codemagic.yaml` or click "Submit for Review" in App Store Connect. Production goes through **full App Review** (typically 24–48h).

---

## 6. Phase 3 — Behaviours to validate on device (via TestFlight)

| Plugin | Why |
|---|---|
| `@capacitor/app` | OAuth deep-link callback; resume/pause; (background events) |
| `@capacitor/browser` | System-browser OAuth |
| `@capacitor/network` | Offline detection → queue cloud sync until back online |
| `@capacitor/status-bar` | Match dark theme `#0f0f0f` |
| `@capacitor/splash-screen` | Branded launch; hide once Preact mounts |

App-specific things to test hard on a real iPhone:
- **600 ms engine tick & idle engine** when backgrounded/locked — iOS throttles/suspends WebView timers. The cloud idle catch-up (`/api/idle`, `sendIdleBeacon`) is the safety net; confirm the beacon fires on pause and resume recomputes elapsed idle.
- **IndexedDB** survives app restarts (iOS can evict storage under pressure — cloud save is the backstop).
- **OAuth** round-trip through Safari and back via `pocketrpg://`.
- **PvP** real-time flow over the absolute API base.

---

## 7. Phase 4 — App Store listing & review

1. **App Privacy ("nutrition labels")**: declare email (from OAuth) + game/usage data linked to identity; provide privacy-policy URL.
2. **Account deletion**: confirm in-app deletion (3.6) — reviewers check this.
3. **Sign in with Apple**: add if you keep social login (3.3).
4. **Screenshots** (6.7" / 6.5" iPhone minimum), description, keywords, support URL, **age rating** (likely 12+ for fantasy violence — answer honestly).
5. **Review notes**: "No in-app purchases; account optional; demo login: …" Provide a test account.
6. Submit (Codemagic `submit_to_app_store` or the ASC button).

---

## 8. Keeping web & app in lockstep

| Target | Command | Output | Deploy |
|---|---|---|---|
| Browser | `npm run build` + `npm run rebuild` | CDN `index.html` | Cloudflare Pages |
| iOS | `npm run build:app` → `npx cap sync ios` | `www/` → `ios/` → Codemagic | TestFlight / App Store |
| API | (existing) | `functions/**` | Cloudflare |

- Web code changes reach the app by rebuilding `www/` and shipping a new TestFlight/App Store build.
- **Optional OTA** (later): Capacitor live updates (`@capacitor/live-updates` / Appflow) push web-bundle fixes without re-review — **bugfix/content only**, never to add store-gated features.
- **API** (`functions/**`) deploys independently; keep it backward-compatible so older app binaries keep working.
- Gate releases on the existing commit checks (`CLAUDE.md` §11) **plus** `npm run build:app`.

---

## 9. Sequenced checklist

**Phase 0 — code (browser-testable, the real work):**
- [ ] 3.1 Self-contained app bundle (`vite.config.app.js`, local fonts, `base:'./'`, `build:app` → `www/`, zero-network boot)
- [ ] 3.2 `apiBase.js` + absolute URLs; server CORS for `capacitor://localhost`
- [ ] 3.3 Native OAuth (system browser + `pocketrpg://`); register redirect in GitHub & Google
- [ ] 3.4 Hide purchase/skip-hour UI in native
- [ ] 3.5 Icons/splash + manifest
- [ ] 3.6 Account-deletion endpoint + UI (production-blocking)

**Phase 1 — Capacitor iOS:**
- [ ] Add Capacitor, init, `cap add ios`; commit `ios/`
- [ ] Bundle ID, URL scheme, safe areas, orientation, ATS

**Phase 2 — Codemagic → TestFlight:**
- [ ] Apple Developer enrolment (start early) + App Store Connect API key
- [ ] Connect repo to Codemagic; add ASC key for automatic signing
- [ ] `codemagic.yaml`; first green build → TestFlight; add self as internal tester; install on iPhone

**Phase 3–4 — production:**
- [ ] On-device validation (tick/idle/IndexedDB/OAuth/PvP)
- [ ] Cross-platform acceptance tests (§10) — same account, two-way progress sync, cross-client PvP/trading
- [ ] App pulls `getSave` on launch *and* resume; treats revision conflict as "server wins" (§10)
- [ ] Privacy policy + support URLs live
- [ ] Listing, privacy labels, screenshots, Sign in with Apple if needed
- [ ] Flip to `submit_to_app_store` → App Review → launch

---

## 10. Cross-platform / client-agnostic guarantees

The requirement — web users and app users share one account, progress carries across, and they PvP against each other — is **already satisfied by the architecture**, because every client is a thin frontend over one authoritative server (Cloudflare Functions + D1). There is **no client-type distinction anywhere in `functions/**`**. Verified against the code:

| Concern | Why it already works | Evidence |
|---|---|---|
| **Same account on web & app** | Users are keyed by OAuth identity, not device. Logging in with the same Google/GitHub account resolves to the same user row from any client. | `migrations/0001_init.sql`: `UNIQUE (provider, provider_user_id)` |
| **Independent login/logout per client** | Each client holds its own JWT (`sub` = user id). Logging out on web doesn't disturb the app, and vice versa — both still map to one account. | `functions/_lib/auth.js` (`requireAuth` → `payload.sub`) |
| **Progress picks up across clients** | Saves live server-side; clients pull (`getSave`) and push (`putSave`) with a monotonic `save_revision`. The server is the single source of truth. | `src/cloud/sync.js`, `functions/api/save.js` |
| **Cross-client PvP** | Matchmaking + simulation are server-authoritative (600 ms tick, deterministic ordering); the pool isn't segregated by client. A web player and an app player land in the same match. | `CLAUDE.md` §10; `functions/api/pvp/**` |
| **Shared economy/social** | Trading post, leaderboards, collection log, kill counts are all server-side and account-scoped. | `functions/api/trading-post/**`, `leaderboard.js`, `collection-log.js` |
| **Active-match safety across clients** | Save/idle/purchase writes are locked while a match is active; clients already handle the `409 character_in_active_match` signal. | `src/cloud/api.js` (`emitActiveMatchConflict`) |

### What must hold true (and is in this plan)
- **App targets the same origin** — the §3.2 absolute base URL (`https://pocketrpg.co.uk`) makes the app hit the *same* API and D1 as the website. Without it, the app would be a separate, broken island. This is the single linchpin of cross-platform parity.
- **OAuth maps to the same user** — the §3.3 native flow uses the **same server handlers and the same OAuth provider apps**; identity is keyed on the provider's user id, so even a separately-registered native OAuth client still resolves to the same row. No special work needed beyond §3.3.

### The one real risk: save divergence across devices
Because progress is offline-first (IndexedDB) and the same character can be opened on two clients, two clients can advance independently and then both try to write. This is already guarded — `putSave` rejects stale writes by `save_revision`, and `sync.js` tracks `lastSaveRevision` and emits `SAVE_REVISION_EVENT` — so a stale client can't silently clobber newer progress. To make the UX clean on the app:
- **Pull on foreground**: when the app launches *and* resumes from background, call `getSave` and reconcile to the server revision **before** resuming the local idle loop, so a session that advanced on web isn't overwritten.
- **On conflict, server wins**: treat a `409`/revision mismatch as "reload from server", not "force my copy". (This matches the existing web behaviour; just ensure the app's resume path honours it.)
- Lean on the existing **cloud idle catch-up** (`/api/idle`, `sendIdleBeacon`) so backgrounded app time is reconciled server-side rather than recomputed divergently on each client.

### Cross-platform acceptance tests (run before production)
- [ ] Log in with the **same Google account** on web and in the app → both show the same characters.
- [ ] Earn XP / loot on **web**, then open the **app** → progress is present (and vice versa).
- [ ] Log out on the app → web session unaffected; log back in → progress intact.
- [ ] Queue PvP on the **app** and on **web** (two accounts) → they can be matched against each other; result settles identically on both.
- [ ] List an item on the **web** trading post → it's visible/buyable from the **app**.
- [ ] Leaderboard / collection log show identical state on both clients.
- [ ] Advance the same character on two clients, then sync → no silent data loss (stale write rejected, newer state retained).

---

## Appendix A — Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| First Codemagic build fails on signing | Medium | Use App Store Connect API key + automatic signing; check bundle ID matches everywhere |
| CDN deps break offline review | High if not fixed | 3.1 — bundle everything locally |
| API 404s in native (relative paths) | Certain if not fixed | 3.2 — absolute base URL + CORS |
| Apple rejects: missing account deletion | High if skipped | 3.6 before production submit |
| Apple flags missing "Sign in with Apple" | Medium | Add Apple login (3.3) or fast-follow |
| Background timer throttling skews idle | Medium | Server idle catch-up; verify on device |
| Save divergence when same character played on web + app | Medium | `save_revision` stale-write guard; app pulls on foreground, server wins on conflict (§10) |
| App points at wrong/separate origin → split accounts | Low (covered by 3.2) | Absolute base URL to `pocketrpg.co.uk`; same API/D1 as web |

## Appendix B — If you ever need hands-on Xcode

Codemagic handles normal builds, but if you hit a signing/provisioning issue that needs interactive debugging, rent a cloud Mac (MacinCloud ~£20–30/mo or ~£1/hr; MacStadium; AWS EC2 Mac — pricier, 24h min) and remote in. A one-off **Mac mini (~£599)** is the cheapest owned hardware if this becomes routine. Neither is required for the standard flow.

## Appendix C — Adding in-app purchases later

Use native IAP, not Stripe-in-app:
- Plugin: `@revenuecat/purchases-capacitor` (or `cordova-plugin-purchase`).
- Define products in App Store Connect (consumables for credits, non-consumable for remove-ads).
- **Server-side receipt validation** before granting entitlements — fits the server-authoritative model (`CLAUDE.md` §14); mirror the Stripe grant logic keyed off validated Apple receipts.
- Entitlements are account-level, so a purchase on any platform reflects everywhere via the cloud save.
