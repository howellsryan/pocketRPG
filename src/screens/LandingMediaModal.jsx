import { useState } from 'preact/hooks'
import { landingSrcSet } from '../utils/helpers.js'

export const PROMO_VIDEO_SRC = `${import.meta.env.BASE_URL || '/'}landing/promo.mp4`

export function PromoVideoThumb({ poster, posterAlt, className = '', sizes, onOpen }) {
  return (
    <button type="button" class={`lm-thumb lm-thumb--video ${className}`} onClick={onOpen} aria-label="Open PocketRPG promo video">
      <img src={poster} srcset={landingSrcSet(poster)} sizes={sizes} alt={posterAlt} loading="lazy" decoding="async" />
      <span class="lm-thumb__play" aria-hidden="true">▶</span>
      <span class="lm-thumb__label">Promo video</span>
    </button>
  )
}

export function ImageThumb({ src, alt, className = '', sizes, width, height, onOpen }) {
  return (
    <button type="button" class={`lm-thumb ${className}`} onClick={onOpen} aria-label={`Open ${alt}`}>
      <img src={src} srcset={landingSrcSet(src)} sizes={sizes} alt={alt} width={width} height={height} loading="lazy" decoding="async" />
    </button>
  )
}

export default function LandingMediaModal({ media, onClose }) {
  const [videoFailed, setVideoFailed] = useState(false)
  if (!media) return null

  const isVideo = media.type === 'video'

  return (
    <div class="lm-modal" role="dialog" aria-modal="true" aria-label={isVideo ? 'PocketRPG promo video' : media.alt} onClick={onClose}>
      <button type="button" class="lm-modal__close" onClick={onClose} aria-label="Close media preview">×</button>
      <div class={`lm-modal__frame ${isVideo ? 'lm-modal__frame--video' : ''}`} onClick={e => e.stopPropagation()}>
        {isVideo && !videoFailed ? (
          <video class="lm-modal__video" src={media.src} poster={media.poster} controls playsinline preload="metadata" onError={() => setVideoFailed(true)} />
        ) : (
          <img class="lm-modal__image" src={isVideo ? media.poster : media.src} srcset={landingSrcSet(isVideo ? media.poster : media.src)} sizes="min(92vw, 760px)" alt={isVideo ? media.posterAlt : media.alt} decoding="async" />
        )}
        {isVideo && videoFailed && (
          <p class="lm-modal__hint">Promo video will play here once <code>public/landing/promo.mp4</code> is added.</p>
        )}
      </div>
    </div>
  )
}
