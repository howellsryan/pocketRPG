export default function Modal({ title, onClose, children, fullHeight = false }) {
  return (
    <div
      class="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
      onClick={(e) => { if (e.target === e.currentTarget) onClose?.() }}
    >
      {/* Backdrop */}
      <div class="absolute inset-0 bg-black/70" />

      {/* Modal body */}
      <div class={`relative w-full sm:max-w-lg bg-[var(--color-void-light)] border border-[#333] rounded-t-2xl sm:rounded-2xl overflow-hidden
        ${fullHeight ? 'h-[85vh]' : 'max-h-[85vh]'} flex flex-col`}>

        {/* Header */}
        {title && (
          <div class="flex items-center justify-between px-4 py-3 border-b border-[#333] flex-shrink-0">
            <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">{title}</h2>
            {onClose && (
              <button
                onClick={onClose}
                class="w-8 h-8 flex items-center justify-center rounded-full bg-[#222] text-[var(--color-parchment)] opacity-60 hover:opacity-100 active:bg-[#333]"
              >
                ✕
              </button>
            )}
          </div>
        )}

        {/* Content */}
        <div class="flex-1 overflow-y-auto p-4">
          {children}
        </div>
      </div>
    </div>
  )
}
