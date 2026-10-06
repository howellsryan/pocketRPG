import { useEffect, useRef, useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { api } from '../cloud/api.js'
import { openWorld } from '../utils/helpers.js'
import WorldEntryCard from './WorldEntryCard.jsx'

export default function WorldEntryButton({ className = '' }) {
  const { runLockedSave, addToast } = useGame()
  const entering = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    const restored = event => {
      if (!event.persisted) return
      entering.current = false
      setBusy(false)
      setError('')
    }
    window.addEventListener('pageshow', restored)
    return () => window.removeEventListener('pageshow', restored)
  }, [])
  const enter = async () => {
    if (entering.current) return
    entering.current = true
    setBusy(true)
    setError('')
    try {
      await openWorld(api, undefined, { sameTab: true, beforeEnter: runLockedSave })
    } catch (failure) {
      const message = failure?.message || 'Could not enter the world. Please try again.'
      setError(message)
      addToast(message, 'error')
      entering.current = false
      setBusy(false)
    }
  }
  return <WorldEntryCard className={className} busy={busy} error={error} enter={enter} />
}
