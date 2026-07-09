export function showMessage(text: string): void {
  const el = document.getElementById('app')
  if (el) el.textContent = text
}

export function showViewportBlock(): void {
  showMessage('PocketRPG World needs a desktop or tablet.')
}

export function showLoginRequired(pocketRpgUrl: string): void {
  const el = document.getElementById('app')
  if (!el) return
  el.textContent = ''
  const p = document.createElement('p')
  p.textContent = 'Log in to PocketRPG and enter the world from there.'
  const a = document.createElement('a')
  a.href = pocketRpgUrl
  a.textContent = 'Go to PocketRPG'
  el.appendChild(p)
  el.appendChild(a)
}

export function showWelcome(name: string): void {
  showMessage(`Welcome, ${name}`)
}
