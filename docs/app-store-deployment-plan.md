# PocketRPG — App Store Deployment Plan (iOS + Android)

> **Goal**: Ship PocketRPG to the Apple App Store and Google Play **without forking the codebase**. One web build powers the browser, iOS, and Android. Native shells are thin wrappers.
>
> **Chosen approach**: **Capacitor** (by Ionic). It wraps the existing Vite/Preact build in a native WebView, exposes native APIs through plugins, and produces standard `.ipa`/`.aab` artifacts for the stores.
>
> **Monetisation decision (this plan)**: In-app purchases (credits, skip-hour, remove-ads) are **hidden inside the store apps**. Stripe stays web-only at `pocketrpg.co.uk`. This is the fastest path to store approval and avoids Apple/Google's mandatory native-IAP rules. (If you later want to sell inside the app, add StoreKit / Play Billing — see Appendix C.)

---

## 1. Why Capacitor (vs the alternatives)

| Option | Single codebase? | iOS store | Android store | Effort | Verdict |
|---|---|---|---|---|---|
| **Capacitor** | ✅ reuses the web build verbatim | ✅ real `.ipa` | ✅ real `.aab` | Low–Med | **Chosen** |
| PWA + TWA (Bubblewrap) | ✅ | ❌ iOS has no TWA | ✅ | Low | Android-only; fails the iOS requirement |
| React Native / Flutter rewrite | ❌ rewrite the UI | ✅ | ✅ | Very high | Throws away the Preact app |
| Cordova | ✅ | ✅ | ✅ | Med | Legacy; Capacitor is its modern successor |

Capacitor is the only option that satisfies "single place of deployment for the majority of code" **and** ships to both stores.

### What stays shared vs platform-specific

~95% of the repo is shared, untouched, and runs identically everywhere:

| Shared (no change) | Platform-specific (thin shims) |
|---|---|
| `src/engine/**` (pure game logic) | API base URL resolver (`src/cloud/api.js`) |
| `src/screens/**`, `src/components/**` | OAuth launch flow (system browser + deep link) |
| `src/state/**`, `src/db/**` | Purchase UI gating (hide in native) |
| `src/data/**` | `capacitor.config.ts`, `ios/`, `android/` projects |
| Cloudflare Functions `functions/**` (the API server) | App icons / splash / store metadata |

---

## 2. Prerequisites

### Accounts & money
- **Apple Developer Program** — $99/year. Required to build, sign, and submit. (Enrolment can take 24–48h, sometimes longer for org accounts — start this early.)
- **Google Play Developer** — $25 one-time.
- A **privacy policy URL** (both stores require it). Host it on `pocketrpg.co.uk/privacy`.
- A **support URL / contact email**.

### Tooling
- **macOS + Xcode** (latest) — **mandatory** to build and submit the iOS app. There is no way around needing a Mac (or a Mac CI runner / cloud Mac such as Codemagic/MacStadium) for iOS.
- **Android Studio** (latest) + JDK 17 + Android SDK — for Android.
- **Node 20+** (already used by the project).
- **CocoaPods** (`sudo gem install cocoapods`) for iOS native deps.

### Hardware for testing
- A physical iPhone and Android device are strongly recommended (timers, background behaviour, and the 600 ms tick behave differently on real hardware than simulators).

---

## 3. Critical pre-work in the codebase (Phase 0)

These are blockers that must be fixed **before** Capacitor will work. They stem from assumptions the current web build makes that are false inside a native shell.

### 3.1 Produce a self-contained, offline-capable web bundle ⚠️ **highest priority**

The committed root `index.html` is the **CDN single-file build** (`build_single.cjs`): it imports Preact/idb from `esm.sh`, Tailwind from `cdn.tailwindcss.com`, and fonts from Google Fonts. **A packaged app must not depend on CDNs** — the game is offline-first, the App Store reviews offline, and remote-script execution can trigger Apple rejections.

**Action**: the app must ship the **bundled Vite build** (which already compiles Preact + Tailwind locally via `@preact/preset-vite` and `@tailwindcss/vite`), not the CDN single-file. Tasks:

