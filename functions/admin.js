// GET /admin — the admin portal shell.
//
// The document itself is public because it has to be: the secret is typed into
// it. What makes that safe is that it ships a locked door and nothing else —
// no character list, no item list, no grant capability. Every one of those
// comes from /api/admin/catalog and /api/admin/grant-item, which verify
// ADMIN_SECRET on the server, so unlocking cannot be faked from the DOM.
import { renderPortalPage } from './_lib/admin/portalPage.js'

export async function onRequestGet() {
  return new Response(renderPortalPage(), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      // A page that takes a live grant credential must never be cached by a
      // proxy, indexed, framed, or used as a form target.
      'Cache-Control': 'no-store, must-revalidate',
      'X-Robots-Tag': 'noindex, nofollow',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': [
        "default-src 'none'",
        "img-src 'self'",
        "font-src 'self'",
        "connect-src 'self'",
        // The page is one self-contained document with no user-supplied markup;
        // its whole CSS/JS payload is inline.
        "style-src 'unsafe-inline'",
        "script-src 'unsafe-inline'",
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join('; '),
    },
  })
}
