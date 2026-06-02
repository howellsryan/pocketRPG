import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { callHandler } from "./api-bridge";
import type { Env, Props, Identity } from "./types";

// Reuse the exact production endpoint handlers (see api-bridge.ts).
import { onRequestGet as listCharacters } from "../../functions/api/characters/index.js";
import { onRequestGet as getMe } from "../../functions/api/auth/me.js";
import { onRequestGet as getSave } from "../../functions/api/save.js";
import { onRequestGet as getCollectionLog } from "../../functions/api/collection-log.js";
import { onRequestGet as getKillCounts } from "../../functions/api/kill-counts.js";
import { onRequestGet as getLeaderboard } from "../../functions/api/leaderboard.js";
import { onRequestPost as postPurchase } from "../../functions/api/purchase.js";
import { onRequestPost as postSkipHour } from "../../functions/api/skip-hour.js";
import { onRequestPost as postSlayerSkip } from "../../functions/api/slayer/skip.js";

import { getLevelFromXP } from "../../src/engine/experience.js";

function ok(payload: unknown) {
  const text = typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
  return { content: [{ type: "text" as const, text }] };
}

function fail(message: string) {
  return { content: [{ type: "text" as const, text: `Error: ${message}` }], isError: true };
}

// Most write tools target a single character. If the account has exactly one
// character we auto-select it; otherwise the caller must pass character_id.
async function resolveCharacterId(
  env: Env,
  identity: Identity,
  provided?: number,
): Promise<number> {
  const res = await callHandler(listCharacters, env, { identity });
  const characters: any[] = res.data?.characters || [];
  if (provided !== undefined && provided !== null) {
    const match = characters.find((c) => Number(c.id) === Number(provided));
    if (!match) throw new Error(`Character ${provided} not found on this account.`);
    return Number(match.id);
  }
  if (characters.length === 0) {
    throw new Error("This account has no characters. Create one in the PocketRPG app first.");
  }
  if (characters.length === 1) return Number(characters[0].id);
  const list = characters.map((c) => `${c.id} (${c.username})`).join(", ");
  throw new Error(`Multiple characters found — pass character_id. Options: ${list}`);
}

// Compresses the (potentially large) raw save blob into a model-friendly view.
function summarizeSave(saveData: string) {
  const state = JSON.parse(saveData);
  const skills: Record<string, { level: number; xp: number }> = {};
  for (const [name, s] of Object.entries<any>(state.stats || {})) {
    const xp = Number(s?.xp || 0);
    skills[name] = { level: getLevelFromXP(xp), xp };
  }
  const inventory = (state.inventory || [])
    .filter(Boolean)
    .map((slot: any) => ({ itemId: slot.itemId ?? slot.id, quantity: slot.quantity ?? 1, noted: !!slot.noted }));
  const equipment: Record<string, unknown> = {};
  for (const [slot, item] of Object.entries<any>(state.equipment || {})) {
    if (item) equipment[slot] = { itemId: item.itemId ?? item.id, quantity: item.quantity ?? 1 };
  }
  return {
    coins: state.coins ?? 0,
    combatStance: state.settings?.combatStance ?? null,
    currentHP: state.player?.currentHP ?? null,
    prayerPoints: state.player?.prayer ?? null,
    skills,
    equipment,
    inventory,
    inventoryUsed: inventory.length,
    inventoryCapacity: 28,
    bankUniqueItems: state.bank ? Object.keys(state.bank).length : 0,
  };
}

export class PocketRpgMCP extends McpAgent<Env, unknown, Props> {
  server = new McpServer({
    name: "PocketRPG",
    version: "0.1.0",
  });

  private identity(): Identity {
    return {
      id: this.props.identityId,
      provider: this.props.provider,
      displayName: this.props.displayName,
    };
  }