1. Add a dedicated app entry HTML (e.g. `app/index.html`) that references `src/main.jsx` — do **not** reuse the generated CDN `index.html`.
2. Self-host the three font families (`Cinzel`, `Nunito`, `JetBrains Mono`) — drop the `.woff2` files into the bundle and add `@font-face` rules to `src/index.css`. Remove the Google Fonts `<link>` for the app build.
3. Add an app-specific Vite config with **`base: './'`** (the current `base: '/pocketrpg/'` in `vite.config.js` will break asset paths under `capacitor://`/`https://localhost`). A second config file (`vite.config.app.js`) keeps the web build untouched.
4. Add an npm script, e.g.:
   ```jsonc
   "build:app": "vite build --config vite.config.app.js --outDir www"
   ```
   `www/` becomes Capacitor's `webDir`.
5. Verify the output runs with **zero network requests** at startup (DevTools → Network, offline mode).

> Net effect: the browser site keeps deploying exactly as today (Cloudflare Pages + CDN single-file). The app consumes a parallel, fully-bundled `www/` artifact from the same `src/`.

### 3.2 Make API calls use an absolute base URL ⚠️ **blocker**

`src/cloud/api.js` (`request()`, line ~109) and `src/cloud/pvp.js` (line ~20) call `fetch('/api/...')` with **relative** paths. In a native shell the app loads from `capacitor://localhost` (iOS) / `https://localhost` (Android), so `/api/...` resolves to the local bundle — **every API call 404s**.

**Action**: introduce a single base-URL resolver and prefix all API/auth/beacon URLs with it.

```js
// src/cloud/apiBase.js
import { Capacitor } from '@capacitor/core'

// In the browser, relative paths hit the same origin (pocketrpg.co.uk).
// In a native shell there is no server origin, so target prod explicitly.
export const API_BASE = Capacitor.isNativePlatform()
  ? 'https://pocketrpg.co.uk'
  : ''

export const apiUrl = (path) => `${API_BASE}${path}`
```

Then update:
- `src/cloud/api.js` → `fetch(apiUrl(path), …)` and the `sendBeacon('/api/idle')` call.
- `src/cloud/pvp.js` → same.
- `startGitHubLogin` / `startGoogleLogin` (see 3.3).

**Server CORS**: the Cloudflare Functions must allow the native origins. Add `capacitor://localhost`, `https://localhost`, and `http://localhost` to the CORS allowlist (`Access-Control-Allow-Origin` + credentials/headers `Authorization`, `X-Character-Id`, `Content-Type`) and handle `OPTIONS` preflight. Auth is Bearer-token in `localStorage`, not cookies, so SameSite cookie issues don't apply — but CORS still must be opened.

### 3.3 Fix OAuth for native (system browser + deep link) ⚠️ **blocker**

`AuthScreen.jsx` calls `startGitHubLogin/Google` which do `window.location.href = '/api/auth/github'` — a full-page redirect. Inside a WebView this is broken in two ways: (a) relative path (see 3.2), and (b) **Google rejects embedded WebViews** with `disallowed_useragent` (the code already detects this via `isEmbeddedBrowser`). GitHub also shouldn't keep the user trapped in the app WebView.

**Native pattern**: open the OAuth URL in the **system browser** and return via a **deep link** (custom URL scheme):

1. Add plugins `@capacitor/browser` and `@capacitor/app`.
2. Pick a scheme, e.g. `pocketrpg://auth/callback`.
3. On the server, the OAuth callback (`functions/api/auth/github.js`, `google.js`) currently redirects to the app with `#token=…`. Add a branch: if the request carries a `?platform=native` (or a stored state flag), redirect to `pocketrpg://auth/callback#token=…` instead of the web URL. **Register `pocketrpg://` as an allowed redirect** in the GitHub OAuth App and the Google Cloud OAuth client.
4. Client:
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
5. Branch in `AuthScreen.jsx`: use the native flow when `Capacitor.isNativePlatform()`, otherwise the existing redirect.

> Sign in with Apple: **not strictly required** under current Apple rules now that third-party-only login is permitted in many cases, **but** if you offer Google/GitHub social login Apple has historically required Apple as an option. Budget for adding "Sign in with Apple" to avoid a 4.8 rejection — confirm against the current App Review Guidelines at submission time. (New server endpoint + Apple key; can be a fast-follow if the reviewer flags it.)

### 3.4 Hide in-app purchases in native builds (per the chosen monetisation model)

