import { createPortal } from 'preact/compat'

export default function Modal({ title, onClose, children, fullHeight = false }) {
  const modal = (
    <div
      class="fixed inset-0 z-[1000] isolate flex h-[100dvh] min-h-[100vh] items-end justify-center sm:items-center"
      role="dialog"
      aria-modal="true"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
      }}
    >
      {/* Backdrop */}
      <div
        class="absolute inset-0 bg-black/80"
        aria-hidden="true"
        onClick={() => onClose?.()}
      />

      {/* Modal body */}
      <div
        class={`relative z-[1] w-full sm:max-w-lg bg-[var(--color-void-light)] border border-[#333] rounded-t-2xl sm:rounded-2xl overflow-hidden
          ${fullHeight ? 'h-[85vh] h-[85dvh]' : 'max-h-[85vh] max-h-[85dvh]'} flex flex-col`}
        onClick={(e) => e.stopPropagation()}
      >
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

  if (typeof document === 'undefined' || !document.body) return modal
  return createPortal(modal, document.body)
}
