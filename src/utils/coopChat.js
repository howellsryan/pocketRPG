// Turns a co-op room's broadcast events into the lines the chat panel renders.
// Two event types share the log deliberately: a purple drop is news the whole
// group is meant to react to, so it lands in the same place they are already
// talking rather than in a banner nobody looks at mid-fight.

export const COOP_CHAT_LOG_MAX = 60

/** Ids come from a caller-held counter rather than the tick, because two
 * messages can land on the same tick and a keyed list needs them distinct. */
export function chatLinesFromCoopEvents(events, nextId = 0) {
  const lines = []
  let id = nextId
  for (const ev of events || []) {
    if (ev?.type === 'chatMessage') {
      if (!ev.text) continue
      lines.push({ id: `c${id++}`, kind: 'chat', username: ev.username || 'Someone', text: String(ev.text) })
    } else if (ev?.type === 'epicDrop') {
      if (!ev.item) continue
      const who = ev.username || 'Someone'
      lines.push({
        id: `c${id++}`,
        kind: 'drop',
        username: who,
        text: `\u{1F49C} ${who} received ${ev.item}${ev.monster ? ` from ${ev.monster}` : ''}!`,
      })
    }
  }
  return { lines, nextId: id }
}

export function appendChatLines(log, lines, max = COOP_CHAT_LOG_MAX) {
  if (!lines || lines.length === 0) return log
  const next = [...(log || []), ...lines]
  return next.length > max ? next.slice(-max) : next
}
