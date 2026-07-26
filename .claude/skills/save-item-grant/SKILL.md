---
name: save-item-grant
description: Use when asked to add, grant, or inject an item into a specific character's cloud save / inventory by editing the D1 saves table directly (prod or preview) - manual support grants, compensation, reproducing a bug with specific gear. Covers scripts/grant-save-item.mjs, the confirmation steps, and the save-lock and revision rules that make the write safe. Do not use for in-game item sources (drops, shops, crafting) - that is the add-content skill.
---

# save-item-grant: hand-edit an item into a character's save

`saves.save_blob` is gzipped JSON, not encrypted. `scripts/grant-save-item.mjs` reads that row through wrangler, gunzips it, appends to `save.inventory` **only**, re-gzips and writes it back under a `save_revision` guard.

## Run it

```bash
node scripts/grant-save-item.mjs                       # asks for everything
node scripts/grant-save-item.mjs --env preview --character 12 --item dragon_scimitar --qty 1
node scripts/grant-save-item.mjs --env prod --character 12 --item "Abyssal Whip" --dry-run
```

| Flag | Meaning |
|---|---|
| `--env prod\|preview` | picks the D1 database (`pocketrpg` / `pocketrpg-preview`) |
| `--character <id>` | `characters.id` — **always** confirm this with the requester |
| `--item <id\|name>` | item id, legacy id, or name; ambiguity aborts with candidates |
| `--qty <n>` | default 1 |
| `--noted` | add as a noted stack |
| `--dry-run` | decode, resolve, show the change, write nothing |
| `--yes` | skips the prompt on **preview only**; production always asks |
| `--no-backup` | skip the pre-change snapshot (don't) |

Auth: `wrangler login`, or `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID`.

## Before you run it

1. **Get the character id from the user.** A player name is not an id; guessing writes to a stranger's save.
2. **Confirm the item with the user by name AND id.** The script prints both plus type/stackability and makes you retype `grant <item_id>` on production for exactly this reason — don't type it on their behalf without them having named the id.
3. **Prefer `--env preview` first** when the grant is testable there.
4. Run `--dry-run` when you are unsure; it decodes and reports without writing.

## What the script guarantees (don't work around these)

- **Append, never overwrite.** Only `save.inventory` is touched, and stackables merge onto an existing slot. The script re-parses both JSONs and aborts if any field outside `inventory` differs.
- **28-slot cap is hard.** A grant that doesn't fit aborts rather than dropping items. Bank it manually, or wait for a free slot.
- **Revision guard.** The `UPDATE` carries `WHERE save_revision = <the revision we read>`. If the player saved in between, zero rows match and the script aborts — rerun it.
- **Save locks abort the run.** Active PvP match, co-op boss session, or live open-world session all own the save (CLAUDE.md §14/§20). Writing under any of them loses one side's changes.
- **Backup.** The pre-change save JSON lands in `.save-backups/` (gitignored — it is real player data; don't paste it into chat or a PR).
- **Verification.** After writing it re-reads the row, gunzips it and checks the item count actually moved.

## Afterwards

Tell the player to reload the game. The revision bump means their open tab's next push is rejected as stale, and the client pulls the new save.

## Or over HTTP: `POST /api/admin/grant-item`

Same guarantees (item resolution, three save locks, revision guard), no wrangler needed, and it can target the **bank** as well as the inventory. Admin auth is the `MAINTENANCE_SECRET` — a session JWT grants nothing.

```bash
curl -X POST https://<host>/api/admin/grant-item \
  -H "X-Maintenance-Secret: $MAINTENANCE_SECRET" -H 'Content-Type: application/json' \
  -d '{"character_id":12,"item_id":"dragon_scimitar","quantity":1,"destination":"inventory","dry_run":true}'
```

Body: `character_id`, `item_id` (id or legacy id — not a name), `quantity` (1…1e9, default 1), `destination` `inventory`|`bank` (default inventory), `noted`, `dry_run`, `reason` (audited). Non-stackables take one slot per copy and 409 `INVENTORY_FULL` if they don't fit — use `noted` or `destination:"bank"`. Every grant writes an `admin_item_grant` audit row. Handler: `functions/api/admin/grant-item.js`, tests `tests/adminGrantItem.test.ts`.

## Limits

- The script is inventory only. Bank grants need the endpoint above; equipment, XP and credits are deliberately out of scope for both — credits in particular are server-authoritative (§14) and must not be hand-edited into a save.
- Charged weapons land with no `charges`. Set them through normal play.
- Pure logic lives in `scripts/lib/saveItemGrant.mjs`, covered by `tests/saveItemGrant.test.ts`. Change the insert semantics there and update the test in the same edit.