Gate every purchase/credit-spend entry point behind a `!isNativePlatform()` check so the store apps show **no path to buy digital goods**. Apple 3.1.1 / 3.1.3 forbid selling or even *linking out* to buy digital content; the safe move is to hide it entirely (no "buy on web" button, no pricing).

Concrete touch points:
- `src/App.jsx:1751` — `onBuyCredits` / `onSkip1h` props passed to `<Header>`. In native, pass `null` so the buttons don't render.
- `src/App.jsx:2188` — `{showBuyCreditsModal && …}` modal; never opened in native.
- `src/components/Header.jsx` — credits/buy UI; hide the buy affordance natively (showing the credit *balance* is fine; selling is not).
- `src/components/BuyCreditsModal.jsx` — not reachable in native.
- Skip-hour (`handleSkip1h`, `api.skipHour`) spends credits — hide the trigger natively too, since credits can't be purchased in-app.

> **No ad SDK exists in the client today** (no AdSense/AdMob found), so "remove ads" has nothing to gate on the client besides the purchase button — just hide the purchase. If ads are added later, only show them on web or implement AdMob natively.

### 3.5 Add PWA/app assets

None exist yet (no manifest, icons, or service worker). For Capacitor you don't need a service worker, but you do need:
- App icons & splash screens — generate from one 1024×1024 source with **`@capacitor/assets`** (auto-produces all iOS/Android sizes).
- A `manifest.webmanifest` (nice-to-have; lets the same build also be an installable PWA on the web).

### 3.6 Account deletion (store requirement) ⚠️ **compliance blocker for iOS**

Apple Guideline **5.1.1(v)**: any app that supports **account creation** must also let users **delete their account from within the app**. PocketRPG has accounts (Google/GitHub OAuth + characters). Today only `deleteSave` and `resetOneLife` exist — there is **no full account-deletion endpoint**.

**Action**: add a server endpoint (e.g. `DELETE /api/auth/account`) that purges the user row, characters, saves, trading-post offers, collection log, and PvP records, plus a "Delete account" button in the settings/auth UI. Required for iOS; Google also expects an account-deletion path (and a web deletion URL declared in the Play data-safety form).

---

## 4. Phase 1 — Add Capacitor

After Phase 0 is merged and the `www/` bundle builds clean:

```bash
npm i -D @capacitor/cli
npm i @capacitor/core @capacitor/app @capacitor/browser \
      @capacitor/network @capacitor/status-bar @capacitor/splash-screen

npx cap init "PocketRPG" "uk.co.pocketrpg.app" --web-dir=www
```

`capacitor.config.ts`:

```ts
import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'uk.co.pocketrpg.app',   // reverse-DNS; must match store bundle IDs
  appName: 'PocketRPG',
  webDir: 'www',
  ios: { contentInset: 'always' },
  plugins: {
    SplashScreen: { launchShowDuration: 600, backgroundColor: '#0f0f0f' },
  },
}
export default config
```

Add platforms:

```bash
npm i @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
```

