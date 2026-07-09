export function showMessage(text: string): void {
  const el = document.getElementById('app')
  if (el) el.textContent = text
}
