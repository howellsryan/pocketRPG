// Cloud-authoritative minigame completion.
//
// Why this lives in its own module:
// - PR #480 inlined the completion flow into App.jsx five times and shipped a
//   race condition where requestCriticalPushSave fired a /api/save before
//   /api/actions/minigame/complete returned, letting the client save overwrite
//   the server's authoritative unlocks. Consolidating the flow here:
//   1) makes the ordering invariant easy to read and test, and
//   2) ensures any future fix only has to be made in one place.
//
// Invariants:
// - Cloud branch never POSTs /api/save before /api/actions/minigame/complete.
// - actionNonce is stable per task instance (derived from taskWrapper.startedAt)
//   so retries and idle-resume re-fires are deduped server-side.
// - On STALE_REPLAYED_ACTION (server already processed the nonce), pull the
//   authoritative save and treat as success.

const PRE_COMPLETE_SAVE_BANNED = true // documents intent; not used at runtime

export async function completeMinigameTask({ task, taskWrapper, deps }) {
  const {
    isCloudAuthoritative,
    api,
    applyCloudSave,
    loadGame,
    pullSave,
    applyServerCollectionLogEntries,
    setActiveTask,
    activeTaskRef,
    removeLocalActiveTask,
    grantMinigameTaskRewards,
    requestCriticalPushSave,
    getSnapshot,
    addToast,
    isInPvpMatch,
    inFlightSet,
    onWarn,
  } = deps

  const instanceId = `${task?.id ?? 'unknown'}:${taskWrapper?.startedAt ?? 'fallback'}`
  if (inFlightSet && inFlightSet.has(instanceId)) return { status: 'dedup' }
  if (inFlightSet) inFlightSet.add(instanceId)

  // Clear React state synchronously so the tick loop / UI move on. The
  // dedupe set above prevents the same instance from being re-scheduled
  // while /complete is awaiting.
  setActiveTask(null)
  if (activeTaskRef) activeTaskRef.current = null

  try {
    if (isCloudAuthoritative(task)) {
      return await runCloudCompletion({
        task,
        taskWrapper,
        api,
        applyCloudSave,
        loadGame,
        pullSave,
        applyServerCollectionLogEntries,
        removeLocalActiveTask,
        addToast,
        onWarn,
      })
    }

    grantMinigameTaskRewards(task)
    removeLocalActiveTask()
    if (!isInPvpMatch && requestCriticalPushSave) {
      requestCriticalPushSave(getSnapshot, 'minigame_complete')
    }
    return { status: 'success-local' }
  } finally {
    if (inFlightSet) inFlightSet.delete(instanceId)
  }
}

async function runCloudCompletion({
  task,
  taskWrapper,
  api,
  applyCloudSave,
  loadGame,
  pullSave,
  applyServerCollectionLogEntries,
  removeLocalActiveTask,
  addToast,
  onWarn,
}) {
  const nonce = buildMinigameNonce(task, taskWrapper)
  try {
    const res = await api.completeMinigame(task.id, { actionNonce: nonce })
    if (res?.save?.save_data) {
      await applyCloudSave(JSON.parse(res.save.save_data), res.save.updatedAt)
      await loadGame()
    }
    if (Array.isArray(res?.collectionLogEntries) && res.collectionLogEntries.length > 0 && applyServerCollectionLogEntries) {
      applyServerCollectionLogEntries(res.collectionLogEntries)
    }
    removeLocalActiveTask()
    return { status: 'success', granted: res?.granted || [] }
  } catch (err) {
    if (err?.status === 409 && err?.body?.code === 'STALE_REPLAYED_ACTION') {
      // Server already granted this nonce — pull authoritative save and clear local task.
      try {
        const pulled = await pullSave?.()
        if (pulled?.payload) {
          await applyCloudSave(pulled.payload, pulled.updatedAt)
          await loadGame()
        }
      } catch (e) {
        onWarn?.(`[PocketRPG] post-dedupe pull failed: ${e?.message || e}`)
      }
      removeLocalActiveTask()
      return { status: 'success-deduped' }
    }
    onWarn?.(`[PocketRPG] minigame sync failed: ${err?.message || err}`)
    addToast?.(
      `Couldn't sync ${task?.name || 'minigame'} completion — will retry on next load.`,
      'error',
      '⚠️'
    )
    // Leave localStorage activeTask in place so idle-resume retries with the
    // same stable nonce next time the app loads.
    return { status: 'failed', err }
  }
}

export function buildMinigameNonce(task, taskWrapper) {
  return `minigame:${task?.id ?? 'unknown'}:${taskWrapper?.startedAt ?? 'unknown'}`
}

export { PRE_COMPLETE_SAVE_BANNED }
