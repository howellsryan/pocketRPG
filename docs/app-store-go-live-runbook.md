# PocketRPG iOS — Go-Live Runbook

> A step-by-step checklist to take the app from "code is ready" to "live on the App Store". The engineering (Capacitor, offline build, native OAuth, CORS, account deletion, Codemagic config) is **already done and on the branch** — this runbook is the account setup, build, QA, and submission work that can't be done from code.
>
> Companion doc: `docs/app-store-deployment-plan.md` (the why/how and deeper detail). This runbook is the do-this-then-that sequence.
>
> **Identifiers used everywhere** (keep consistent): bundle id `uk.co.pocketrpg.app` · URL scheme `pocketrpg://auth/callback` · Codemagic ASC integration name `PocketRPG ASC Key`.

---

## 0. What's already built (no action needed)
- ✅ Self-contained offline build: `npm run build:app` → `www/` (no CDN).
- ✅ App talks to the live API origin (`https://pocketrpg.co.uk`) — `src/cloud/apiBase.js`.
- ✅ Native CORS, OAuth deep-link redirect, and `DELETE /api/auth/account` — in `functions/`.
- ✅ Capacitor 8 iOS project committed (`ios/`, SPM — no CocoaPods), `pocketrpg://` scheme, portrait lock, shared `App.xcscheme`.
- ✅ Codemagic pipeline: `codemagic.yaml`.

⚠️ The server-side pieces only go live **when this branch is merged and Cloudflare Pages deploys it**. The app calls production, so **merge + deploy must happen before (or as) you ship the app.**

---

## 1. Apple Developer Program (do first — can take 24–48h)
- [ ] Enrol at developer.apple.com — **£79/year**. Individual is simplest (lists your name); Organization needs a D-U-N-S number and lists a company name.
- [ ] Use the Apple ID you want to own this long-term (moving apps between accounts later is painful).

One membership covers **unlimited** apps; free apps incur **no** Apple commission.

## 2. App Store Connect — create the app record
- [ ] App Store Connect → **My Apps → + → New App**.
  - Platform: iOS · Name: `PocketRPG` (must be globally unique on the store — have a backup name ready) · Primary language: English (UK).
  - **Bundle ID**: register/select `uk.co.pocketrpg.app`.
  - SKU: anything stable, e.g. `pocketrpg-ios`.
- [ ] Note the numeric **Apple ID** of the app (shown on the App Information page) — handy later.

## 3. App Store Connect API key (drives Codemagic signing)
- [ ] App Store Connect → **Users and Access → Integrations → App Store Connect API → +**.
  - Access: **App Manager**.
  - Download the **`.p8`** key (one-time download!), and copy the **Issuer ID** and **Key ID**.

## 4. Codemagic setup
- [ ] Sign up at codemagic.io with the GitHub account, give it access to `howellsryan/pocketRPG`.
- [ ] **Teams → Integrations → App Store Connect → Connect**: upload the `.p8`, Issuer ID, Key ID. **Name it exactly `PocketRPG ASC Key`** (matches `integrations.app_store_connect` in `codemagic.yaml`).
- [ ] Codemagic → add the app from the repo. It will detect `codemagic.yaml`.

> Automatic signing: with the ASC key connected and `ios_signing.distribution_type: app_store` set in `codemagic.yaml`, Codemagic creates/fetches the distribution certificate + provisioning profile for `uk.co.pocketrpg.app`. No manual certs needed.

## 5. Deploy the backend (merge the branch)
- [ ] Merge `claude/game-appstore-deployment-FDxHd` → main so Cloudflare Pages deploys the native CORS, OAuth deep-link redirect, and account-deletion endpoint to `pocketrpg.co.uk`.
- [ ] Sanity check (from a terminal): an `OPTIONS` preflight from `capacitor://localhost` returns the `Access-Control-Allow-Origin` header, and `https://pocketrpg.co.uk/api/auth/github?platform=native` issues the OAuth redirect.
- [ ] No GitHub/Google OAuth provider changes are required (the deep link is server-issued, not a provider redirect URI).

## 6. App assets (icons + splash)
- [ ] Prepare a **1024×1024** PNG icon (no transparency, no rounded corners — Apple rounds it) and optionally a splash source.
- [ ] Generate all sizes:
  ```bash
  npm i -D @capacitor/assets
  # place assets/icon.png (1024x1024) and optionally assets/splash.png (2732x2732)
  npx capacitor-assets generate --ios
  npx cap sync ios
  ```
