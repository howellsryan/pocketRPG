export type GrantPayload = {
  xpBySkill: Record<string, number>
  items: { itemId: string; quantity: number }[]
  reason: 'deposit' | 'disconnect' | 'timer'
}

export async function flushGrants(_env: unknown, _charId: string, _payload: GrantPayload): Promise<void> {
  return
}
