function appEl(): HTMLElement | null {
  return document.getElementById('app')
}

function sceneEl(): HTMLElement | null {
  return document.getElementById('scene')
}

function showOverlay(): void {
  const app = appEl()
  const scene = sceneEl()
  if (app) app.style.display = 'flex'
  if (scene) scene.style.display = 'none'
}

export function hideOverlay(): void {
  const app = appEl()
  const scene = sceneEl()
  if (app) app.style.display = 'none'
  if (scene) scene.style.display = 'block'
}

export function showMessage(text: string): void {
  const el = appEl()
  if (el) el.textContent = text
  showOverlay()
}

export function showViewportBlock(): void {
  showMessage('PocketRPG World needs a desktop or tablet.')
}

export function showLoginRequired(pocketRpgUrl: string): void {
  const el = appEl()
  if (el) {
    el.textContent = ''
    const p = document.createElement('p')
    p.textContent = 'Log in to PocketRPG and enter the world from there.'
    const a = document.createElement('a')
    a.href = pocketRpgUrl
    a.textContent = 'Go to PocketRPG'
    el.appendChild(p)
    el.appendChild(a)
  }
  showOverlay()
}
