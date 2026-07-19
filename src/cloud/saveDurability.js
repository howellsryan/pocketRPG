// Guard for any client action that calls a server endpoint which
// loads-mutates-returns the whole save blob (e.g. /api/purchase) and then has
// the client adopt the server's copy back into local state (pullSave →
// applyCloudSave). If the client's latest save hasn't landed durably on the
// server first, that round-trip overwrites unsynced client-trusted progress —
// most visibly a just-completed quest, leaving the player owning gear they can
// no longer equip. Push, and report whether it confirmed durability so the
// caller can abort instead of clobbering.
//
// `pushFn` is the durable-push function (cloud sync's pushNow); it resolves
// `true` only when local state is durably on the server (including the "already
// synced, nothing to send" case) and `false`/throws otherwise.
export async function ensureSaveDurable(pushFn, snapshot) {
  try {
    return (await pushFn(snapshot)) === true
  } catch {
    return false
  }
}
