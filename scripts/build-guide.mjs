#!/usr/bin/env node
// Publishes docs/game-guide.md as a crawlable page per section under /guide/,
// plus /guide/ itself as an index, plus a regenerated sitemap.xml covering
// every URL the site actually has. Output is written to guide/ and
// sitemap.xml at the repo root — generated, gitignored artifacts, same as
// index.html (§12) — and staged into dist_site/ by stage-site.mjs.
//
// Why this exists: the SPA's raw HTML only ever had one document to rank for
// (see the prerender fragment in build_single.cjs for the fix to THAT
// problem). This guide is already curated, accurate, player-facing prose —
// it's also the retrieval corpus for the help chatbot (gen-chat-knowledge.cjs
// reads the same file) — so publishing it as real static pages is close to
// free SEO surface: 49 sections become 49 URLs, each answering one specific
// "how does X work in PocketRPG" query instead of competing for one.
//
// Deliberately NOT reusing any part of the SPA's component tree or the
// Tailwind build — this has to load with no account, no game chunk and no JS
// at all (a crawler is the primary audience), so it's a small hand-rolled
// template against the same self-hosted font files and root color tokens the
// rest of the site uses (mirrored, same pattern as the admin portal — see
// CLAUDE.md §14).

import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SITE_URL = 'https://pocketrpg.co.uk'

// ── Minimal markdown → HTML ──
// The guide only ever uses: a leading blockquote (developer note — dropped,
// see below), ## section headings, **bold**, and `- ` bullet lists. No
// tables, code fences or links. A full markdown parser would be pulling in a
// dependency to handle syntax this file doesn't contain.
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
}
function inline(s) {
  return escapeHtml(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
}
function slugify(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}
// A section body into HTML blocks: consecutive `- ` lines become one <ul>,
// everything else (blank-line-separated) becomes a <p>.
function bodyToHtml(text) {
  const blocks = text.trim().split(/\n{2,}/)
  return blocks
    .map((block) => {
      const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length && lines.every((l) => l.startsWith('- '))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.slice(2))}</li>`).join('')}</ul>`
      }
      return `<p>${inline(lines.join(' '))}</p>`
    })
    .join('\n')
}

const md = readFileSync(join(root, 'docs', 'game-guide.md'), 'utf8')
// Drop the leading `# Title` + developer-facing blockquote note (internal
// authoring guidance, not player content — see the file's own header).
const afterTitle = md.replace(/^#[^\n]*\n+(?:>.*\n?)*\n*/, '')
const rawSections = afterTitle.split(/^## /m).filter(Boolean)
const sections = rawSections.map((raw) => {
  const nl = raw.indexOf('\n')
  const heading = raw.slice(0, nl).trim()
  const body = raw.slice(nl + 1).trim()
  return { heading, slug: slugify(heading), bodyHtml: bodyToHtml(body), plain: body.replace(/\*\*/g, '').replace(/\n+/g, ' ') }
})

// Slugs must be unique — they're the URL. Fail the build loudly if content
// authoring ever produces a collision rather than silently overwriting a page.
{
  const seen = new Set()
  for (const s of sections) {
    if (seen.has(s.slug)) {
      console.error(`build-guide: duplicate slug "${s.slug}" from heading "${s.heading}"`)
      process.exit(1)
    }
    seen.add(s.slug)
  }
}

// ── Shared page shell ──
// Colors mirrored from src/index.css :root (not imported — this page ships
// with no Tailwind bundle, same reasoning as the admin portal in
// functions/_lib/admin/portalPage.js). Fonts are the site's own self-hosted
// files at /public/fonts/, already built and cached immutably by _headers —
// no third-party font request.
function escAttr(s) { return escapeHtml(s) }

function page({ title, description, canonical, breadcrumb, bodyHtml }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escAttr(title)}</title>
<meta name="description" content="${escAttr(description)}">
<link rel="canonical" href="${canonical}">
<meta property="og:type" content="article">
<meta property="og:site_name" content="PocketRPG">
<meta property="og:url" content="${canonical}">
<meta property="og:title" content="${escAttr(title)}">
<meta property="og:description" content="${escAttr(description)}">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="${escAttr(title)}">
<meta name="twitter:description" content="${escAttr(description)}">
<script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'Article',
    headline: title,
    description,
    url: canonical,
    isPartOf: { '@type': 'WebSite', name: 'PocketRPG', url: SITE_URL + '/' },
  }).replace(/</g, '\\u003c')}</script>
