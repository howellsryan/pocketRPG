import { useState, useEffect, useRef } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import SkillIcon from '../components/SkillIcon.jsx'
import GameIcon from '../components/GameIcon.jsx'
import Modal from '../components/Modal.jsx'
import SkillScreenHeader from '../components/SkillScreenHeader.jsx'
import SkillActionRow from '../components/SkillActionRow.jsx'
import SkillActivePanel from '../components/SkillActivePanel.jsx'
import { getLevelFromXP } from '../engine/experience.js'
import { createSkillingState, processSkillingTick } from '../engine/skilling.js'
import { countItem, removeItem } from '../engine/inventory.js'
import { hasRequiredRunes, getRunesToConsume, getEquippedElementalStaff } from '../engine/runes.js'
import { onTick } from '../engine/tick.js'
import { markScreenTick } from '../engine/activityRunner.js'
import { formatNumber } from '../utils/helpers.js'
import { formatActionDuration } from '../utils/formatters.js'
import { SCREENS } from '../utils/constants.js'
import skillsData from '../data/skills.json'
import itemsData from '../data/items.json'

const ACTION_GROUPS = [
  { key: 'utility_spell', label: 'Utility Spells' },
  { key: 'alchemy', label: 'Alchemy' },
  { key: 'superheat', label: 'Superheat' },
  { key: 'enchant_jewel', label: 'Enchant Jewellery' },
  { key: 'enchant_bolts', label: 'Enchant Bolts' },
  { key: 'tan_leather', label: 'Utility' },
  { key: 'plank_make', label: 'Utility' },
]

function getGroupLabel(type) {
  const entry = ACTION_GROUPS.find(g => g.key === type)
  return entry ? entry.label : 'Other'
}

function groupActions(actions) {
  const groups = []
  const seen = new Set()
  for (const g of ACTION_GROUPS) {
    if (seen.has(g.label)) continue
    const matching = actions.filter(a => getGroupLabel(a.type) === g.label)
    if (matching.length > 0) {
      groups.push({ label: g.label, actions: matching })
      seen.add(g.label)
    }
  }
  return groups
}