- [ ] Commit the regenerated `ios/App/App/Assets.xcassets`. (Until then the build uses Capacitor's placeholder icon — fine for TestFlight, **not** for production.)

## 7. Set the marketing version
- [ ] Set the user-facing version (e.g. `1.0.0`). In the Xcode project that's `MARKETING_VERSION`; the build number is bumped automatically by `codemagic.yaml` from `$BUILD_NUMBER`. (Each TestFlight upload needs a unique build number; the version string can stay `1.0.0` across builds.)

## 8. First Codemagic build → TestFlight
- [ ] Trigger a build (push to the configured branch, or "Start new build" in Codemagic).
- [ ] If the first build fails, the usual culprits:
  - Signing: confirm the ASC key name matches and the bundle id is registered.
  - Scheme: the shared `App.xcscheme` is committed; confirm scheme name `App`.
  - Version/build number collision: bump if App Store Connect rejects a duplicate.
- [ ] On success the build lands in **App Store Connect → TestFlight**.
- [ ] Add yourself as an **Internal Tester** (Users and Access → your Apple ID on the team). Install the **TestFlight** app on your iPhone and accept the invite. Internal builds need no review and appear within minutes.

## 9. On-device QA (the things that couldn't be verified without a device)
Run all of these on a real iPhone via TestFlight before considering production:
- [ ] **App launches offline** (airplane mode) — game UI loads, fonts render (Cinzel headings), styling matches the web.
- [ ] **GitHub login** works via the system browser and returns into the app (`pocketrpg://`).
- [ ] **Google login** works (opens Safari, not blocked as an embedded WebView) and returns.
- [ ] **Same account, cross-platform** (§10 of the plan): log in on web and app with the same Google account → same characters; earn progress on web → appears in app and vice-versa.
- [ ] **Cross-client PvP**: queue on app vs. web (two accounts) → they match and settle identically.
- [ ] **Trading post / leaderboard / collection log** show identical state across web and app.
- [ ] **Idle/600ms tick**: background the app for a few minutes, reopen → idle catch-up reconciles via the server (no divergence/loss).
- [ ] **Persistence**: force-quit and relaunch → save intact.
- [ ] **No purchases visible** anywhere in the app (no buy-credits / skip-hour / remove-ads CTAs).
- [ ] **Account deletion**: the in-app "Delete account" button removes the account and data, then drops to the login screen.
- [ ] Status bar legible (dark style), no notch/safe-area clipping.

## 10. Production submission (App Review)
- [ ] **Privacy policy** live at `pocketrpg.co.uk/privacy` and a **support** page/URL.
- [ ] **App Privacy ("nutrition labels")**: declare email (from OAuth) + game/usage data linked to identity; provide the privacy-policy URL.
- [ ] **Account deletion**: confirm the in-app deletion path exists (Apple checks this).
- [ ] **Sign in with Apple** ⚠️: because the app offers Google/GitHub login, Apple's Guideline 4.8 has historically **required** offering "Sign in with Apple" too. This is the most likely production-review blocker — confirm against the current guidelines; if required, it's a server endpoint + Apple key (can be a fast-follow if a reviewer flags it, but better to have it ready). Not needed for TestFlight.
- [ ] **Screenshots**: 6.7" and 6.5" iPhone sizes (capture from TestFlight on device or a simulator).
- [ ] Description, keywords, support URL, **age rating** questionnaire (likely 12+ for fantasy violence — answer honestly).
- [ ] **Review notes**: state "No in-app purchases; account optional," and provide a **demo login** (a test account) so the reviewer can see gameplay.
- [ ] Submit: flip `submit_to_app_store: true` in `codemagic.yaml` (with release notes) **or** click Submit for Review in App Store Connect. Review is typically 24–48h.

## 11. After launch — keeping web & app in sync
- Web/game changes reach the app by rebuilding `www/` and shipping a new build (`npm run build:app` → push → Codemagic → TestFlight/App Store).
- **API** (`functions/`) deploys independently to Cloudflare; keep it backward-compatible so older app versions keep working.
- Optional **OTA** for bugfix/content updates without re-review: Capacitor live updates, bundle hostable on **Cloudflare R2** (bugfix/content only — never to add store-gated features).

## 12. When you have paying users (the monetisation jump)
We deliberately **hid purchases in the app** for the first release. To sell inside the app later you must use **native IAP** (StoreKit), not Stripe — see Appendix C of `docs/app-store-deployment-plan.md`:
- Define products in App Store Connect (consumables = credits; non-consumable = remove-ads).
- Add a Capacitor purchases plugin (e.g. `@revenuecat/purchases-capacitor`).
- **Server-side receipt validation** before granting entitlements (mirrors the existing Stripe grant logic; entitlements are account-level so they reflect on web too).
- Keep Stripe for the web. Apple takes 15% (Small Business Program) / 30%.

---

### Quick reference — the build loop (once set up)
```bash
npm run build:app      # self-contained www/
npx cap sync ios       # copy into the iOS project
# commit + push → Codemagic builds, signs, uploads to TestFlight
```