<style>
@font-face{font-family:'Cinzel';font-weight:700;font-style:normal;font-display:swap;src:url('/public/fonts/cinzel-latin-700-normal.woff2') format('woff2')}
@font-face{font-family:'Spectral';font-weight:400;font-style:normal;font-display:swap;src:url('/public/fonts/spectral-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'Spectral';font-weight:600;font-style:normal;font-display:swap;src:url('/public/fonts/spectral-latin-600-normal.woff2') format('woff2')}
:root{--parchment:#f5e6c8;--parchment-dark:#e8d5a8;--ink:#1a1a0e;--ink-light:#3d3a2e;--gold:#d4a017;--gold-light:#f0c040;--gold-dim:#8b6914}
*{box-sizing:border-box}
body{margin:0;background:var(--parchment);color:var(--ink);font-family:Spectral,Georgia,'Times New Roman',serif;font-size:17px;line-height:1.65}
.wrap{max-width:44rem;margin:0 auto;padding:0 1.25rem 4rem}
header.site{border-bottom:2px solid var(--gold-dim);padding:1rem 1.25rem;margin-bottom:2rem}
header.site .inner{max-width:44rem;margin:0 auto;display:flex;align-items:center;justify-content:space-between;gap:1rem}
.brand{font-family:Cinzel,Georgia,serif;font-weight:700;font-size:1.25rem;color:var(--ink);text-decoration:none;letter-spacing:0.03em}
.brand:hover{color:var(--gold-dim)}
nav.crumb{font-size:0.85rem;color:var(--ink-light);margin-bottom:1.5rem}
nav.crumb a{color:var(--gold-dim);text-decoration:none}
nav.crumb a:hover{text-decoration:underline}
h1{font-family:Cinzel,Georgia,serif;font-weight:700;font-size:2rem;line-height:1.2;margin:0 0 1rem;color:var(--ink)}
h2{font-family:Cinzel,Georgia,serif;font-weight:700;font-size:1.3rem;margin:2.25rem 0 0.75rem;color:var(--ink);border-bottom:1px solid var(--parchment-dark);padding-bottom:0.35rem}
h2 a{color:inherit;text-decoration:none}
p{margin:0 0 1rem}
ul{margin:0 0 1rem;padding-left:1.4rem}
li{margin-bottom:0.4rem}
strong{color:var(--ink);font-weight:600}
a{color:var(--gold-dim)}
.lede{font-size:1.1rem;color:var(--ink-light)}
.index-list{list-style:none;padding:0;margin:0;display:flex;flex-direction:column;gap:0.9rem}
.index-list a{font-weight:600;text-decoration:none;color:var(--ink)}
.index-list a:hover{color:var(--gold-dim)}
.index-list p{margin:0.2rem 0 0;font-size:0.92rem;color:var(--ink-light)}
.pager{display:flex;justify-content:space-between;gap:1rem;margin-top:3rem;padding-top:1.5rem;border-top:1px solid var(--parchment-dark);font-size:0.92rem}
.pager a{text-decoration:none;color:var(--gold-dim)}
.cta{margin-top:3rem;padding:1.25rem;background:var(--parchment-dark);border-radius:4px;text-align:center}
.cta a{display:inline-block;margin-top:0.5rem;padding:0.6rem 1.5rem;background:var(--gold);color:var(--ink);font-weight:600;text-decoration:none;border-radius:4px}
footer.site{max-width:44rem;margin:2rem auto 0;padding:1.5rem 1.25rem;color:var(--ink-light);font-size:0.85rem;border-top:1px solid var(--parchment-dark)}
footer.site a{color:var(--gold-dim)}
</style>
</head>
<body>
<header class="site"><div class="inner"><a class="brand" href="/">PocketRPG</a><a class="brand" href="/guide/" style="font-size:1rem">Guide</a></div></header>
<div class="wrap">
<nav class="crumb">${breadcrumb}</nav>
${bodyHtml}
<div class="cta">Progress continues while you're away. <a href="/">Play PocketRPG free</a></div>
</div>
<footer class="site"><a href="/">pocketrpg.co.uk</a> — a browser idle RPG set in the world of Eldermoor.</footer>
</body>
</html>`
}

const outDir = join(root, 'guide')
rmSync(outDir, { recursive: true, force: true })
mkdirSync(outDir, { recursive: true })

// ── Index page ──
const indexBody = `
<h1>PocketRPG Game Guide</h1>
<p class="lede">How PocketRPG's systems actually work — combat, skilling, bosses, PvP and everything between. The same reference the in-game AI companion draws its answers from.</p>
<ul class="index-list">
${sections.map((s) => `<li><a href="/guide/${s.slug}/">${escapeHtml(s.heading)}</a><p>${escapeHtml(s.plain.slice(0, 140))}${s.plain.length > 140 ? '…' : ''}</p></li>`).join('\n')}
</ul>`.trim()

writeFileSync(
  join(outDir, 'index.html'),
  page({
    title: 'Game Guide — PocketRPG',
    description: 'How PocketRPG works: combat, skilling, bosses, PvP, quests and every other system, explained in one place.',
    canonical: `${SITE_URL}/guide/`,
    breadcrumb: `<a href="/">Home</a> / Guide`,
    bodyHtml: indexBody,
  })
)

// ── One page per section ──
sections.forEach((s, i) => {
  const prev = sections[i - 1]
  const next = sections[i + 1]
  const pager = `<div class="pager">
${prev ? `<a href="/guide/${prev.slug}/">&larr; ${escapeHtml(prev.heading)}</a>` : '<span></span>'}
${next ? `<a href="/guide/${next.slug}/">${escapeHtml(next.heading)} &rarr;</a>` : '<span></span>'}
</div>`
  const description = s.plain.slice(0, 155).trim() + (s.plain.length > 155 ? '…' : '')
  const dir = join(outDir, s.slug)
  mkdirSync(dir, { recursive: true })
  writeFileSync(
    join(dir, 'index.html'),
    page({
      title: `${s.heading} — PocketRPG Guide`,
      description,
      canonical: `${SITE_URL}/guide/${s.slug}/`,
      breadcrumb: `<a href="/">Home</a> / <a href="/guide/">Guide</a> / ${escapeHtml(s.heading)}`,
      bodyHtml: `<h1>${escapeHtml(s.heading)}</h1>\n${s.bodyHtml}\n${pager}`,
    })
  )
})

// ── sitemap.xml (generated — replaces the static one committed in an earlier
// pass; now that there's real page-per-URL content, it needs to enumerate it) ──
const urls = [`${SITE_URL}/`, `${SITE_URL}/guide/`, ...sections.map((s) => `${SITE_URL}/guide/${s.slug}/`)]
const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${u}</loc></url>`).join('\n')}
</urlset>
`
writeFileSync(join(root, 'sitemap.xml'), sitemapXml)

console.log(`build-guide: wrote guide/ (${sections.length} sections + index) and sitemap.xml (${urls.length} URLs)`)
