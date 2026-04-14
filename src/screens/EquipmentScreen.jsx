import { useState } from 'preact/hooks'
import { useGame } from '../state/gameState.jsx'
import { unequipSlot, getEquipmentBonuses } from '../engine/equipment.js'
import { EQUIPMENT_SLOTS } from '../utils/constants.js'
import Modal from '../components/Modal.jsx'

const SCALE_ITEM_ID = 'zulrah_scales'

const EQ_SLOT_LABELS = {
  head: '🪖', cape: '🧣', neck: '📿', ammo: '🏹',
  weapon: '🗡️', body: '👕', shield: '🛡️',
  legs: '👖', gloves: '🧤', boots: '👢', ring: '💍'
}

const EQ_SLOT_NAMES = {
  head: 'Head', cape: 'Cape', neck: 'Neck', ammo: 'Ammo',
  weapon: 'Weapon', body: 'Body', shield: 'Shield',
  legs: 'Legs', gloves: 'Gloves', boots: 'Boots', ring: 'Ring'
}

/**
 * Renders a single equipment slot in the paperdoll grid.
 */
function EquipSlot({ slotName, equipment, itemsData, onSelect }) {
  const entry = equipment[slotName]
  const item = entry ? itemsData[entry.itemId] : null
  const isEmpty = !item
  const charges = entry?.charges || 0

  return (
    <button
      onClick={() => { if (item) onSelect(slotName, item) }}
      style={{
        width: '56px', height: '56px', borderRadius: '10px',
        background: isEmpty ? '#111' : '#1a1a1a',
        border: `1px solid ${isEmpty ? '#222' : '#444'}`,
        display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
        cursor: item ? 'pointer' : 'default', position: 'relative',
        opacity: isEmpty ? 0.4 : 1,
      }}
    >
      <span style={{ fontSize: item ? '18px' : '14px' }}>
        {item ? (item.icon || '📦') : EQ_SLOT_LABELS[slotName]}
      </span>
      {charges > 0 && (
        <span style={{
          position: 'absolute', bottom: '2px', right: '2px',
          fontSize: '8px', color: '#4ade80', fontWeight: 'bold'
        }}>
          ⚡
        </span>
      )}
      <span style={{
        fontSize: '7px', color: item ? '#e8d5b0' : '#555',
        textAlign: 'center', marginTop: '2px', fontWeight: item ? '600' : '400',
        maxWidth: '52px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap'
      }}>
        {item ? item.name : EQ_SLOT_NAMES[slotName]}
      </span>
    </button>
  )
}

