import { GameApiError } from './errors.js'

export function subtractCoins(save, amount) {
  const n = Math.floor(Number(amount) || 0)
  if (n <= 0) throw new GameApiError('INVALID_AMOUNT', 'Invalid amount', 400)
  const inventoryCoins = Number(save?.coins) || 0
  const bankCoins = Number(save?.bank?.coins?.quantity) || 0
  const totalCoins = inventoryCoins + bankCoins
  if (totalCoins < n) throw new GameApiError('INSUFFICIENT_COINS', 'Insufficient coins', 400)

  const fromInventory = Math.min(inventoryCoins, n)
  const fromBank = n - fromInventory

  save.coins = inventoryCoins - fromInventory
  if (fromBank > 0) {
    save.bank = save.bank || {}
    save.bank.coins = save.bank.coins || { quantity: 0 }
    save.bank.coins.quantity = bankCoins - fromBank
  }
}
