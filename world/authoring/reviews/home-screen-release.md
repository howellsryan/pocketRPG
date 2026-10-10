# Home Screen release evidence refresh — 2026-10-10

The iOS Home Screen fixes merged in `da62e6a` and `1a13935` did not reach
production. The production build for `1a13935` passed the app CI but failed
`author:release` because the shared `src/index.css` change invalidated every
regional report fingerprint and visual review receipt. The live page still
served `black-translucent` and the previous layout on 2026-10-10.

This repair regenerates the fourteen reports with the compiler and refreshes
the required visual continuity evidence. The generated report diff consists
only of source fingerprints; no maps, scene assets or game behavior change.
The release contract stays intact.

## Inspection and provenance

All current captures use source commit
`1a13935faa8a99da6a78a9ce346c9e2d276df4bf`. The comparison manifest records
each immutable gallery URL, native dimensions, full PNG digest, current source
fingerprint and inspection method. Identical PNGs reuse prior personal
inspection only after verifying their complete digest against the committed
`world-ui-cleanup-capture-comparison.json`. Every differing frame is personally
inspected at full native dimensions and has individual notes.

The four capture batches retain their completed Cloudflare build IDs in
`home-screen-release-capture-comparison.json`. Two initial batches failed the
existing randomized two-attacker combat test before capture; both passed on
an unchanged-source retry. The full local world check passed separately.
No tests or approval gates were skipped.

## Scope and remaining limits

This is continuity approval within the existing fourteen-town beta preview
and world UI cleanup scope described in `world-ui-cleanup.md`. It does not
promote the world or close any production MMORPG, multiplayer, economy,
creature-presentation, civic-safety or live-phone performance gates.
Existing preview camera cropping, repeated cottages, square terrain edges,
occasional actor overlap and foreground occlusion remain recorded limitations.

The Home Screen layout reproduction now models the user's iPhone 15 Pro:
393×852 CSS pixels, with a 393×793 web window after a modeled 59px system
status bar. Chromium checks the bottom safe-area inset; desktop WebKit checks
the reduced window and zero-inset path. The Firemaking screenshot shows the
app reaching the bottom of that simulated window. These browser captures
cannot verify the native iOS status bar, compositor blur, installation metadata
or background/resume behavior. An actual iPhone Home Screen launch remains
required after a successful production deployment; the saved shortcut may
need to be recreated to pick up the changed Apple status-bar metadata.
