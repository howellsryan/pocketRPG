import { createPortal } from 'preact/compat'
import { useEffect, useState } from 'preact/hooks'

function getVisualViewportHeight() {
  if (typeof window === 'undefined') return null

  const visualHeight = Number(window.visualViewport?.height)
  if (Number.isFinite(visualHeight) && visualHeight > 0) {
    return Math.floor(visualHeight)
  }

  const innerHeight = Number(window.innerHeight)
  if (Number.isFinite(innerHeight) && innerHeight > 0) {
    return Math.floor(innerHeight)
  }

  return null
}

export default function Modal({
  title,
  onClose,
  children,
  fullHeight = false,
  className = '',
  contentClassName = '',
}) {
  const [viewportHeight, setViewportHeight] = useState(getVisualViewportHeight)

  useEffect(() => {
    if (typeof window === 'undefined') return undefined

    const updateViewportHeight = () => {
      setViewportHeight(getVisualViewportHeight())
    }

    updateViewportHeight()

    const viewport = window.visualViewport
    window.addEventListener('resize', updateViewportHeight)
    viewport?.addEventListener('resize', updateViewportHeight)
    viewport?.addEventListener('scroll', updateViewportHeight)

    return () => {
      window.removeEventListener('resize', updateViewportHeight)
      viewport?.removeEventListener('resize', updateViewportHeight)
      viewport?.removeEventListener('scroll', updateViewportHeight)
    }
  }, [])

  useEffect(() => {
    if (typeof document === 'undefined' || !document.body) return undefined

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    return () => {
      document.body.style.overflow = previousOverflow
    }
  }, [])

  const viewportHeightValue = viewportHeight ? `${viewportHeight}px` : '100svh'
  const dialogMaxHeight = `calc(${viewportHeightValue} - env(safe-area-inset-top) - env(safe-area-inset-bottom) - 16px)`
  const dialogSizeStyle = fullHeight
    ? { height: dialogMaxHeight, maxHeight: dialogMaxHeight }
    : { maxHeight: dialogMaxHeight }
  const contentSizeClass = fullHeight ? 'flex-1' : 'flex-[0_1_auto]'

  const modal = (
    <div
      class="fixed inset-x-0 top-0 z-[1000] isolate flex items-end justify-center overflow-hidden sm:items-center"
      role="dialog"
      aria-modal="true"
      style={{
        height: viewportHeightValue,
        minHeight: '100svh',
        paddingTop: 'max(8px, env(safe-area-inset-top))',
        paddingRight: 'max(8px, env(safe-area-inset-right))',
        paddingBottom: 'max(8px, env(safe-area-inset-bottom))',
        paddingLeft: 'max(8px, env(safe-area-inset-left))',
      }}
    >
      <div
        class="absolute inset-0 bg-black/80"
        aria-hidden="true"
        onClick={() => onClose?.()}
      />

      <div
        class={`relative z-[1] flex w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#333] bg-[var(--color-void-light)] ${className}`}
        style={dialogSizeStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {title && (
          <div class="flex flex-shrink-0 items-center justify-between border-b border-[#333] px-4 py-3">
            <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)]">
              {title}
            </h2>
            {onClose && (
              <button
                onClick={onClose}
                class="flex h-8 w-8 items-center justify-center rounded-full bg-[#222] text-[var(--color-parchment)] opacity-60 hover:opacity-100 active:bg-[#333]"
                aria-label="Close modal"
              >
                ✕
              </button>
            )}
          </div>
        )}

        <div class={`min-h-0 ${contentSizeClass} overflow-y-auto overscroll-contain p-4 ${contentClassName}`}>
          {children}
        </div>
      </div>
    </div>
  )

  if (typeof document === 'undefined' || !document.body) return modal
  return createPortal(modal, document.body)
}