export default function EquipmentScreen() {
  const { equipment, inventory, updateEquipment, updateInventory, addToast, itemsData } = useGame()
  const [selected, setSelected] = useState(null) // { slot, item }
  const [showSpecInfo, setShowSpecInfo] = useState(false)
  const [chargeInput, setChargeInput] = useState('')

  const handleSelect = (slotName, item) => {
    setSelected({ slot: slotName, item })
    setShowSpecInfo(false)
    setChargeInput('')
  }

  const handleUnequip = () => {
    if (!selected) return
    const newEq = { ...equipment }
    const removed = newEq[selected.slot]
    if (!removed) {
      setSelected(null)
      return
    }

    const newInv = [...inventory]
    const empty = newInv.indexOf(null)
    if (empty === -1) {
      addToast('Inventory full', 'error')
      setSelected(null)
      return
    }

    // Preserve charges on unequip so we can re-equip without losing them
    const invEntry = { itemId: removed.itemId, quantity: 1 }
    if (removed.charges && removed.charges > 0) invEntry.charges = removed.charges
    newEq[selected.slot] = null
    newInv[empty] = invEntry
    updateEquipment(newEq)
    updateInventory(newInv)
    setSelected(null)
  }

  // Count available Zulrah scales in inventory
  const scaleCount = inventory.reduce((sum, s) => sum + (s && s.itemId === SCALE_ITEM_ID ? s.quantity : 0), 0)

  const handleChargeWeapon = (qty) => {
    if (!selected) return
    const equipSlotName = selected.slot
    const weaponEntry = equipment[equipSlotName]
    if (!weaponEntry) return
    const item = itemsData[weaponEntry.itemId]
    if (!item?.scaleCharged) return

    const actualQty = Math.min(qty, scaleCount)
    if (actualQty <= 0) {
      addToast('No Zulrah scales in inventory', 'error')
      return
    }

    // Remove scales from inventory
    const newInv = [...inventory]
    let remaining = actualQty
    for (let i = 0; i < newInv.length && remaining > 0; i++) {
      if (newInv[i]?.itemId === SCALE_ITEM_ID) {
        const take = Math.min(newInv[i].quantity, remaining)
        newInv[i] = { ...newInv[i], quantity: newInv[i].quantity - take }
        if (newInv[i].quantity <= 0) newInv[i] = null
        remaining -= take
      }
    }

    // Add charges to equipped weapon
    const newEq = { ...equipment }
    const currentCharges = weaponEntry.charges || 0
    newEq[equipSlotName] = { ...weaponEntry, charges: currentCharges + actualQty }

    updateInventory(newInv)
    updateEquipment(newEq)
    addToast(`Charged ${item.name} with ${actualQty} scales`, 'info')
    setChargeInput('')
  }

  const handleUnchargeWeapon = () => {
    if (!selected) return
    const equipSlotName = selected.slot
    const weaponEntry = equipment[equipSlotName]
    if (!weaponEntry) return
    const item = itemsData[weaponEntry.itemId]
    if (!item?.scaleCharged) return

    const charges = weaponEntry.charges || 0
    if (charges <= 0) return

    // Return all charges as scales to inventory
    const newInv = [...inventory]
    const existingIdx = newInv.findIndex(s => s && s.itemId === SCALE_ITEM_ID)
    if (existingIdx !== -1) {
      newInv[existingIdx] = { ...newInv[existingIdx], quantity: newInv[existingIdx].quantity + charges }
    } else {
      const empty = newInv.indexOf(null)
      if (empty === -1) {
        addToast('Inventory full — cannot uncharge', 'error')
        return
      }
      newInv[empty] = { itemId: SCALE_ITEM_ID, quantity: charges }
    }

    const newEq = { ...equipment }
    newEq[equipSlotName] = { ...weaponEntry, charges: 0 }

    updateInventory(newInv)
    updateEquipment(newEq)
    addToast(`Uncharged ${item.name}, recovered ${charges} scales`, 'info')
  }

  const bonuses = getEquipmentBonuses(equipment, itemsData)

  // Paperdoll grid layout:
  //   Row 0:  [head]
  //   Row 1:  [cape] [neck] [ammo]
  //   Row 2:  [weapon] [body] [shield]
  //   Row 3:  [legs]
  //   Row 4:  [gloves] [boots] [ring]

  return (
    <div style={{ height: '100%', overflowY: 'auto', padding: '16px' }}>
      <h2 style={{
        fontFamily: 'Cinzel, serif', fontSize: '11px', fontWeight: 'bold',
        color: '#e8d5b0', opacity: 0.6, textTransform: 'uppercase',
        letterSpacing: '0.1em', marginBottom: '12px'
      }}>Equipment</h2>

      {/* Paperdoll */}
      <div style={{
        background: 'linear-gradient(135deg, #141414, #0f0f0f)',
        borderRadius: '14px', border: '1px solid #2a2a2a',
        padding: '16px', marginBottom: '16px',
        display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px'
      }}>
        {/* Row 0: Head */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <EquipSlot slotName="head" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
        </div>

        {/* Row 1: Cape / Neck / Ammo */}
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
          <EquipSlot slotName="cape" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
          <EquipSlot slotName="neck" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
          <EquipSlot slotName="ammo" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
        </div>

        {/* Row 2: Weapon / Body / Shield */}
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
          <EquipSlot slotName="weapon" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
          <EquipSlot slotName="body" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
          <EquipSlot slotName="shield" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
        </div>

        {/* Row 3: Legs */}
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <EquipSlot slotName="legs" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
        </div>

        {/* Row 4: Gloves / Boots / Ring */}
        <div style={{ display: 'flex', gap: '6px', justifyContent: 'center' }}>
          <EquipSlot slotName="gloves" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
          <EquipSlot slotName="boots" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
          <EquipSlot slotName="ring" equipment={equipment} itemsData={itemsData} onSelect={handleSelect} />
        </div>
      </div>

      {/* Bonuses summary */}
      <div style={{
        background: '#141414', borderRadius: '12px', border: '1px solid #2a2a2a',
        padding: '12px'
      }}>
        <h3 style={{
          fontFamily: 'Cinzel, serif', fontSize: '10px', fontWeight: 'bold',
          color: '#e8d5b0', opacity: 0.5, textTransform: 'uppercase',
          letterSpacing: '0.1em', marginBottom: '8px'
        }}>Bonuses</h3>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', fontSize: '11px' }}>
          {/* Attack bonuses */}
          <div>
            <div style={{ fontSize: '9px', color: '#e8d5b0', opacity: 0.4, marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Attack</div>
            {Object.entries(bonuses.attackBonus).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', color: '#e8d5b0', opacity: 0.7, padding: '1px 0' }}>
                <span style={{ textTransform: 'capitalize' }}>{k}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: v > 0 ? '#27ae60' : v < 0 ? '#c0392b' : '#555' }}>
                  {v > 0 ? '+' : ''}{v}
                </span>
              </div>
            ))}
          </div>

          {/* Defence bonuses */}
          <div>
            <div style={{ fontSize: '9px', color: '#e8d5b0', opacity: 0.4, marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Defence</div>
            {Object.entries(bonuses.defenceBonus).map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', color: '#e8d5b0', opacity: 0.7, padding: '1px 0' }}>
                <span style={{ textTransform: 'capitalize' }}>{k}</span>
                <span style={{ fontFamily: 'JetBrains Mono, monospace', color: v > 0 ? '#27ae60' : v < 0 ? '#c0392b' : '#555' }}>
                  {v > 0 ? '+' : ''}{v}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Other bonuses */}
        <div style={{ borderTop: '1px solid #222', marginTop: '8px', paddingTop: '8px' }}>
          <div style={{ fontSize: '9px', color: '#e8d5b0', opacity: 0.4, marginBottom: '4px', fontWeight: 'bold', textTransform: 'uppercase' }}>Other</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', fontSize: '11px' }}>
            {Object.entries(bonuses.otherBonus).map(([k, v]) => {
              const label = k === 'meleeStrength' ? 'Str' : k === 'rangedStrength' ? 'Rng Str' : 'Mag %'
              return (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', color: '#e8d5b0', opacity: 0.7 }}>
                  <span>{label}</span>
                  <span style={{ fontFamily: 'JetBrains Mono, monospace', color: v > 0 ? '#27ae60' : '#555' }}>
                    {v > 0 ? '+' : ''}{v}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      {/* Unequip modal */}
      {selected && (
        <Modal title={selected.item.name} onClose={() => setSelected(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <div style={{
              background: '#111', borderRadius: '8px', padding: '12px',
              fontSize: '12px', color: '#e8d5b0', opacity: 0.7
            }}>
              <p>Slot: {EQ_SLOT_NAMES[selected.slot]}</p>
              {selected.item.attackSpeed && <p>Attack speed: {selected.item.attackSpeed} ticks</p>}
              {selected.item.attackStyle && <p>Style: {selected.item.attackStyle}</p>}
              {selected.item.otherBonus?.meleeStrength > 0 && <p>Strength bonus: +{selected.item.otherBonus.meleeStrength}</p>}
              {selected.item.requirements && Object.entries(selected.item.requirements).length > 0 && (
                <p>Requires: {Object.entries(selected.item.requirements).map(([s, l]) => `${s} ${l}`).join(', ')}</p>
              )}
            </div>

            {/* Scale charges panel */}
            {selected.item.scaleCharged && (() => {
              const currentCharges = equipment[selected.slot]?.charges || 0
              const parsedInput = parseInt(chargeInput, 10)
              const customQty = Number.isFinite(parsedInput) && parsedInput > 0 ? parsedInput : 0
              return (
                <div style={{ background: '#111', borderRadius: '8px', border: '1px solid #1a3a2a', padding: '12px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '8px' }}>
                    <span style={{ fontSize: '12px', fontWeight: '600', color: '#4ade80' }}>🐍 Scale Charges</span>
                    <span style={{ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px', color: '#e8d5b0' }}>
                      {currentCharges} / ∞
                    </span>
                  </div>
                  <div style={{ fontSize: '10px', color: '#e8d5b0', opacity: 0.5, marginBottom: '8px' }}>
                    Scales in inventory: {scaleCount}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '4px', marginBottom: '6px' }}>
                    <button
                      onClick={() => handleChargeWeapon(10)}
                      disabled={scaleCount <= 0}
                      style={{
                        padding: '8px', borderRadius: '6px', background: scaleCount > 0 ? '#1a4a2a' : '#222',
                        color: scaleCount > 0 ? '#4ade80' : '#555', fontSize: '11px', fontWeight: '600',
                        border: 'none', cursor: scaleCount > 0 ? 'pointer' : 'not-allowed'
                      }}
                    >
                      +10
                    </button>
                    <button
                      onClick={() => handleChargeWeapon(100)}
                      disabled={scaleCount <= 0}
                      style={{
                        padding: '8px', borderRadius: '6px', background: scaleCount > 0 ? '#1a4a2a' : '#222',
                        color: scaleCount > 0 ? '#4ade80' : '#555', fontSize: '11px', fontWeight: '600',
                        border: 'none', cursor: scaleCount > 0 ? 'pointer' : 'not-allowed'
                      }}
                    >
                      +100
                    </button>
                    <button
                      onClick={() => handleChargeWeapon(scaleCount)}
                      disabled={scaleCount <= 0}
                      style={{
                        padding: '8px', borderRadius: '6px', background: scaleCount > 0 ? '#1a4a2a' : '#222',
                        color: scaleCount > 0 ? '#4ade80' : '#555', fontSize: '11px', fontWeight: '600',
                        border: 'none', cursor: scaleCount > 0 ? 'pointer' : 'not-allowed'
                      }}
                    >
                      +All
                    </button>
                  </div>
                  <div style={{ display: 'flex', gap: '4px', marginBottom: '6px' }}>
                    <input
                      type="number"
                      min="1"
                      value={chargeInput}
                      onInput={(e) => setChargeInput(e.currentTarget.value)}
                      placeholder="Custom amount"
                      style={{
                        flex: 1, padding: '8px', borderRadius: '6px', background: '#0a0a0a',
                        border: '1px solid #222', color: '#e8d5b0', fontSize: '11px',
                        fontFamily: 'JetBrains Mono, monospace'
                      }}
                    />
                    <button
                      onClick={() => handleChargeWeapon(customQty)}
                      disabled={customQty <= 0 || scaleCount <= 0}
                      style={{
                        padding: '8px 12px', borderRadius: '6px',
                        background: customQty > 0 && scaleCount > 0 ? '#1a4a2a' : '#222',
                        color: customQty > 0 && scaleCount > 0 ? '#4ade80' : '#555',
                        fontSize: '11px', fontWeight: '600', border: 'none',
                        cursor: customQty > 0 && scaleCount > 0 ? 'pointer' : 'not-allowed'
                      }}
                    >
                      Charge
                    </button>
                  </div>
                  <button
                    onClick={handleUnchargeWeapon}
                    disabled={currentCharges <= 0}
                    style={{
                      width: '100%', padding: '8px', borderRadius: '6px',
                      background: currentCharges > 0 ? '#3a1a1a' : '#222',
                      color: currentCharges > 0 ? '#f87171' : '#555',
                      fontSize: '11px', fontWeight: '600', border: 'none',
                      cursor: currentCharges > 0 ? 'pointer' : 'not-allowed'
                    }}
                  >
                    Uncharge (recover {currentCharges} scales)
                  </button>
                </div>
              )
            })()}

            {/* Special attack info */}
            {selected.item.specialAttack && (
              <div style={{ background: '#111', borderRadius: '8px', border: '1px solid #3a2a00', overflow: 'hidden' }}>
                <button
                  onClick={() => setShowSpecInfo(v => !v)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', background: 'transparent', border: 'none', cursor: 'pointer'
                  }}
                >
                  <span style={{ fontSize: '12px', fontWeight: '600', color: '#eab308' }}>⚡ Special Attack</span>
                  <span style={{ fontSize: '10px', color: '#78530a' }}>{showSpecInfo ? '▲' : '▼'} {selected.item.specialAttack.energyCost}% energy</span>
                </button>
                {showSpecInfo && (
                  <div style={{ padding: '0 12px 12px', borderTop: '1px solid #3a2a00' }}>
                    <p style={{ fontSize: '11px', color: '#e8d5b0', opacity: 0.7, marginTop: '8px', lineHeight: '1.5' }}>
                      {selected.item.specialAttack.description}
                    </p>
                    <p style={{ fontSize: '10px', color: '#78530a', marginTop: '4px' }}>
                      Bar refills to 100% on each monster kill.
                    </p>
                  </div>
                )}
              </div>
            )}

            <button
              onClick={handleUnequip}
              style={{
                padding: '12px', borderRadius: '10px',
                background: '#8b1a1a', color: 'white',
                fontWeight: '600', fontSize: '14px', border: 'none', cursor: 'pointer'
              }}
            >
              Unequip
            </button>
          </div>
        </Modal>
      )}
    </div>
  )
}
