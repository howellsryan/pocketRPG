// Model URLs are built at runtime from plain strings, so Vite's `base` never
// touches them — it only rewrites the references it bundles. Unprefixed, they
// resolve against the origin root, where the idle game's assets live.
//
// This only ever broke off the world hostname: worker/worldHost.js maps every
// unprefixed path on world.* onto /world, so production hid it. The preview
// deployment reaches the same files at /world/ on a shared hostname, where no
// such rewrite applies and every GLB 404s.
const BASE = import.meta.env.BASE_URL

/**
 * Prefix a root-absolute asset path with the deployment's base path. Pure and
 * base-driven so it can be tested without the Vite runtime. Idempotent, and a
 * no-op for anything not root-absolute (data: URIs, blob: URLs, absolute URLs).
 */
export function withAssetBase(base: string, url: string): string {
  if (!url.startsWith('/')) return url
  const prefix = base.replace(/\/+$/, '')
  if (!prefix) return url
  if (url === prefix || url.startsWith(prefix + '/')) return url
  return prefix + url
}

/** The URL a loader should actually fetch for a root-absolute model path. */
export function modelUrl(url: string): string {
  return withAssetBase(BASE, url)
}