  async init() {
    const env = () => this.env as Env;
    const me = () => this.identity();

    // ---- Read tools -------------------------------------------------------

    this.server.tool(
      "list_characters",
      "List the characters on the signed-in PocketRPG account (id, username, ironman/one-life flags, last save time). Use the id with the other tools.",
      {},
      async () => {
        const res = await callHandler(listCharacters, env(), { identity: me() });
        if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
        return ok(res.data);
      },
    );

    this.server.tool(
      "get_account",
      "Get the signed-in account identity and, if a character is given, that character's credit balance and PvP kill total.",
      { character_id: z.number().int().optional() },
      async ({ character_id }) => {
        const res = await callHandler(getMe, env(), { identity: me(), characterId: character_id });
        if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
        return ok(res.data);
      },
    );

    this.server.tool(
      "get_character_state",
      "Get a summary of a character's current game state: coins, skill levels + XP, current HP, worn equipment, inventory contents, and bank size. Auto-selects the character if the account has only one.",
      { character_id: z.number().int().optional() },
      async ({ character_id }) => {
        try {
          const id = await resolveCharacterId(env(), me(), character_id);
          const res = await callHandler(getSave, env(), { identity: me(), characterId: id });
          if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
          if (!res.data?.save?.save_data) return ok({ characterId: id, state: null, note: "No save yet." });
          return ok({ characterId: id, savedAt: res.data.save.updatedAt, ...summarizeSave(res.data.save.save_data) });
        } catch (err: any) {
          return fail(err?.message || String(err));
        }
      },
    );

    this.server.tool(
      "get_collection_log",
      "List the unique items a character has obtained (boss/raid/clue/minigame uniques) and the total number of slots in the log.",
      { character_id: z.number().int().optional() },
      async ({ character_id }) => {
        try {
          const id = await resolveCharacterId(env(), me(), character_id);
          const res = await callHandler(getCollectionLog, env(), { identity: me(), characterId: id });
          if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
          return ok({ characterId: id, ...res.data });
        } catch (err: any) {
          return fail(err?.message || String(err));
        }
      },
    );

    this.server.tool(
      "get_kill_counts",
      "List a character's server-authoritative boss/raid kill counts.",
      { character_id: z.number().int().optional() },
      async ({ character_id }) => {
        try {
          const id = await resolveCharacterId(env(), me(), character_id);
          const res = await callHandler(getKillCounts, env(), { identity: me(), characterId: id });
          if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
          return ok({ characterId: id, ...res.data });
        } catch (err: any) {
          return fail(err?.message || String(err));
        }
      },
    );

    this.server.tool(
      "get_leaderboard",
      "Get the public leaderboard. metric 'total' ranks by total level; metric 'kc' ranks killers of a specific boss/raid (requires source_type + source_id).",
      {
        metric: z.enum(["total", "kc"]).optional(),
        source_type: z.string().optional(),
        source_id: z.string().optional(),
        limit: z.number().int().min(1).max(200).optional(),
        offset: z.number().int().min(0).optional(),
      },
      async ({ metric, source_type, source_id, limit, offset }) => {
        // Public endpoint — no identity required.
        const res = await callHandler(getLeaderboard, env(), {
          query: { metric, source_type, source_id, limit, offset },
        });
        if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
        return ok(res.data);
      },
    );

    // ---- Server-authoritative write tools --------------------------------

    this.server.tool(
      "buy_item",
      "Buy an item from the in-game shop for a character. Debits coins and grants the item server-side (same path as the game's shop). Returns remaining coins. Blocked while the character is in an active PvP match.",
      {
        item_id: z.string().describe("The item id, e.g. 'bronze_dagger'."),
        quantity: z.number().int().min(1).default(1),
        character_id: z.number().int().optional(),
      },
      async ({ item_id, quantity, character_id }) => {
        try {
          const id = await resolveCharacterId(env(), me(), character_id);
          const res = await callHandler(postPurchase, env(), {
            method: "POST",
            identity: me(),
            characterId: id,
            body: { item_id, quantity, unlocked_minigame_items: [] },
          });
          if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
          return ok({ characterId: id, ...res.data });
        } catch (err: any) {
          return fail(err?.message || String(err));
        }
      },
    );

    this.server.tool(
      "skip_hour",
      "Spend credits to skip ahead. With no boss/raid id this is a 1-credit one-hour skip; a bossId or raidId charges that target's skip cost. Debits credits server-side and returns the remaining balance.",
      {
        bossId: z.string().optional(),
        raidId: z.string().optional(),
        character_id: z.number().int().optional(),
      },
      async ({ bossId, raidId, character_id }) => {
        try {
          const id = await resolveCharacterId(env(), me(), character_id);
          const res = await callHandler(postSkipHour, env(), {
            method: "POST",
            identity: me(),
            characterId: id,
            body: { bossId, raidId },
          });
          if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
          return ok({ characterId: id, ...res.data });
        } catch (err: any) {
          return fail(err?.message || String(err));
        }
      },
    );

    this.server.tool(
      "skip_slayer_task",
      "Spend 1 credit to skip the character's current slayer task. Debits the credit server-side and returns the remaining balance.",
      { character_id: z.number().int().optional() },
      async ({ character_id }) => {
        try {
          const id = await resolveCharacterId(env(), me(), character_id);
          const res = await callHandler(postSlayerSkip, env(), {
            method: "POST",
            identity: me(),
            characterId: id,
          });
          if (!res.ok) return fail(res.data?.error || `HTTP ${res.status}`);
          return ok({ characterId: id, ...res.data });
        } catch (err: any) {
          return fail(err?.message || String(err));
        }
      },
    );
  }
}
