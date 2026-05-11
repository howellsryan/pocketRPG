import { GameApiError } from './errors.js'

export function subtractCoins(save, amount) {
  const n = Math.floor(Number(amount) || 0)
  if (n <= 0) throw new GameApiError('INVALID_AMOUNT', 'Invalid amount', 400)
  const current = Number(save?.coins) || 0
  if (current < n) throw new GameApiError('INSUFFICIENT_COINS', 'Insufficient coins', 400)
  save.coins = current - n
}
