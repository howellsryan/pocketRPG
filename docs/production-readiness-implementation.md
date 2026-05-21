# PocketRPG — Production Readiness Implementation Guide

Concrete, sequenced steps to close the P0 launch blockers identified in the May 2026 production readiness review. Each step is independently shippable and committable; later steps depend on earlier ones only where explicitly noted.

## Sequencing rationale

| # | Step | Why this order |
| - | ---- | -------------- |
| 1 | Lock `PUT /api/save` to non-economy fields | Single largest exploit surface. Until this lands, every other server-authority fix is decorative. |
| 2 | Trading post race + ordering fix | Active dupe path. Days of paid traffic = real coin/item inflation. |
| 3 | Stripe checkout session + webhook hardening | Direct chargeback / money-laundering exposure. Touches Stripe Dashboard so allow time. |
| 4 | `purchase_grants` + `audit_events` tables | Required by §14 and by Stripe dispute resolution. Independent of (3) but they share a migration window. |
| 5 | Lock `POST /api/collection-log` | Small endpoint, low risk to change; depends on (1) since the only legit write path is `actionCompletion.js`. |
| 6 | Action nonces → DB table | Required to make the action-completion replay defence actually work post-(1). |
| 7 | Make `save_revision` mandatory | Trivial once (1) is in place — fold into the same release if possible. |

You can land each step as a separate PR. Ship 1, 2, 6, 7 before 3 if Stripe is gated behind a feature flag.

---

## Step 1 — Lock `PUT /api/save` to non-economy fields

### Goal

`/api/save` becomes a sync channel for **UI / settings / non-economy state only**. Every economy mutation must travel through an `/api/actions/*` endpoint that runs server-authoritative `settleActionCompletion` (or its equivalents).

### Files

- `functions/api/save.js` — handler
- `functions/_lib/game/saveValidation.js` — replace `detectProtectedDelta` with an allowlist-based diff
- `functions/_lib/saveSummary.js` — `total_level` / `combat_level` denormalization must stop trusting client (recompute from server-stored save instead, or remove from this path)
- `src/cloud/sync.js` — client must stop pushing economy deltas through `/api/save`
- New file: `functions/_lib/game/saveDiff.js`

### Design

Three top-level "zones" in the save blob:

1. **Server-owned** — written only by `actionCompletion.js` / idle claim / trading-post / PvP. Never accepted from the client via `/api/save`:
   - `stats.*.xp`
   - `bank` (all keys)
   - `inventory`
   - `equipment`
   - `slayer.points`, `slayer.taskMonsterId`, `slayer.taskRemaining`
   - `dungeoneeringTokens`, `settings.dungeoneeringTokens`
   - `settings.bossKillCounts`, `settings.raidKillCounts`
   - `settings.unlockedMinigameItems`
   - `collectionLog` (and any client-side mirror)
   - `_serverActionNonces` (moves to DB in step 6 — until then, still server-only)
   - `creditsUsed` / credit balance reflections

2. **Client-owned** — UI/UX state the server doesn't care about:
   - `settings.theme`, `settings.autoBank`, `settings.combatStyle`
   - `ui.*`
   - `currentAction` (current target only; outcomes write through action endpoints)
   - `hp` (capped — see invariant)