The generated `ios/` and `android/` folders are **committed** to the repo (they're your native projects). Add build outputs (`www/`, `ios/App/Pods`, `android/.gradle`, etc.) to `.gitignore`.

Standard loop after any web change:
```bash
npm run build:app && npx cap sync      # copy www/ + native deps into the platforms
npx cap open ios                       # → Xcode
npx cap open android                   # → Android Studio
```

---

## 5. Phase 2 — Native configuration

### iOS (`ios/App`)
- **Bundle identifier** = `uk.co.pocketrpg.app` (match `appId`).
- **Signing**: select your Apple team; let Xcode manage provisioning to start.
- **Deep link scheme**: add `pocketrpg` under URL Types in `Info.plist` (for OAuth callback, 3.3).
- **App Transport Security**: all traffic is HTTPS to `pocketrpg.co.uk` — no ATS exceptions needed (don't add `NSAllowsArbitraryLoads`; it triggers extra review).
- **Status bar / safe area**: the build already sets `viewport-fit=cover` and `apple-mobile-web-app-status-bar-style`. Verify notch/Dynamic-Island safe-area insets (`env(safe-area-inset-*)`) in CSS so the header isn't clipped.
- **Orientation**: lock to portrait if the UI is portrait-only (it's mobile-first).
- **Privacy strings**: only add `NS*UsageDescription` keys for capabilities you actually use. The app likely needs **none** (no camera/location/contacts). Fewer keys = smoother review.

### Android (`android/app`)
- **Application ID** = `uk.co.pocketrpg.app`.
- **`minSdkVersion`**: Capacitor's default (currently 23) is fine.
- **`targetSdkVersion`**: must meet Play's current requirement at submission (Play enforces "target the last-year-or-newer API level"). Bump as needed.
- **Deep link intent filter**: add the `pocketrpg://auth/callback` scheme to `AndroidManifest.xml`.
- **Cleartext**: keep cleartext traffic **disabled** (all HTTPS).
- **Adaptive icons**: produced by `@capacitor/assets`.

### Icons & splash (both)
```bash
npm i -D @capacitor/assets
# place a 1024x1024 icon at assets/icon.png and a splash at assets/splash.png
npx capacitor-assets generate
```

---

## 6. Phase 3 — Plugins & behaviour to validate

| Plugin | Why |
|---|---|
| `@capacitor/app` | Deep-link callback (OAuth), back-button, resume/pause events |
| `@capacitor/browser` | System-browser OAuth |
| `@capacitor/network` | Detect offline → the game is offline-first; queue cloud sync until back online |
| `@capacitor/status-bar` | Match the dark theme (`#0f0f0f`), avoid overlap |
| `@capacitor/splash-screen` | Branded launch, hide once Preact mounts |

**App-specific behaviours to test hard:**
- **600 ms engine tick & idle engine** when the app is backgrounded/locked. Mobile OSes throttle/suspend WebView timers. The cloud "idle catch-up" (`/api/idle`, `sendIdleBeacon`) is the right mechanism — confirm `sendBeacon` fires on `App` pause and that resume recomputes elapsed idle correctly.
- **IndexedDB persistence** survives app restarts (it does in WKWebView/Android WebView, but verify; iOS can evict storage under pressure — the cloud save is the backstop).
- **PvP** real-time match flow over the absolute API base.
- **Android hardware back button** — wire `App.addListener('backButton', …)` so it closes modals/navigates instead of exiting the app.

---

## 7. Phase 4 — Store submission

### Apple App Store
1. Create the app in **App Store Connect** with bundle ID `uk.co.pocketrpg.app`.
2. **Archive** in Xcode → upload via **Organizer** (or `xcodebuild` / Fastlane in CI).
3. Fill in:
   - **App Privacy ("nutrition labels")**: declare email (from OAuth) + game/usage data, linked to identity. Provide the privacy-policy URL.
   - **Account deletion**: confirm in-app deletion exists (3.6) — reviewers check this.
   - **Sign in with Apple**: add if you keep social login (3.3).
   - **Screenshots** for required device sizes (6.7" / 6.5" iPhone at minimum), keywords, description, support URL, age rating (likely 12+ for fantasy violence — answer the questionnaire honestly).
   - **Review notes**: state clearly "No in-app purchases; account is optional; here is a demo login." Provide a test account.
4. Submit for review (typically 24–48h).

### Google Play
1. Create the app in **Play Console**.
2. **App signing**: enrol in **Play App Signing** (Google holds the signing key; you upload with an upload key).
3. Build a signed **`.aab`**:
   ```bash
   cd android && ./gradlew bundleRelease
   ```
4. Complete the required forms:
   - **Data safety** (mirror of the privacy labels; declare email + game data, and the account-deletion URL).
   - **Content rating** (IARC questionnaire).
   - Target audience, privacy policy URL, ads declaration (**No** — no ad SDK in the app build).
5. Roll out to **Internal testing** first → Closed → Production. Internal testing reviews fast and is the right place to validate the signed build on real devices.

---

## 8. Phase 5 — Updates strategy (keep web & app in lockstep)

- **Web content changes** (game balance, screens, data) flow to the app simply by rebuilding `www/` and shipping a new binary. Because the app loads a **bundled** `www/`, a store update is needed for the user to get new web code.
- **Optional OTA**: Capacitor supports **live updates** (Appflow, or self-hosted via `@capacitor/live-updates`) to push web-bundle changes without a store review. Useful for balance tweaks/bug fixes. **Caveat**: Apple permits JS/asset OTA updates *that don't change the app's purpose*, but you must not use it to add store-gated features (e.g. enabling purchases). Treat OTA as bugfix/content only.
- **Server/API** (`functions/**`) deploys independently to Cloudflare — both web and app consume it. Maintain backward compatibility so older app binaries keep working (users update slowly). Version the API if you make breaking changes.
- **Build matrix to maintain:**

  | Target | Command | Output | Deploy |
  |---|---|---|---|
  | Browser | `npm run build` + `npm run rebuild` | CDN `index.html` | Cloudflare Pages |
  | App (iOS/Android) | `npm run build:app` → `npx cap sync` | `www/` → `ios/`,`android/` | App Store / Play |
  | API | (existing) | `functions/**` | Cloudflare |

---

## 9. Phase 6 — CI/CD (optional, recommended once manual flow works)

- **Fastlane** for both platforms (`gym`/`deliver` for iOS, `supply` for Android) — scriptable, store-credential-aware.
- **GitHub Actions**: Android can build on Ubuntu runners; **iOS needs a macOS runner**. Store signing secrets (Apple API key, Android keystore) in encrypted CI secrets — never in the repo.
- **Codemagic / EAS-style services**: turnkey if you don't want to manage Mac runners.
- Gate releases on the existing commit gate: `npm test && npm run build && npm run rebuild && npm run check:single` (from `CLAUDE.md` §11) plus `npm run build:app`.

---

## 10. Sequenced checklist

**Phase 0 — code (do first, all in `src`/`functions`, fully testable on web):**
- [ ] 3.1 Self-contained app bundle (`vite.config.app.js`, local fonts, `base:'./'`, `build:app` → `www/`, verify zero network at boot)
- [ ] 3.2 `apiBase.js` + absolute URLs in `api.js`/`pvp.js`/beacon; server CORS for `capacitor://localhost` & `https://localhost`
- [ ] 3.3 Native OAuth via system browser + `pocketrpg://` deep link; register redirect in GitHub & Google consoles
- [ ] 3.4 Hide purchase/skip-hour UI when `Capacitor.isNativePlatform()`
- [ ] 3.5 Generate icons/splash + manifest
- [ ] 3.6 Account-deletion endpoint + UI (iOS-blocking)

**Phase 1–3 — native shells:**
- [ ] Add Capacitor, init, `cap add ios/android`; commit `ios/`,`android/`
- [ ] Configure bundle IDs, deep links, status bar, safe areas, orientation
- [ ] Install/validate plugins; test tick/idle/IndexedDB/PvP/back-button on real devices

**Phase 4–5 — stores:**
- [ ] Apple Developer + Google Play enrolment (start early)
- [ ] Privacy policy + support URLs live
- [ ] App Store Connect listing, privacy labels, screenshots, Sign in with Apple if needed → submit
- [ ] Play Console listing, app signing, data-safety, content rating, signed `.aab` → internal testing → production

**Phase 6 — after first manual release:**
- [ ] CI/CD (Fastlane / Actions / Codemagic), optional OTA live-updates for content fixes

---

## Appendix A — Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Apple rejects for missing account deletion | High if skipped | Implement 3.6 before submission |
| Apple flags missing "Sign in with Apple" | Medium | Add Apple login (3.3) or be ready to fast-follow |
| CDN dependencies break offline review | High if not fixed | 3.1 — bundle everything locally |
| API 404s in native (relative paths) | Certain if not fixed | 3.2 — absolute base URL + CORS |
| Background timer throttling skews idle | Medium | Lean on server idle catch-up; test on device |
| Play target-API-level rejection | Medium | Bump `targetSdkVersion` to current requirement |

## Appendix B — Cost summary

- Apple Developer: **$99/yr** · Google Play: **$25 once** · (optional) Codemagic/cloud Mac, Appflow OTA: usage-based.

## Appendix C — If you later want in-app purchases

Add native IAP rather than Stripe-in-app:
- Plugin: a maintained Capacitor purchases plugin (e.g. RevenueCat's `@revenuecat/purchases-capacitor`, or Cordova `cordova-plugin-purchase`).
- Define products in **App Store Connect** and **Play Console** (consumables for credits, non-consumable for remove-ads).
- **Server-side receipt validation** before granting entitlements — fits the existing server-authoritative model (`CLAUDE.md` §14). Mirror the Stripe grant logic in `functions/` keyed off validated Apple/Google receipts.
- Keep Stripe for the web; the entitlement (credits/remove-ads) is account-level, so a purchase on any platform reflects everywhere via the cloud save.
