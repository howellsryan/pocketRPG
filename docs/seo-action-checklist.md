# SEO / Distribution — Action Checklist (Owner: Ryan)

Companion to the search strategy plan. Everything below needs a human account,
a payment, or a judgment call outside the repo — nothing here is a code change.
Shipped in-repo already (branch `claude/seo-idle-rpg-plan-q6bfa4`): OG/Twitter
cards, canonical link, VideoGame/WebSite JSON-LD, `sitemap.xml` + `robots.txt`
Sitemap line, PWA `manifest.json`, README live-build link fix, and a
prerendered landing fragment in the raw HTML (real stats/features/settlement
text now sits in `#app`, under the splash, for crawlers that don't run JS —
previously the entire initial document was just the loading screen).

Decisions on record: keep the `.co.uk` domain. Push **Eldermoor** (the world's
name) as a secondary brand term in future copy/listings — it's unclaimed
elsewhere, unlike "Pocket RPG"/"Idle RPG".

## Do first (unblocks measurement)

- [ ] **Google Search Console** — verify `pocketrpg.co.uk` (DNS TXT record, survives host changes). Submit `https://pocketrpg.co.uk/sitemap.xml`.
- [ ] **Bing Webmaster Tools** — same verification + sitemap submission. Also covers DuckDuckGo (Bing-backed) and feeds some LLM answer engines.
- [ ] Run **URL Inspection → Test Live URL** in Search Console once GSC is verified, to confirm what Google's renderer actually sees post-JS.
- [ ] Note baseline impressions/position for: brand name, "idle rpg", "browser idle rpg", "idle mmo" — so Phase 2–5 work is measurable in 90 days.

## Content decision needed before Phase 4 work continues

- [ ] **Landing hero H1 copy.** Currently `<h1>PocketRPG</h1>` with "A medieval idle RPG" as an adjacent eyebrow line (`src/screens/LandingScreen.jsx:129`). I didn't touch this — it's the one piece of live marketing copy on the page, and rewriting a player-facing headline unilaterally felt like the wrong call to make without you seeing it first. Suggested replacement if you want it: `<h1>PocketRPG — a browser idle RPG</h1>` (visually can stay styled as just "PocketRPG" with the descriptor in a smaller inline span, so the brand mark doesn't change size). Say the word and I'll make the change + rerun `npm run ci`.
- [ ] **OG share image.** Shipped using `lp-map.webp` (1108×594) as-is — no image tooling was available in this session to crop a purpose-built 1200×630 crop. Worth a proper design pass later (a hero shot with the logo + tagline baked in reads much better on Discord/Reddit than a cropped screenshot).

## Directory & portal listings (each is a manual submission)

- [ ] **itch.io** — highest priority; `hosted.html` already gives us a working iframe embed to submit as-is.
- [ ] **CrazyGames**, **Poki**, **Newgrounds**, **GameJolt**, **Armor Games** — standard browser-game portal submissions.
- [ ] **galaxy.click** and the incremental-games wiki — small audiences but exactly the right ones.
- [ ] **AlternativeTo.net** — add PocketRPG as an alternative to Melvor Idle, IdleOn, IdleMMO. These pages already rank for the comparison queries we want.
- [ ] **Steam page** (even coming-soon) — ~$100, and Steam outranks almost everything on genre terms.

## Outreach (the actual "get on idle web games lists" ask)

- [ ] Email the listicle sites that currently own "idle rpg browser games" search results: missionszanx.com, playbrain.games, freeidlegames.com, arcadebeasts.com, tideward.app. Short pitch, link, one screenshot.
- [ ] **r/incremental_games** — read the self-promo rules before posting; one careless launch post can burn the subreddit permanently. Worth doing once Phase 3 (readable landing page) and a couple of directory listings are live, so there's something to point to besides a loading screen.

## Later, not urgent

- [ ] Revisit the `.co.uk` vs `.com`/`.gg` domain question once there's real traffic/backlink data to weigh against migration cost.