3. **Replicated-but-server-validated** — must match a server-recomputed value or be rejected:
   - `stats.*.level` (must equal `xpToLevel(stats.*.xp)` from the server's stored xp)
   - `combatLevel`, `totalLevel`

### Implementation sketch

`functions/_lib/game/saveDiff.js`:

```js
// Top-level paths the client may write through /api/save.
// Everything else must match the server's current value byte-for-byte
// (after canonicalization) or be reset to it.
export const CLIENT_WRITABLE_PATHS = new Set([
  'settings.theme',
  'settings.autoBank',
  'settings.combatStyle',
  'settings.notifications',
  'ui',
  'currentAction',
  'hp',
])

const SERVER_OWNED_TOP_LEVEL = new Set([
  'stats', 'bank', 'inventory', 'equipment', 'slayer',
  'dungeoneeringTokens', 'collectionLog', '_serverActionNonces',
  'creditsUsed',
])

const SERVER_OWNED_SETTINGS = new Set([
  'dungeoneeringTokens', 'bossKillCounts', 'raidKillCounts',
  'unlockedMinigameItems',
])

// Produce a "sanitized" next save by starting from the server's current
// save and copying ONLY client-writable paths from the incoming blob.
// Anything in SERVER_OWNED_* is taken from the server's copy verbatim.
export function buildSanitizedSave(serverSave, incomingSave) {
  const next = structuredClone(serverSave || {})

  // hp: clamp to [0, currentMaxHp(serverSave)]; do not allow client to set 0
  // unless the server's currentAction would have killed them — but easier:
  // accept whatever the client sends, capped to maxHp. HP-zero handling
  // lives in the death endpoint, not /api/save.
  if (typeof incomingSave?.hp === 'number') {
    const maxHp = computeMaxHp(serverSave)
    next.hp = Math.max(0, Math.min(maxHp, Math.floor(incomingSave.hp)))
  }

  // currentAction: pure routing, no rewards.
  if (incomingSave?.currentAction !== undefined) {
    next.currentAction = sanitizeCurrentAction(incomingSave.currentAction)
  }

  // settings: copy only client-writable settings.* keys; never overwrite
  // server-owned ones.
  if (incomingSave?.settings && typeof incomingSave.settings === 'object') {
    if (!next.settings) next.settings = {}
    for (const [k, v] of Object.entries(incomingSave.settings)) {
      if (SERVER_OWNED_SETTINGS.has(k)) continue
      next.settings[k] = v
    }
  }

  // ui: free-form, but cap byte size.
  if (incomingSave?.ui !== undefined) {
    next.ui = incomingSave.ui
  }

  return next
}
```

`functions/api/save.js`:

```js
// Replace the existing detectProtectedDelta block with:
const existingSaveJson = existing?.save_data
  ? (await decodeSaveRow(existing))?.save_data
  : null
const serverSave = existingSaveJson ? JSON.parse(existingSaveJson) : {}
const incoming = save_data ? JSON.parse(save_data) : {}
const sanitized = buildSanitizedSave(serverSave, incoming)
const sanitizedJson = JSON.stringify(sanitized)

// computeSaveSummaryFromJson runs on the SANITIZED save, never the client's
// claim. Means client cannot lie about total_level / combat_level either.
const { totalLevel, combatLevel } = computeSaveSummaryFromJson(sanitizedJson)
const save_blob = await gzipJsonString(sanitizedJson)

// ... write sanitizedJson + sanitized save_blob to the row.
```

### Migration

None. This is a code-only change. The save blob shape is unchanged.

### Test plan

Add to `tests/api/save.test.ts`:

```js
it('rejects client attempts to increase coins via /api/save', async () => {
  // GIVEN server save with bank.coins.quantity = 100
  // WHEN client PUTs save with bank.coins.quantity = 1_000_000_000
  // THEN response is 200 (sanitized), but DB save still has 100
})

it('rejects client attempts to increase xp', async () => { /* ... */ })
it('rejects client attempts to add inventory items', async () => { /* ... */ })
it('rejects client attempts to add to collection log', async () => { /* ... */ })
it('accepts client UI settings updates', async () => { /* ... */ })
it('preserves _serverActionNonces from server even if client omits them', async () => { /* ... */ })
it('recomputes total_level / combat_level from sanitized state', async () => { /* ... */ })
```

Also update existing tests that did "save → assert state" to use the action endpoints, not the save endpoint, where economy changes are involved.

### Client changes

`src/cloud/sync.js` and any caller of `cloudPushSave` should be audited to confirm no code path expects `/api/save` to commit economy changes. The action endpoints (`/api/actions/monster/complete`, `/api/actions/raid/complete`, etc.) already return `{ save_revision }` — that's the only mutation path post-fix.

Audit step:
```bash
grep -nR "cloudPushSave\|api/save\|PUT.*save" src/
```

For each call site, confirm what fields it expected to persist. Migrate any economy mutation to the corresponding action endpoint.

### Rollback

Pure code change. Revert the PR.

### Watch-outs

- Offline-first: the client still computes XP/coins offline and shows them. That's fine — those values become a *projection* the user sees, but they are only **committed** when the client comes online and replays the queued actions through `/api/actions/*`. If your current offline replay doesn't already go through the action endpoints, you have a bigger refactor than this step describes; flag that to the team before starting.
- `creditsUsed` was being incremented from the client via `credits_used_increment`. Remove that field — credit spending must go through `/api/skip-hour`, `/api/slayer/skip`, etc., which already debit credits atomically server-side.

---

## Step 2 — Trading post: atomic fills + write-save-first ordering

### Goal

Eliminate the two known dupe paths:
- Concurrent fills on the same resting offer can both succeed.
- `/list` mutates DB rows before `writeSave` commits, so a save_revision conflict leaves DB-side state debited while the player's escrow was never taken.

### Files

- `functions/_lib/game/tradingPost.js` — `recordFill`, `executeMatching`, `instantSellOffer`
- `functions/api/trading-post/list.js` — re-order the call sequence
- `functions/api/trading-post/instant-sell.js` — same ordering

### Fix A — `recordFill` must use a conditional, relative UPDATE

Current code (`tradingPost.js:140-144`) writes `quantity_remaining = ?` from a JS-computed value. Replace with:

```js
async function recordFill(env, { buyerOfferId, sellerOfferId, tradeQty, tradePrice, sellerIsOrphan }) {
  const now = nowMs()
  const tradeGold = tradePrice * tradeQty

  // Seller-side update: conditional decrement, with the "is this still
  // the same shape we expected?" guard baked into the WHERE clause.
  const sellerUpd = sellerIsOrphan
    ? await env.DB.prepare(
        `UPDATE trading_post_offers
            SET quantity_remaining = quantity_remaining - ?, updated_at = ?
          WHERE id = ?
            AND quantity_remaining >= ?
            AND status = 'active'
            AND character_id IS NULL`
      ).bind(tradeQty, now, sellerOfferId, tradeQty).run()
    : await env.DB.prepare(
        `UPDATE trading_post_offers
            SET coins_pending = coins_pending + ?,
                quantity_remaining = quantity_remaining - ?,
                updated_at = ?
          WHERE id = ?
            AND quantity_remaining >= ?
            AND status = 'active'
            AND character_id IS NOT NULL`
      ).bind(tradeGold, tradeQty, now, sellerOfferId, tradeQty).run()

  if (!sellerUpd?.meta?.changes) {
    // Race: another concurrent fill consumed this offer's remaining stock
    // (or it was orphaned/cancelled). Signal the caller to retry / re-fetch.
    throw new GameApiError('OFFER_RACE', 'offer changed concurrently', 409)
  }

  const buyerUpd = await env.DB.prepare(
    `UPDATE trading_post_offers
        SET items_pending = items_pending + ?,
            coins_pending = coins_pending + ?,
            quantity_remaining = quantity_remaining - ?,
            updated_at = ?
      WHERE id = ?
        AND quantity_remaining >= ?
        AND status = 'active'`
  ).bind(tradeQty, tradeGold, tradeQty, now, buyerOfferId, tradeQty).run()

  if (!buyerUpd?.meta?.changes) {
    // Buyer side decrement failed — the new offer should be the only writer
    // here in a single matching pass, so this is a real consistency error.
    throw new GameApiError('FILL_INTEGRITY', 'buyer-side decrement failed', 500)
  }
}
```

In `executeMatching`, catch `OFFER_RACE` and continue to the next opposing offer instead of aborting:

```js
for (const opp of opposing) {
  if (remaining <= 0) break
  // ...
  try {
    await recordFill(env, { ... })
  } catch (err) {
    if (err?.code === 'OFFER_RACE') {
      // Skip this offer; refetch is unnecessary because cheaper offers
      // already passed.
      continue
    }
    throw err
  }
  // ...
}
```

### Fix B — `/list`: ordering so `writeSave` is the gate

Current order in `list.js`:
1. Escrow in `saveObject` (memory only) ✓
2. `insertOffer` — writes DB row 1
3. `executeMatching` — writes DB rows for fills
4. `writeSave` — may throw `SAVE_REVISION_CONFLICT`

If (4) throws, all DB rows from (2) and (3) are committed and the player has free items_pending. Fix by gating on `writeSave` success:

Option B1 (preferred, smaller diff) — **two-phase commit pattern**:
1. Compute escrowed save in memory.
2. `writeSave` first to lock in the player's escrow (this is the atomic gate — if it fails, no DB rows have been written yet).
3. `insertOffer` + `executeMatching`.
4. If any step in (3) throws, **compensating refund**: call `writeSave` again with the original `saveObject` (re-load it).

The compensating refund is best-effort but acceptable because (3) errors after (2) are very rare (only D1 IO failures); audit log emits a `tradingPost.compensating_refund` event with the failed offer details for support follow-up.

Option B2 (safer, larger diff) — **D1 batch** wrapping `insertOffer` + the fills + a final save write into one `env.DB.batch([...])` so they commit atomically. D1 supports multi-statement batches with the same isolation, so this is preferable when the matching pass is small. Matching against more than ~25 levels can blow D1's per-statement-batch limits, so cap matching depth or fall back to B1 for deep books.

Recommendation: ship B1 first; add B2 once you have telemetry on average book depth.

### Fix C — `instantSellOffer` race

The same `character_id = NULL` UPDATE needs a `WHERE character_id IS NOT NULL AND quantity_remaining = ? RETURNING ...` guard so a buyer matching the same offer mid-orphan-flip gets `OFFER_RACE`. Apply the same conditional-update pattern.

### Migration

None. Schema is unchanged.

### Test plan

Add to `tests/api/tradingPost.test.ts`:

```js
it('two concurrent buys against one resting sell credit only the correct totals', async () => { /* ... */ })
it('rejects the second concurrent buy with OFFER_RACE and moves to next offer', async () => { /* ... */ })
it('writeSave failure rolls back any DB-side state (no orphan offer rows)', async () => { /* ... */ })
it('instant-sell vs in-flight buyer: only one of (orphan-payout, normal-fill) succeeds', async () => { /* ... */ })
```

### Rollback

Code-only. Revert the PR. The new UPDATE WHERE clauses are strictly stricter than today's — no possibility of post-revert data left in a broken state.

---

## Step 3 — Stripe: server-issued Checkout Session + webhook hardening

### Goal

Move credit purchasing off public Payment Links onto a server-created Checkout Session bound to an authenticated user. Add idempotency, payment-status / livemode checks, constant-time signature comparison, and refund/dispute handling.

### Stripe Dashboard prerequisites

Before merging:
1. Create four Stripe **Products** with prices for `remove_ads`, `credits_10`, `credits_100`, `credits_1000`. Note their price IDs.
2. Set `STRIPE_API_KEY` (the live secret key, `sk_live_…`) in Cloudflare Pages secrets for prod and `sk_test_…` for preview.
3. Configure the webhook endpoint in Stripe to `POST https://pocketrpg.co.uk/api/stripe/webhook` and subscribe to:
   - `checkout.session.completed`
   - `charge.refunded`
   - `charge.dispute.created`
   - `charge.dispute.funds_withdrawn`

Drop the `STRIPE_PAYMENT_LINK_*` secrets after rollout — they're no longer used.

### New endpoint: `POST /api/stripe/create-session`

`functions/api/stripe/create-session.js`:

```js
import { requireAuth, json } from '../../_lib/auth.js'

const PRICE_MAP = {
  remove_ads:    { priceId: 'price_xxx_remove_ads',    type: 'remove_ads', amount: 0 },
  credits_10:    { priceId: 'price_xxx_credits_10',    type: 'credits',    amount: 10 },
  credits_100:   { priceId: 'price_xxx_credits_100',   type: 'credits',    amount: 100 },
  credits_1000:  { priceId: 'price_xxx_credits_1000',  type: 'credits',    amount: 1000 },
}

export async function onRequestPost({ request, env }) {
  const auth = await requireAuth(request, env)
  if (auth.error) return json({ error: auth.error }, auth.status)

  let body
  try { body = await request.json() } catch { return json({ error: 'Invalid JSON' }, 400) }

  const sku = String(body?.sku || '')
  const characterId = parseInt(body?.character_id || '0', 10)
  const price = PRICE_MAP[sku]
  if (!price) return json({ error: 'Invalid SKU' }, 400)

  // For credits, the character must belong to this identity.
  if (price.type === 'credits') {
    const owns = await env.DB.prepare(
      'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, auth.identity.id).first()
    if (!owns) return json({ error: 'Character not found' }, 404)
  }

  // Server-issued client_reference_id: encodes the *server's* truth about
  // who's buying and what. The webhook will verify the same fields in
  // session.metadata, which we set here.
  const clientRef = `${auth.identity.id}:${price.type === 'credits' ? characterId : 0}`

  const form = new URLSearchParams()
  form.append('mode', 'payment')
  form.append('success_url', `${env.APP_BASE_URL}/?purchase=success`)
  form.append('cancel_url',  `${env.APP_BASE_URL}/?purchase=cancel`)
  form.append('line_items[0][price]', price.priceId)
  form.append('line_items[0][quantity]', '1')
  form.append('client_reference_id', clientRef)
  form.append('metadata[identity_id]', String(auth.identity.id))
  form.append('metadata[character_id]', String(price.type === 'credits' ? characterId : 0))
  form.append('metadata[type]', price.type)
  form.append('metadata[amount]', String(price.amount))
  form.append('metadata[sku]', sku)
  // payment_intent_data also gets the metadata so refund webhooks can read it.
  form.append('payment_intent_data[metadata][identity_id]', String(auth.identity.id))
  form.append('payment_intent_data[metadata][character_id]', String(price.type === 'credits' ? characterId : 0))
  form.append('payment_intent_data[metadata][type]', price.type)
  form.append('payment_intent_data[metadata][amount]', String(price.amount))

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.STRIPE_API_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form,
  })
  if (!res.ok) {
    return json({ error: 'Stripe session creation failed' }, 502)
  }
  const session = await res.json()
  return json({ url: session.url, id: session.id })
}
```

### Updated webhook: `functions/api/stripe/webhook.js`

```js
import { json } from '../../_lib/auth.js'

function constantTimeEqualHex(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = sigHeader.split(',')
  const tPart = parts.find(p => p.startsWith('t='))
  const v1Parts = parts.filter(p => p.startsWith('v1='))
  if (!tPart || v1Parts.length === 0) return false
  const timestamp = tPart.slice(2)
  if (Math.abs(Date.now() / 1000 - parseInt(timestamp, 10)) > 300) return false
  const signedPayload = `${timestamp}.${rawBody}`
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  )
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload))
  const computed = [...new Uint8Array(mac)].map(b => b.toString(16).padStart(2, '0')).join('')
  return v1Parts.some(p => constantTimeEqualHex(p.slice(3), computed))
}

export async function onRequestPost({ request, env }) {
  const sigHeader = request.headers.get('stripe-signature')
  if (!sigHeader) return json({ error: 'Missing signature' }, 400)
  if (!env.STRIPE_WEBHOOK_SECRET) return json({ error: 'Webhook secret missing' }, 500)

  const rawBody = await request.text()
  if (!await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET)) {
    return json({ error: 'Invalid signature' }, 400)
  }

  let event
  try { event = JSON.parse(rawBody) } catch { return json({ error: 'Invalid JSON' }, 400) }

  // Livemode guard: prod webhook only accepts livemode events. Preview
  // accepts only test-mode. Misrouted events 400.
  const expectLive = env.APP_BASE_URL?.includes('pocketrpg.co.uk')
  if (Boolean(event.livemode) !== Boolean(expectLive)) {
    return json({ error: 'livemode mismatch' }, 400)
  }

  // Idempotency: insert-or-ignore the event id; only proceed if the row was
  // newly inserted (changes === 1). Stripe retries hit the ON CONFLICT path
  // and return 200 immediately without re-applying.
  const insertRes = await env.DB.prepare(
    `INSERT INTO stripe_events (event_id, event_type, livemode, received_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(event_id) DO NOTHING`
  ).bind(event.id, event.type, event.livemode ? 1 : 0, Date.now()).run()
  if (!insertRes?.meta?.changes) return json({ received: true, duplicate: true })

  try {
    if (event.type === 'checkout.session.completed') {
      await handleCheckoutCompleted(env, event)
    } else if (event.type === 'charge.refunded' || event.type === 'charge.dispute.funds_withdrawn') {
      await handleRefundOrDispute(env, event)
    } else if (event.type === 'charge.dispute.created') {
      await handleDisputeCreated(env, event)
    }
  } catch (err) {
    // If the grant failed, mark the event for retry by deleting the
    // idempotency row so Stripe's next retry can re-attempt. Return 500.
    await env.DB.prepare('DELETE FROM stripe_events WHERE event_id = ?').bind(event.id).run()
    console.error('webhook handler failed', event.id, err)
    return json({ error: 'handler_failed' }, 500)
  }

  return json({ received: true })
}

async function handleCheckoutCompleted(env, event) {
  const session = event.data?.object
  if (!session) throw new Error('missing session')

  // Hard guards: must be paid, must have amount_total > 0.
  if (session.payment_status !== 'paid') return  // ignore unpaid async-pay
  if (!Number.isFinite(session.amount_total) || session.amount_total <= 0) {
    throw new Error('amount_total invalid')
  }

  // Identity comes from session.metadata, set by /api/stripe/create-session.
  // Cross-check against client_reference_id to detect tampering.
  const identityId = parseInt(session.metadata?.identity_id || '0', 10)
  const characterId = parseInt(session.metadata?.character_id || '0', 10)
  const type = session.metadata?.type
  const amount = parseInt(session.metadata?.amount || '0', 10)
  const expectedRef = `${identityId}:${characterId}`
  if (session.client_reference_id !== expectedRef) {
    throw new Error('client_reference_id mismatch')
  }
  if (!identityId || !type) throw new Error('missing identity / type')

  if (type === 'remove_ads') {
    await env.DB.prepare(
      'UPDATE oauth_identities SET remove_ads = 1 WHERE id = ?'
    ).bind(identityId).run()
    await recordGrant(env, { event, identityId, characterId: null, type, amount: 0, session })
  } else if (type === 'credits' && amount > 0) {
    // Verify the character still belongs to the identity at grant time.
    const owns = await env.DB.prepare(
      'SELECT id FROM characters WHERE id = ? AND owner_id = ? AND deleted_at IS NULL'
    ).bind(characterId, identityId).first()
    if (!owns) throw new Error('character not owned by identity')

    await env.DB.prepare(
      'UPDATE characters SET credits = credits + ? WHERE id = ?'
    ).bind(amount, characterId).run()
    await recordGrant(env, { event, identityId, characterId, type, amount, session })
  } else {
    throw new Error('unknown grant type')
  }
}

async function recordGrant(env, { event, identityId, characterId, type, amount, session }) {
  await env.DB.prepare(
    `INSERT INTO purchase_grants
      (event_id, identity_id, character_id, type, amount, amount_total, currency,
       stripe_session_id, stripe_payment_intent_id, livemode, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    event.id, identityId, characterId || null, type, amount,
    session.amount_total, session.currency,
    session.id, session.payment_intent || null,
    event.livemode ? 1 : 0, Date.now()
  ).run()
}

async function handleRefundOrDispute(env, event) {
  // Find the original grant by payment_intent.
  const pi = event.data?.object?.payment_intent
  if (!pi) return
  const grant = await env.DB.prepare(
    'SELECT * FROM purchase_grants WHERE stripe_payment_intent_id = ? ORDER BY created_at DESC LIMIT 1'
  ).bind(pi).first()
  if (!grant) return

  if (grant.type === 'credits') {
    // Decrement credits, floored at 0 (player may have already spent some).
    await env.DB.prepare(
      'UPDATE characters SET credits = MAX(0, credits - ?) WHERE id = ?'
    ).bind(grant.amount, grant.character_id).run()
  } else if (grant.type === 'remove_ads') {
    await env.DB.prepare(
      'UPDATE oauth_identities SET remove_ads = 0 WHERE id = ?'
    ).bind(grant.identity_id).run()
  }
  await env.DB.prepare(
    'UPDATE purchase_grants SET reversed_at = ?, reversal_reason = ? WHERE event_id = ?'
  ).bind(Date.now(), event.type, grant.event_id).run()
}

async function handleDisputeCreated(env, event) {
  // Flag the account; do not auto-reverse until funds_withdrawn fires.
  const pi = event.data?.object?.payment_intent
  if (!pi) return
  await env.DB.prepare(
    `UPDATE purchase_grants SET disputed_at = ? WHERE stripe_payment_intent_id = ? AND disputed_at IS NULL`
  ).bind(Date.now(), pi).run()
}
```

### Migration: `migrations/0016_stripe_events_and_grants.sql`

```sql
CREATE TABLE IF NOT EXISTS stripe_events (
  event_id     TEXT PRIMARY KEY,
  event_type   TEXT NOT NULL,
  livemode     INTEGER NOT NULL,
  received_at  INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS purchase_grants (
  event_id                  TEXT PRIMARY KEY,
  identity_id               INTEGER NOT NULL,
  character_id              INTEGER,
  type                      TEXT NOT NULL,            -- 'credits' | 'remove_ads'
  amount                    INTEGER NOT NULL,         -- units granted (e.g., credits)
  amount_total              INTEGER NOT NULL,         -- Stripe minor units paid
  currency                  TEXT NOT NULL,
  stripe_session_id         TEXT NOT NULL,
  stripe_payment_intent_id  TEXT,
  livemode                  INTEGER NOT NULL,
  created_at                INTEGER NOT NULL,
  reversed_at               INTEGER,
  reversal_reason           TEXT,
  disputed_at               INTEGER
);

CREATE INDEX IF NOT EXISTS idx_purchase_grants_identity
  ON purchase_grants(identity_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_purchase_grants_payment_intent
  ON purchase_grants(stripe_payment_intent_id);
```

### Client changes

`src/components/BuyCreditsModal.jsx`: replace the hard-coded Payment Link URLs with a call to `/api/stripe/create-session`. On response, redirect `window.location = json.url`.

### Test plan

- Webhook idempotency: replay the same event 3× → only one grant in `purchase_grants`, credits incremented once.
- Forged `client_reference_id`: send a webhook with `client_reference_id: "999:other_char"` but `metadata.identity_id: my_id` → handler throws "mismatch", returns 500, event row deleted (so Stripe retries — but a real attacker can't trigger the webhook without the secret, so this is defence in depth).
- Livemode mismatch: post a test event to prod endpoint → 400.
- `payment_status: 'unpaid'`: returns 200 silently, no grant recorded.
- Refund: send `charge.refunded` after a credit grant → `purchase_grants.reversed_at` set, character credits decremented.

### Rollback

If grants are broken in prod: disable the webhook in Stripe Dashboard, revert the PR, re-enable webhook pointed at the prior version. Already-paid sessions will retry until the rollback is up.

---

## Step 4 — `audit_events` table and wiring

### Goal

Replace `auditLog`'s `console.log` with durable writes so support / accounting / dispute resolution have a record. Required by CLAUDE.md §14.

### Files

- `functions/_lib/game/audit.js` — rewrite
- All current callers of `auditLog` — no signature change needed
- Plus, add new callers in `skip-hour.js`, `slayer/skip.js`, PvP settlement, refund handler

### Migration: `migrations/0017_audit_events.sql`

```sql
CREATE TABLE IF NOT EXISTS audit_events (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  event_type    TEXT NOT NULL,
  identity_id   INTEGER,
  character_id  INTEGER,
  payload_json  TEXT NOT NULL,
  created_at    INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_audit_events_character
  ON audit_events(character_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_events_type_time
  ON audit_events(event_type, created_at DESC);

-- Retention: trim with a scheduled worker if volume grows.
```

### New `audit.js`

```js
// Durable audit log. Fire-and-forget from the caller's perspective, but
// the write is awaited so a D1 outage surfaces as a 500 instead of silent
// data loss. Callers that explicitly cannot afford to fail on audit write
// can pass { swallow: true }; default is to bubble.
export async function auditLog(env, eventType, payload = {}, { swallow = false } = {}) {
  try {
    const identityId  = payload?.identityId  ?? payload?.identity_id  ?? null
    const characterId = payload?.characterId ?? payload?.character_id ?? null
    await env.DB.prepare(
      `INSERT INTO audit_events (event_type, identity_id, character_id, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?)`
    ).bind(eventType, identityId, characterId, JSON.stringify(payload), Date.now()).run()
  } catch (err) {
    console.error('audit_log_failed', eventType, err)
    if (!swallow) throw err
  }
}
```

### Caller update pattern

Every existing call site is currently `auditLog('foo', { ... })`. Change the signature to thread `env`:

```bash
grep -nR "auditLog(" functions/
```

Each call becomes `await auditLog(env, 'foo', { ... })`. The PvP tick engine should pass `{ swallow: true }` for non-terminal events to avoid taking down a match on a transient D1 failure.

Add new audit calls for the events §14 explicitly names:
- `skip-hour.js`: `auditLog(env, 'skip_hour.spent', { identityId, characterId, creditsBefore, creditsAfter })`
- `slayer/skip.js`: `auditLog(env, 'slayer.skip.spent', { ... })`
- Stripe webhook: `auditLog(env, 'purchase.granted', { ... })`, `auditLog(env, 'purchase.reversed', { ... })`
- PvP settlement (`pvp/match/[id]/tick.js` terminal write): `auditLog(env, 'pvp.match.settled', { matchId, winnerCharacterId, loserCharacterId, lootTransfer })`
- Action-completion (`_completeShared.js`): `auditLog(env, 'action.completed', { characterId, sourceType, sourceId, granted })`

### Test plan

- Skip-hour: hit endpoint, assert row in `audit_events`.
- Audit write failure: mock D1 to throw, confirm endpoint returns 500 (default `swallow: false`).
- PvP settlement: a forced match outcome writes one settled row per match.

### Rollback

`audit_events` is additive. Disabling writes = revert PR. The migration can stay.

---

## Step 5 — Lock down `/api/collection-log` POST

### Goal

The collection log is server-authoritative through the action-completion path. The standalone `POST /api/collection-log` is a client backdoor. Remove the write surface.

### Files

- `functions/api/collection-log.js`

### Implementation

Delete `onRequestPost` entirely. Reads stay as-is. If the client currently uses POST to "import" a legacy collection log from a local save, that import becomes a one-time server-side migration — write a separate `POST /api/collection-log/import-legacy` endpoint that:
- Takes a save snapshot,
- Validates each claimed entry against `isValidEntry`,
- Only accepts entries for items the player can prove they own (present in inventory/bank/equipment/known-drops on the save) — i.e., they actually had the item at some point.

For launch, the safest move is to delete `onRequestPost` and have the client stop calling it. Any historical collection-log state already in the DB is preserved. Going forward, every collection-log entry comes from `actionCompletion.js → _completeShared.js → recordCollectionLog`.

### Audit step (client)

```bash
grep -nR "collection-log" src/
```

If the client posts to this endpoint anywhere, remove the call.

### Test plan

```js
it('POST /api/collection-log returns 404 / 405', async () => { /* ... */ })
it('action completion still writes collection log entries', async () => { /* ... */ })
```

### Rollback

If you need to restore the import path later, build the validated import endpoint described above. The current POST should not return.

---

## Step 6 — Action nonces in DB

### Goal

`_serverActionNonces` lives in the save blob today. Once step 1 lands, the client can no longer erase nonces via `/api/save`, but the in-blob storage still bloats the save and makes nonce dedup an in-memory check rather than a true uniqueness guarantee. Move nonces to their own table for clarity and to enable replay defence independent of save state.

### Files

- `functions/_lib/game/actionCompletion.js` — `assertNonce` becomes async + takes `env`
- Every caller of `settleActionCompletion` — pass `env` through
- New: `functions/_lib/game/nonces.js`

### Migration: `migrations/0018_action_nonces.sql`

```sql
CREATE TABLE IF NOT EXISTS action_nonces (
  character_id  INTEGER NOT NULL,
  nonce         TEXT    NOT NULL,
  used_at       INTEGER NOT NULL,
  PRIMARY KEY (character_id, nonce)
);

-- Retention: trim nonces older than 30 days via a scheduled worker.
-- A replayed action older than 30 days that escaped its original save would
-- still be caught by save_revision; this is just storage hygiene.
CREATE INDEX IF NOT EXISTS idx_action_nonces_age
  ON action_nonces(used_at);
```

### `functions/_lib/game/nonces.js`

```js
import { GameApiError } from './errors.js'

export async function claimNonce(env, characterId, nonce) {
  if (!nonce || typeof nonce !== 'string') {
    throw new GameApiError('INVALID_NONCE', 'Invalid action nonce', 400)
  }
  // Trim absurd nonces to avoid storage abuse.
  if (nonce.length > 128) {
    throw new GameApiError('INVALID_NONCE', 'Nonce too long', 400)
  }
  const res = await env.DB.prepare(
    `INSERT INTO action_nonces (character_id, nonce, used_at)
     VALUES (?, ?, ?)
     ON CONFLICT(character_id, nonce) DO NOTHING`
  ).bind(characterId, nonce, Date.now()).run()
  if (!res?.meta?.changes) {
    throw new GameApiError('STALE_REPLAYED_ACTION', 'stale_replayed_action', 409)
  }
}
```

### Refactor `settleActionCompletion`

```js
// was: function assertNonce(saveObject, nonce) { ... touches saveObject._serverActionNonces ... }
// now: caller claims the nonce in DB BEFORE settleActionCompletion runs.

// In _completeShared.js (and every other caller):
await claimNonce(env, characterId, body.nonce)  // throws 409 on replay
const result = settleActionCompletion(saveObject, { sourceType, sourceId, rewards, ... })
// Note: nonce arg dropped from settleActionCompletion's body.
```

`settleActionCompletion` no longer touches `saveObject._serverActionNonces`. Delete the `assertNonce` helper.

### Migration of in-flight nonces

Existing saves have nonces under `_serverActionNonces`. On first read, copy any nonces from the save into `action_nonces` (best-effort) and then strip the field. One-shot migration in `_lib/game/save.js`'s `loadCharacterWithSave`:

```js
// One-time migration: lift in-blob nonces into the action_nonces table.
// Runs idempotently because of the PK conflict.
if (saveObject?._serverActionNonces && Object.keys(saveObject._serverActionNonces).length) {
  const stmts = Object.entries(saveObject._serverActionNonces).map(([nonce, usedAt]) =>
    env.DB.prepare(
      `INSERT INTO action_nonces (character_id, nonce, used_at)
       VALUES (?, ?, ?)
       ON CONFLICT DO NOTHING`
    ).bind(characterId, nonce, Number(usedAt) || Date.now())
  )
  if (stmts.length) await env.DB.batch(stmts)
  delete saveObject._serverActionNonces
}
```

### Test plan

- Submit the same nonce twice in quick succession → second returns 409.
- Submit one nonce for character A, replay the same string for character B → both succeed (PK is composite).
- Action completion no longer mutates `_serverActionNonces` on the save.
- Migration: a save with pre-existing nonces gets them lifted into `action_nonces` and stripped.

### Rollback

If issues: revert PR. The migration table is additive. The save will still have `_serverActionNonces` for in-flight characters because the strip happens after the lift; rollback path retains the old behaviour. Acceptable.

---

## Step 7 — Make `save_revision` mandatory

### Goal

Today, `functions/api/save.js:82,94` only enforces `save_revision` when the client supplies a finite value. A client that omits it passes through. Make it required.

### Files

- `functions/api/save.js`
- `src/cloud/sync.js` — confirm the client always sends `save_revision`

### Implementation

In `onRequestPut`:

```js
// Replace:
//   const expectedSaveRevision = Number.isFinite(body?.save_revision)
//     ? body.save_revision : parseInt(body?.save_revision, 10)
// With:
const expectedSaveRevision = Number.isFinite(body?.save_revision)
  ? body.save_revision
  : parseInt(body?.save_revision, 10)
if (!Number.isFinite(expectedSaveRevision) || expectedSaveRevision < 0) {
  return json({ error: 'save_revision_required', code: 'SAVE_REVISION_REQUIRED' }, 400)
}

const existing = await env.DB.prepare(
  'SELECT save_data, save_blob, save_revision FROM saves WHERE character_id = ?'
).bind(ch.id).first()
const currentRevision = Number(existing?.save_revision) || 0
if (expectedSaveRevision !== currentRevision) {
  return json({
    error: 'save_revision_conflict',
    code: 'SAVE_REVISION_CONFLICT',
    current_revision: currentRevision
  }, 409)
}
```

Apply the same change in `_lib/game/save.js`'s `writeSave` — drop the `expectedRevision == null` branch entirely:

```js
export async function writeSave(env, characterId, saveObject, expectedRevision) {
  if (!Number.isFinite(expectedRevision) || expectedRevision < 0) {
    throw new GameApiError('SAVE_REVISION_REQUIRED', 'save_revision_required', 400)
  }
  // ... only the CAS path remains.
}
```

**First-save edge case**: a brand-new character has no row in `saves`. The action endpoints handle this today via the `INSERT … ON CONFLICT` path. To preserve that, allow `expectedRevision === 0` to insert if no row exists:

```js
// In writeSave, the CAS UPDATE handles existing rows. For the first save:
if (expectedRevision === 0) {
  const insertRes = await env.DB.prepare(
    `INSERT INTO saves (character_id, save_blob, save_data, updated_at, save_revision)
     VALUES (?, ?, ?, ?, 1)
     ON CONFLICT(character_id) DO NOTHING`
  ).bind(characterId, save_blob, save_data, now).run()
  if (insertRes?.meta?.changes) {
    return { updatedAt: now, saveRevision: 1 }
  }
  // Row existed — fall through to CAS update path with expectedRevision=0
  // which will 409 correctly.
}
// CAS UPDATE path ...
```

### Client changes

`src/cloud/sync.js`: every `/api/save` call must include `save_revision`. The local persistence layer already tracks the last revision returned by the server; thread it into the request body.

```bash
grep -nR "save_revision\|cloudPushSave\|/api/save" src/
```

Audit every call site and confirm `save_revision` is wired through.

### Test plan

- PUT `/api/save` without `save_revision` → 400.
- PUT with stale `save_revision` → 409 with `current_revision` in body.
- PUT with current `save_revision` → 200, returns new revision.
- First-ever save (no row): PUT with `save_revision: 0` → 200, row inserted at revision 1.
- Two-tab simulation: tab A saves successfully, tab B sends prior revision → 409, client refetches and merges.

### Rollback

Code-only. Revert.

---

## Acceptance checklist before flipping live Stripe key

Run through this list. **All items must be green** before enabling live Stripe.

- [ ] Step 1 shipped and verified: external attempt to PUT a save with inflated coins/XP is rejected/ignored (tested with curl).
- [ ] Step 2 shipped: load test with 10 concurrent buyers on one resting offer; exactly the available stock is delivered in total.
- [ ] Step 3 shipped: `/api/stripe/create-session` works end-to-end with the live key (or test-mode equivalent). Old payment-link URLs return 404 / removed.
- [ ] Step 3 shipped: webhook event replay test — same event sent 3× → 1 grant.
- [ ] Step 3 shipped: refund test in Stripe Dashboard → credits decremented, `purchase_grants.reversed_at` set.
- [ ] Step 4 shipped: `audit_events` has rows for skip-hour, slayer-skip, purchase grant, PvP settlement, action completion after a sanity playtest.
- [ ] Step 5 shipped: `POST /api/collection-log` returns 404/405. Action-completion still records the log.
- [ ] Step 6 shipped: replay an action with a previously-used nonce → 409. New characters create nonces without `_serverActionNonces` in their save.
- [ ] Step 7 shipped: PUT `/api/save` without `save_revision` → 400.
- [ ] All migrations applied to prod D1 (`wrangler d1 migrations apply pocketrpg`).
- [ ] Cloudflare Pages secrets set: `STRIPE_API_KEY` (live), `STRIPE_WEBHOOK_SECRET` (live), `JWT_SECRET` (≥32 bytes).
- [ ] Cloudflare WAF rate limits configured on `/api/auth/*`, `/api/save`, `/api/idle`, `/api/trading-post/*`.
- [ ] `wrangler.toml` documents the new `STRIPE_API_KEY` secret; the `STRIPE_PAYMENT_LINK_*` lines are removed.
- [ ] Vitest suite passes (`npm run ci && npm test`).
- [ ] Manual smoke test from a clean browser: sign in, buy 10 credits via test card, skip-hour spends a credit, refund the test charge, observe credits decremented.

---

## Out of scope here, but track in a follow-up issue

These are the remaining P1 items that should land in the first patch week but don't gate launch:

- JWT delivered as HttpOnly cookie instead of localStorage (mitigates XSS token theft).
- Session revocation: `oauth_identities.token_version` + verify-time check.
- Email verification for OAuth identities.
- Forfeit-vs-abort race in PvP (route forfeit through immediate terminal write).
- `_headers` file with `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, frame-ancestors deny.
- Bundle Tailwind output instead of `cdn.tailwindcss.com`.
- D1 backup runbook (Time Travel) documented in `README.md`.
- `npm run migrate` script wired to `wrangler d1 migrations apply`.
- Boot-check `/api/health` that 500s on missing required env vars at deploy time, not first user.
