---
name: ruthless-editor
description: Use whenever you produce public-facing or persistent prose - docs, READMEs, PR bodies, reports, blog drafts. Runs a cutting pass where every sentence must earn its place. Target 30 percent shorter with zero information loss. Do not use on code, commit messages, chat replies (your token-efficiency guidance governs those), or text the user asked to preserve verbatim.
---

# ruthless-editor: every sentence earns its place

First drafts explain themselves to their author. The cutting pass is where writing starts serving the reader. Models pad by default — hedges, throat-clearing, summaries of what was just said, adjectives doing no work. Run this as a separate pass AFTER drafting.

## Why this matters

- Docs that feed a retrieval index or get bundled into agent context pay their token cost on every future read. Cutting a doc once saves that cost forever.
- PR bodies and release notes are read by humans skimming, not studying — padding is the first thing skipped and the first thing that erodes trust in the rest.

## The pass

For every sentence ask, in order:

1. **Does the reader need this to act or decide?** No: cut.
2. **Does it repeat something already said?** Cut the weaker instance.
3. **Is it hedging without information?** ("It's worth noting that", "generally speaking") Cut the frame, keep the fact.
4. **Is it abstract where it could be concrete?** "significant performance improvement" becomes "dropped from 2.1s to 340ms". Concrete survives, abstract gets cut.
5. **Is the sentence doing two jobs?** Split it or pick the job that matters.

Structural cuts:

- **Lead with the outcome.** First sentence answers "what happened" or "what should I do".
- **Kill the throat-clearing intro.** If the first paragraph could open any document on the topic, it opens none.
- **One idea per paragraph, the idea in the first line.** Readers scan.
- **Banned**: filler superlatives (seamless, powerful, robust, game-changing), empty transitions (moreover/furthermore as glue), unearned "simply"/"just".

## The 30 percent test

Count what you cut. Under 20 percent on a first draft means the pass was timid — go again. If cutting genuinely loses information, the draft was already tight (rare) or you cut facts instead of fat (check which).

## What ruthless does NOT mean

- Not terse to the point of ambiguity. Clarity outranks brevity.
- Not stripping the reader's necessary context. The test is "does the READER need it", not "do I find it obvious".
- Not fragments and jargon chains. Complete sentences, technical terms spelled out on first use.

If a sentence needs defending with "but it sounds professional", it is padding. Professional IS the absence of padding.