export default function MagicScreen({ onBack, onNavigate }) {
  const {
    stats, inventory, bank, equipment,
    grantXP, updateInventory, updateBankDirect, addToast, setActiveTask
  } = useGame()

  const magicLevel = getLevelFromXP(stats.magic?.xp || 0)
  const allActions = (skillsData.magic?.actions || []).slice().sort((a, b) => a.level - b.level)

  const [skilling, setSkilling] = useState(null)
  const [showAlchemyPicker, setShowAlchemyPicker] = useState(false)
  const [selectedAlchemyItem, setSelectedAlchemyItem] = useState(null)
  const [pendingAlchemyAction, setPendingAlchemyAction] = useState(null)
  const skillingRef = useRef(null)
  const inventoryRef = useRef(inventory)
  const bankRef = useRef(bank)
  const equipmentRef = useRef(equipment)
  const selectedAlchemyItemRef = useRef(null)

  useEffect(() => { inventoryRef.current = inventory }, [inventory])
  useEffect(() => { bankRef.current = bank }, [bank])
  useEffect(() => { equipmentRef.current = equipment }, [equipment])
  useEffect(() => { selectedAlchemyItemRef.current = selectedAlchemyItem }, [selectedAlchemyItem])

  const handleBack = () => {
    if (onBack) onBack()
    else if (onNavigate) onNavigate(SCREENS.SKILLS)
  }

  const startSpell = (action, alchemyItem) => {
    const state = { ...createSkillingState('magic', action), startedAt: Date.now() }
    setSkilling(state)
    skillingRef.current = state
    const task = { type: 'skill', skill: 'magic', action, bankingEnabled: true }
    if (alchemyItem) task.selectedAlchemyItem = alchemyItem
    setActiveTask(task)
    markScreenTick()
  }

  const handleActionClick = (action) => {
    if (action.type === 'alchemy') {
      setPendingAlchemyAction(action)
      setShowAlchemyPicker(true)
      return
    }
    startSpell(action, null)
  }

  const handleAlchemyPick = (slot) => {
    setShowAlchemyPicker(false)
    setSelectedAlchemyItem(slot)
    selectedAlchemyItemRef.current = slot
    startSpell(pendingAlchemyAction, slot)
    setPendingAlchemyAction(null)
  }

  const stopSpell = () => {
    if (skillingRef.current) {
      skillingRef.current = { ...skillingRef.current, active: false, stopped: true }
    }
    setSkilling(null)
    setSelectedAlchemyItem(null)
    selectedAlchemyItemRef.current = null
    setActiveTask(null)
  }

  useEffect(() => {
    if (!skilling || !skilling.active) return
    skillingRef.current = skilling

    const unsub = onTick(() => {
      const state = skillingRef.current
      if (!state || !state.active || state.stopped) return
      markScreenTick()

      const { skillingState, events } = processSkillingTick(state)
      skillingRef.current = skillingState

      for (const ev of events) {
        if (ev.type === 'actionComplete') {
          const action = ev.action
          const newInv = [...inventoryRef.current]

          if (!hasRequiredRunes(action.runeReq, newInv, bankRef.current, equipmentRef.current, itemsData)) {
            skillingRef.current = { ...skillingState, active: false, stopped: true }
            setSkilling(null)
            setSelectedAlchemyItem(null)
            selectedAlchemyItemRef.current = null
            setActiveTask(null)
            addToast('Out of runes!', 'error')
            return
          }

          const runesToConsume = getRunesToConsume(action.runeReq, equipmentRef.current, itemsData)
          const runesBankUpdates = {}
          for (const [runeId, qty] of Object.entries(runesToConsume)) {
            const invCount = countItem(newInv, runeId)
            const fromInv = Math.min(invCount, qty)
            const fromBank = qty - fromInv
            if (fromInv > 0) removeItem(newInv, runeId, fromInv)
            if (fromBank > 0) runesBankUpdates[runeId] = -fromBank
          }
          if (Object.keys(runesBankUpdates).length > 0) updateBankDirect(runesBankUpdates)

          if (action.type === 'alchemy') {
            const alchSlot = selectedAlchemyItemRef.current
            if (alchSlot) {
              const alchItem = itemsData[alchSlot.itemId]
              const slotIdx = newInv.findIndex(s =>
                s?.itemId === alchSlot.itemId &&
                !!s?.noted === !!alchSlot.noted &&
                (s?.quantity || 0) > 0
              )
              if (slotIdx === -1) {
                skillingRef.current = { ...skillingState, active: false, stopped: true }
                setSkilling(null)
                setSelectedAlchemyItem(null)
                selectedAlchemyItemRef.current = null
                setActiveTask(null)
                addToast('Out of items to alchemize!', 'error')
                return
              }
              const alchValue = Math.floor((alchItem?.shopValue || 0) * 1.1)
              if (newInv[slotIdx].quantity > 1) {
                newInv[slotIdx] = { ...newInv[slotIdx], quantity: newInv[slotIdx].quantity - 1 }
              } else {
                newInv[slotIdx] = null
              }
              updateBankDirect({ coins: alchValue })
              updateInventory(newInv)
            }
          } else if (action.materials) {
            let hasMats = true
            for (const [matId, qty] of Object.entries(action.materials)) {
              const invCount = countItem(newInv, matId)
              const bankCount = bankRef.current[matId]?.quantity || 0
              if (invCount + bankCount < qty) { hasMats = false; break }
            }
            if (!hasMats) {
              skillingRef.current = { ...skillingState, active: false, stopped: true }
              setSkilling(null)
              setSelectedAlchemyItem(null)
              selectedAlchemyItemRef.current = null
              setActiveTask(null)
              addToast('Out of materials!', 'error')
              return
            }
            const matsBankUpdates = {}
            for (const [matId, qty] of Object.entries(action.materials)) {
              const invCount = countItem(newInv, matId)
              const fromInv = Math.min(invCount, qty)
              const fromBank = qty - fromInv
              if (fromInv > 0) removeItem(newInv, matId, fromInv)
              if (fromBank > 0) matsBankUpdates[matId] = -fromBank
            }
            if (Object.keys(matsBankUpdates).length > 0) updateBankDirect(matsBankUpdates)
            if (action.product) {
              updateBankDirect({ [action.product]: action.productQty || 1 })
            }
            updateInventory(newInv)
          } else {
            updateInventory(newInv)
          }

          grantXP('magic', ev.xp)
        }
      }

      setSkilling({ ...skillingRef.current })
    })

    return unsub
  }, [skilling?.active])

  if (skilling && skilling.active) {
    const progress = 1 - (skilling.ticksRemaining / skilling.action.ticks)
    const xpPerHr = skilling.startedAt && (Date.now() - skilling.startedAt) > 5000
      ? formatNumber(Math.round(skilling.totalXP / ((Date.now() - skilling.startedAt) / 3600000)))
      : '—'
    return (
      <SkillActivePanel
        skill="magic"
        title={skilling.action.name}
        progress={progress}
        stats={[
          { label: 'Actions completed', value: skilling.totalActions },
          { label: 'XP gained', value: formatNumber(skilling.totalXP) },
          { label: 'XP / hr', value: xpPerHr, accent: xpPerHr !== '—' },
        ]}
        onStop={stopSpell}
      />
    )
  }

  const staff = getEquippedElementalStaff(equipment, itemsData)
  const staffRuneType = staff?.elemental

  const grouped = groupActions(allActions)

  return (
    <div class="h-full overflow-y-auto p-4">
      <SkillScreenHeader
        skill="magic"
        title="Magic"
        xp={stats.magic?.xp || 0}
        level={magicLevel}
        onBack={handleBack}
        backLabel="Skills"
      />

      {grouped.map(({ label, actions }) => (
        <div key={label} class="mb-5">
          <h3 class="font-[var(--font-display)] text-xs font-bold text-[var(--color-parchment)] opacity-60 uppercase tracking-wider mb-2.5">
            {label}
          </h3>
          <div class="flex flex-col gap-2.5">
            {actions.map(action => {
              const levelOk = action.level <= magicLevel
              const hasRunes = hasRequiredRunes(action.runeReq, inventory, bank, equipment, itemsData)
              const hasMats = !action.materials || Object.entries(action.materials).every(
                ([id, qty]) => (countItem(inventory, id) + (bank[id]?.quantity || 0)) >= qty
              )
              const canStart = levelOk && hasRunes && hasMats

              let availCount = null
              if (levelOk && action.materials) {
                let minAvail = Infinity
                for (const [matId, qtyNeeded] of Object.entries(action.materials)) {
                  const total = countItem(inventory, matId) + (bank[matId]?.quantity || 0)
                  minAvail = Math.min(minAvail, Math.floor(total / qtyNeeded))
                }
                availCount = minAvail === Infinity ? null : minAvail
              }

              const productItem = action.product ? itemsData[action.product] : null

              return (
                <SkillActionRow
                  key={action.id}
                  icon={productItem ? <GameIcon item={productItem} size={26} /> : <SkillIcon skill="magic" size={26} color="var(--color-gold)" />}
                  title={action.name}
                  meta={<>
                    <span class="text-[var(--color-gold)] font-bold opacity-100">Lv {action.level}</span> · {action.xp} XP · {formatActionDuration(action.ticks)}
                    {action.runeReq && <span> · Runes: {Object.entries(action.runeReq).map(([id, qty]) =>
                      staffRuneType === id ? `Staff (${itemsData[id]?.name || id})` : `${itemsData[id]?.name || id} ×${qty}`).join(', ')}</span>}
                    {action.materials && <span> · Needs: {Object.entries(action.materials).map(([id, qty]) => `${itemsData[id]?.name || id} ×${qty}`).join(', ')}</span>}
                    {availCount !== null && <span class="text-[var(--color-gold)]"> · {availCount.toLocaleString()} actions</span>}
                    {levelOk && !hasRunes && <span class="block text-[var(--color-blood-ember)] mt-1">🔮 Missing runes (or equip elemental staff)</span>}
                    {levelOk && hasRunes && !hasMats && <span class="block text-[var(--color-blood-ember)] mt-1">Missing materials</span>}
                  </>}
                  chip={action.product ? <>→ {itemsData[action.product]?.name || action.product}</> : null}
                  locked={!levelOk}
                  lockBadge={`LV ${action.level}`}
                  lockHint={`Unlocks at Magic ${action.level}`}
                  disabled={levelOk && !canStart}
                  onClick={() => handleActionClick(action)}
                />
              )
            })}
          </div>
        </div>
      ))}

      {showAlchemyPicker && pendingAlchemyAction && (
        <Modal
          title="Select item to Alchemize"
          onClose={() => { setShowAlchemyPicker(false); setPendingAlchemyAction(null) }}
        >
          <div class="text-[10px] text-[var(--color-parchment)] opacity-60 mb-3">
            Shop value ×1.1
          </div>
          <div class="space-y-2 max-h-96 overflow-y-auto">
            {inventory.map((slot, idx) => {
              if (!slot) return null
              const item = itemsData[slot.itemId]
              if (!item || typeof item.shopValue !== 'number') return null
              const alchValue = Math.floor(item.shopValue * 1.1)
              return (
                <button
                  key={`${idx}-${slot.itemId}`}
                  onClick={() => handleAlchemyPick(slot)}
                  class="w-full p-3 rounded-lg border bg-[#1a1a1a] border-[#2a4a2a] active:bg-[#2a3a2a] transition-colors text-left"
                >
                  <div class="flex items-center justify-between">
                    <div class="flex items-center gap-2 flex-1">
                      <GameIcon item={item} size={20} />
                      <div>
                        <div class="text-sm font-semibold text-[var(--color-parchment)]">{item.name}</div>
                        <div class="text-[10px] text-[var(--color-parchment)] opacity-60">
                          Shop: {item.shopValue.toLocaleString()}gp
                        </div>
                      </div>
                    </div>
                    <div class="text-right">
                      <div class="text-sm font-semibold text-[var(--color-gold)]">{alchValue.toLocaleString()}</div>
                      <div class="text-[10px] text-[var(--color-parchment)] opacity-60">coins</div>
                    </div>
                  </div>
                </button>
              )
            })}
            {inventory.every(s => !s) && (
              <div class="text-center py-4 text-[var(--color-parchment)] opacity-50">
                No items in inventory
              </div>
            )}
          </div>
        </Modal>
      )}
    </div>
  )
}
