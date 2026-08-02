// The /admin portal, served as one self-contained document.
//
// It sits OUTSIDE the Tailwind + build_single.cjs pipeline (CLAUDE.md §12) — it
// is not a game screen and must load with no account, no game chunk and no
// cloud phase — so the Forgemark tokens below are mirrored from src/index.css
// `:root` (DESIGN.md §3) rather than imported. Textures and font faces are the
// real shipped assets under /public, so the page cannot drift on those. When a
// token in §3 changes, change it here in the same edit.
//
// The markup carries NO admin data. Characters and items arrive from
// /api/admin/catalog only after the secret verifies, so an unauthorized visitor
// gets a locked door and nothing behind it.

const STYLES = `
:root{
  --fm-parch:#e9dcbd; --fm-parch-hi:#f3ead0; --fm-parch-lo:#d8c69e; --fm-vellum:#e6d8b6;
  --fm-ink:#2b2114; --fm-ink-soft:#5a4a32; --fm-ink-faint:#8a7553; --fm-rule:#b6a079;
  --fm-iron:#1c1a18; --fm-soot:#14110d;
  --fm-brass:#b08842; --fm-brass-hi:#e6c878; --fm-brass-lo:#6e521f;
  --fm-ember:#c2410c; --fm-ember-hi:#f0742a; --fm-ember-deep:#7c2708;
  --fm-blood:#7f1d1d; --fm-verdigris:#2f6b5e; --fm-woad:#2c4a73;
  --fm-r-sharp:2px; --fm-r-sm:4px; --fm-r-frame:7px;
  --fm-ease:cubic-bezier(0.2,0.9,0.3,1); --fm-dur:0.16s;
  --fm-frame-shadow:0 2px 0 rgba(0,0,0,0.5),0 14px 28px -14px rgba(0,0,0,0.85),inset 0 1px 0 rgba(255,255,255,0.07),inset 0 0 0 1px rgba(0,0,0,0.6);
  --fm-parch-inset:inset 0 2px 5px rgba(74,54,28,0.35),inset 0 0 0 1px rgba(120,95,55,0.25);
  --fm-rivet:radial-gradient(circle at 38% 32%,var(--fm-brass-hi),var(--fm-brass) 48%,var(--fm-brass-lo) 100%);
  --fm-ember-face:linear-gradient(178deg,#f0742a 0%,#c2410c 52%,#8a2d06 100%);
  --fm-parch-face:radial-gradient(120% 80% at 0% 0%,rgba(255,240,200,0.5),transparent 55%),radial-gradient(140% 120% at 100% 100%,rgba(150,110,60,0.18),transparent 60%),linear-gradient(160deg,#ece0c2,#e0d0a8);
  --fm-btn-vellum:linear-gradient(180deg,#f0e4c4 0%,#e2d2ab 100%);
  --fm-btn-brass:linear-gradient(180deg,#c39a4e 0%,#ab8038 62%,#96702e 100%);
  --fm-btn-relief-vellum:inset 0 1px 0 rgba(255,250,232,0.75),inset 0 -1px 0 rgba(140,112,64,0.24);
  --fm-btn-relief-brass:inset 0 1px 0 rgba(255,238,196,0.45),inset 0 -1px 0 rgba(58,40,12,0.4);
  --fm-btn-press:inset 0 2px 4px rgba(74,54,28,0.38);
  --fm-btn-ink-on:#2a1e0c;
}

@font-face{font-family:'Grenze Gotisch';font-weight:700;font-display:swap;src:url('/public/fonts/grenze-gotisch-latin-700-normal.woff2') format('woff2')}
@font-face{font-family:'Grenze Gotisch';font-weight:900;font-display:swap;src:url('/public/fonts/grenze-gotisch-latin-900-normal.woff2') format('woff2')}
@font-face{font-family:'Spectral';font-weight:400;font-display:swap;src:url('/public/fonts/spectral-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'Spectral';font-weight:600;font-display:swap;src:url('/public/fonts/spectral-latin-600-normal.woff2') format('woff2')}
@font-face{font-family:'IM Fell English';font-style:italic;font-weight:400;font-display:swap;src:url('/public/fonts/im-fell-english-latin-400-italic.woff2') format('woff2')}
@font-face{font-family:'Spline Sans Mono';font-weight:400;font-display:swap;src:url('/public/fonts/spline-sans-mono-latin-400-normal.woff2') format('woff2')}
@font-face{font-family:'Spline Sans Mono';font-weight:600;font-display:swap;src:url('/public/fonts/spline-sans-mono-latin-600-normal.woff2') format('woff2')}

*,*::before,*::after{box-sizing:border-box}
[hidden]{display:none !important}
html,body{margin:0;padding:0}
body{
  min-height:100vh;
  background-color:var(--fm-soot);
  background-image:url('/public/forge/iron.webp');
  background-size:340px;
  color:var(--fm-parch);
  font-family:'Spectral',Georgia,serif;
  font-size:16px;
  line-height:1.5;
  padding:20px 14px 56px;
  -webkit-text-size-adjust:100%;
}

.fm-num{font-family:'Spline Sans Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
.fm-eyebrow{font-family:'Spectral',Georgia,serif;font-weight:600;font-size:12px;letter-spacing:0.34em;text-transform:uppercase;color:var(--fm-ink-faint);margin:0}
.fm-banner{font-family:'Grenze Gotisch','Cinzel',Georgia,serif;font-weight:800;line-height:1.06;letter-spacing:0.01em;margin:6px 0 0;color:var(--fm-ink)}
.fm-lore{font-family:'IM Fell English',Georgia,serif;font-style:italic;color:var(--fm-ink-soft);line-height:1.5;margin:8px 0 0}

/* Frame + vellum: iron plate with brass rivets, parchment set INTO it. */
.fm-frame{
  position:relative;
  background-color:var(--fm-iron);
  background-image:url('/public/forge/iron.webp');
  background-size:260px;
  border-radius:var(--fm-r-frame);
  box-shadow:var(--fm-frame-shadow);
  padding:12px;
}
.fm-frame::before,.fm-frame::after,.fm-frame>.rivet{
  content:'';position:absolute;width:11px;height:11px;border-radius:50%;background:var(--fm-rivet);
  box-shadow:0 1px 1px rgba(0,0,0,0.7),inset 0 -1px 1px rgba(0,0,0,0.4),inset 0 1px 1px rgba(255,240,200,0.5);
}
.fm-frame::before{top:8px;left:8px}
.fm-frame::after{top:8px;right:8px}
.fm-frame>.rivet--bl{bottom:8px;left:8px}
.fm-frame>.rivet--br{bottom:8px;right:8px}
/* Texture covers, never tiles — a repeat seam across a vellum page reads as a
   rendering bug, and the shipped .fm-parch avoids it the same way. */
.fm-parch{
  position:relative;
  overflow:hidden;
  background-color:var(--fm-vellum);
  background-image:
    radial-gradient(130% 120% at 50% 50%,transparent 62%,rgba(110,75,30,0.22)),
    var(--fm-parch-face),
    url('/public/forge/parchment.webp');
  background-size:auto,auto,cover;
  border-radius:var(--fm-r-sm);
  box-shadow:var(--fm-parch-inset),inset 0 0 36px rgba(120,80,30,0.28);
  color:var(--fm-ink);
  padding:22px 18px;
}
.fm-parch::before,.fm-parch::after{
  content:'';position:absolute;width:30px;height:30px;opacity:0.5;pointer-events:none;
  background:url('/public/forge/corner.svg') no-repeat center/contain;
}
.fm-parch::before{top:7px;left:7px}
.fm-parch::after{bottom:7px;right:7px;transform:rotate(180deg)}

.fm-rule-head{display:flex;align-items:center;gap:10px;margin:26px 0 12px}
.fm-rule-head::before,.fm-rule-head::after{content:'';height:1px;flex:1;background:linear-gradient(90deg,transparent,var(--fm-rule),transparent)}
.fm-rule-head>span{font-family:'Spectral',Georgia,serif;font-weight:600;font-size:12px;letter-spacing:0.28em;text-transform:uppercase;color:var(--fm-ink-faint);white-space:nowrap}

/* Pressed metal. Relief, never a drop shadow; 1px translate on press. */
.fm-btn{
  display:inline-flex;align-items:center;justify-content:center;gap:8px;
  min-height:44px;padding:11px 18px;
  font-family:'Grenze Gotisch','Cinzel',Georgia,serif;font-weight:800;font-size:17px;letter-spacing:0.04em;
  background:var(--fm-btn-vellum);color:var(--fm-ink);
  border:1px solid var(--fm-rule);border-radius:var(--fm-r-sm);
  box-shadow:var(--fm-btn-relief-vellum);
  cursor:pointer;
  transition:filter var(--fm-dur) var(--fm-ease),transform var(--fm-dur) var(--fm-ease);
}
.fm-btn:hover:not(:disabled){filter:brightness(1.04)}
.fm-btn:active:not(:disabled){transform:translateY(1px);box-shadow:var(--fm-btn-press)}
.fm-btn:focus-visible{outline:2px solid var(--fm-brass);outline-offset:2px}
.fm-btn:disabled{background:#cbbb95;color:#8d8071;border-color:#b3a180;box-shadow:none;cursor:not-allowed}
.fm-btn--brass{background:var(--fm-btn-brass);color:var(--fm-btn-ink-on);border-color:var(--fm-brass-lo);box-shadow:var(--fm-btn-relief-brass)}
.fm-btn--ember{
  background:var(--fm-ember-face);color:#fff3e6;border-color:var(--fm-ember-deep);
  box-shadow:inset 0 1px 0 rgba(255,214,180,0.45),inset 0 -1px 0 rgba(80,24,4,0.5);
}
.fm-btn--ember:hover:not(:disabled){filter:brightness(1.06);box-shadow:inset 0 1px 0 rgba(255,214,180,0.45),0 7px 20px -6px rgba(240,116,42,0.8)}
.fm-btn--lg{width:100%;font-size:19px;min-height:52px}

/* Segmented toggle: ON is matte struck brass with ink text. */
.fm-toggle{display:inline-flex;border:1px solid var(--fm-rule);border-radius:var(--fm-r-sm);overflow:hidden;background:var(--fm-btn-vellum)}
.fm-toggle button{
  appearance:none;min-height:44px;padding:10px 16px;border:0;cursor:pointer;
  background:transparent;color:var(--fm-ink-soft);
  font-family:'Spectral',Georgia,serif;font-weight:600;font-size:13px;letter-spacing:0.14em;text-transform:uppercase;
}
.fm-toggle button+button{border-left:1px solid var(--fm-rule)}
.fm-toggle button[aria-pressed="true"]{background:var(--fm-btn-brass);color:var(--fm-btn-ink-on);box-shadow:var(--fm-btn-relief-brass)}
.fm-toggle button:focus-visible{outline:2px solid var(--fm-brass);outline-offset:-3px}

.fm-tag{display:inline-block;padding:3px 8px;border-radius:var(--fm-r-sharp);border:1px solid var(--fm-rule);background:rgba(255,246,220,0.5);color:var(--fm-ink-soft);font-size:11px;font-weight:600;letter-spacing:0.16em;text-transform:uppercase}
.fm-tag--verdigris{border-color:var(--fm-verdigris);color:var(--fm-verdigris)}
.fm-tag--blood{border-color:var(--fm-blood);color:var(--fm-blood)}
.fm-tag--brass{border-color:var(--fm-brass-lo);color:var(--fm-brass-lo)}

.fm-ledger{width:100%;border-collapse:collapse;margin-top:10px}
.fm-ledger th{
  text-align:left;padding:6px 4px;border-bottom:2px solid var(--fm-ink);
  font-family:'Spectral',Georgia,serif;font-weight:600;font-size:11px;letter-spacing:0.22em;text-transform:uppercase;color:var(--fm-ink-faint);
}
.fm-ledger td{padding:9px 4px;border-bottom:1px solid var(--fm-rule);font-size:15px;color:var(--fm-ink)}
.fm-ledger tr:nth-child(even) td{background:rgba(184,160,121,0.11)}
.fm-ledger td:first-child{white-space:nowrap;color:var(--fm-ink-soft)}
.fm-ledger td:last-child,.fm-ledger th:last-child{text-align:right;word-break:break-word}

/* Fields */
.field{margin-top:16px}
.field>label{display:block;font-family:'Spectral',Georgia,serif;font-weight:600;font-size:12px;letter-spacing:0.2em;text-transform:uppercase;color:var(--fm-ink-faint);margin-bottom:6px}
.field__hint{font-size:13px;color:var(--fm-ink-soft);margin:6px 0 0}
input[type="text"],input[type="password"],input[type="number"]{
  width:100%;min-height:44px;padding:10px 12px;
  /* Light: these sit on parchment. Without it a dark-mode OS repaints the
     control internals (text, caret, spinners) with light-on-light. */
  color-scheme:light;
  background:rgba(255,250,232,0.72);color:var(--fm-ink);
  border:1px solid var(--fm-rule);border-radius:var(--fm-r-sm);
  box-shadow:inset 0 1px 3px rgba(74,54,28,0.22);
  font-family:'Spectral',Georgia,serif;font-size:16px;
}
input[type="number"],.fm-num-input{font-family:'Spline Sans Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
input:focus-visible{outline:2px solid var(--fm-brass);outline-offset:1px}
input::placeholder{color:var(--fm-ink-faint)}
.filter{margin-bottom:6px}

/* Buttons, not a native sized listbox. A native list paints its rows with the
   platform's own colours — Safari and iOS ignore the inherited colour entirely
   — so on a dark-mode OS the rows came out light-on-parchment and unreadable.
   Owning the rows is the only way to guarantee legible text. */
.picklist{
  max-height:196px;overflow-y:auto;-webkit-overflow-scrolling:touch;
  background:rgba(255,250,232,0.72);
  border:1px solid var(--fm-rule);border-radius:var(--fm-r-sm);
  box-shadow:inset 0 1px 3px rgba(74,54,28,0.22);
}
.picklist:focus-visible{outline:2px solid var(--fm-brass);outline-offset:1px}
.pick{
  display:block;width:100%;text-align:left;cursor:pointer;
  min-height:44px;padding:10px 12px;
  background:transparent;color:var(--fm-ink);
  border:0;border-bottom:1px solid rgba(182,160,121,0.5);
  font-family:'Spectral',Georgia,serif;font-size:15px;line-height:1.3;
}
.pick:last-child{border-bottom:0}
.pick:hover:not(:disabled){background:rgba(184,160,121,0.22)}
.pick:focus-visible{outline:2px solid var(--fm-brass);outline-offset:-2px}
.pick__meta{display:block;margin-top:2px;font-size:12px;color:var(--fm-ink-faint);font-variant-numeric:tabular-nums}
.pick[aria-selected="true"]{background:var(--fm-btn-brass);color:var(--fm-btn-ink-on);box-shadow:var(--fm-btn-relief-brass)}
.pick[aria-selected="true"] .pick__meta{color:#4a3712}
/* Solid dead face with faint ink — never an opacity fade (DESIGN.md §6). */
.pick:disabled{background:#d5c7a3;color:#8d8071;cursor:not-allowed}
.pick:disabled .pick__meta{color:#8d8071}
.picklist__empty{padding:14px 12px;color:var(--fm-ink-faint);font-style:italic}
.chosen{margin:8px 0 0;font-size:13px;color:var(--fm-ink-soft)}
.chosen strong{color:var(--fm-ink);font-weight:600}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chips button{
  min-height:34px;padding:6px 11px;cursor:pointer;
  background:var(--fm-btn-vellum);color:var(--fm-ink-soft);
  border:1px solid var(--fm-rule);border-radius:var(--fm-r-sharp);
  font-family:'Spline Sans Mono',ui-monospace,monospace;font-size:12px;font-variant-numeric:tabular-nums;
}
.chips button:hover{filter:brightness(1.04)}
.chips button:focus-visible{outline:2px solid var(--fm-brass);outline-offset:1px}
.row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:22px}
/* Wrapping, not shrinking: a flex item's automatic min-width is its longest
   word, so a third button pushed the row off the side of a phone. */
.actions .fm-btn{flex:1 1 130px}

/* Nav. The portal acts on ONE character or on the whole server, and which of
   those you are in decides whether a press touches somebody's account — so the
   scope is a tab bar at the top, not a heading part-way down a long form.
   Selected reads brass, matching every other chosen thing on the page
   (.pick, .fm-toggle); ember stays reserved for the act-now buttons. */
.tabs{display:flex;width:100%;margin-top:18px;border:1px solid var(--fm-rule);border-radius:var(--fm-r-sm);overflow:hidden;background:var(--fm-btn-vellum);box-shadow:var(--fm-btn-relief-vellum)}
.tabs button{
  flex:1;appearance:none;min-height:50px;padding:12px 10px;border:0;cursor:pointer;
  background:transparent;color:var(--fm-ink-soft);
  font-family:'Grenze Gotisch','Cinzel',Georgia,serif;font-weight:800;font-size:18px;letter-spacing:0.05em;
}
.tabs button+button{border-left:1px solid var(--fm-rule)}
.tabs button[aria-selected="true"],.tabs button[aria-pressed="true"]{background:var(--fm-btn-brass);color:var(--fm-btn-ink-on);box-shadow:var(--fm-btn-relief-brass)}
.tabs button:focus-visible{outline:2px solid var(--fm-brass);outline-offset:-3px}

.subnav{display:flex;width:100%;margin-top:16px;border:1px solid var(--fm-rule);border-radius:var(--fm-r-sm);overflow:hidden;background:var(--fm-btn-vellum)}
.subnav button{
  flex:1;appearance:none;min-height:44px;padding:10px 8px;border:0;cursor:pointer;
  background:transparent;color:var(--fm-ink-soft);
  font-family:'Spectral',Georgia,serif;font-weight:600;font-size:12px;letter-spacing:0.16em;text-transform:uppercase;
}
.subnav button+button{border-left:1px solid var(--fm-rule)}
.subnav button[aria-selected="true"]{background:var(--fm-btn-brass);color:var(--fm-btn-ink-on);box-shadow:var(--fm-btn-relief-brass)}
.subnav button:focus-visible{outline:2px solid var(--fm-brass);outline-offset:-3px}

/* Who every action below is about to hit. A grant and a restore are both
   irreversible for the player on the receiving end, so the name stays on
   screen above them rather than only in the picker they scrolled past. */
.scope{
  margin:16px 0 0;padding:11px 13px;
  border:1px solid var(--fm-brass-lo);border-left-width:4px;border-radius:var(--fm-r-sharp);
  background:rgba(176,136,66,0.13);color:var(--fm-ink);font-size:14px;line-height:1.45;
}
.scope strong{font-weight:600}
.scope--idle{border-color:var(--fm-rule);background:rgba(184,160,121,0.12);color:var(--fm-ink-soft);font-style:italic}

/* Gate */
.wrap{max-width:560px;margin:0 auto}
/* The gate is a door, not a page: it sits centred in the viewport with nothing
   else on it. The portal that replaces it is a long form and stays top-aligned. */
.wrap:has(#gate:not([hidden])){min-height:calc(100vh - 120px);display:flex;align-items:center}
.gate{width:100%}
.gate__seal{display:block;width:76px;height:76px;margin:0 auto 14px;opacity:0.94}
.gate .fm-parch{text-align:center;padding:30px 22px}
.gate .field{text-align:left}
.gate__banner{font-size:36px}
.crest{display:flex;align-items:baseline;justify-content:space-between;gap:12px}
.portal__banner{font-size:31px}
.msg{margin-top:14px;padding:11px 13px;border-radius:var(--fm-r-sm);border:1px solid;font-size:14px;line-height:1.45}
.msg--err{border-color:var(--fm-blood);background:rgba(127,29,29,0.1);color:#5e1515}
.msg--ok{border-color:var(--fm-verdigris);background:rgba(47,107,94,0.1);color:#204d43}
.foot{max-width:560px;margin:16px auto 0;text-align:center;color:var(--fm-brass-lo);font-size:12px;letter-spacing:0.18em;text-transform:uppercase}
.spin{opacity:0.65;pointer-events:none}

@media (prefers-reduced-motion:reduce){
  *{transition:none !important;animation:none !important}
}
@media (min-width:640px){
  body{padding-top:44px}
  .gate__banner{font-size:44px}
  .portal__banner{font-size:36px}
}
`

const SCRIPT = `
(function(){
  'use strict';
  // Memory only. Never localStorage/sessionStorage/cookie/URL — a reload
  // re-locks the portal, which is the intended cost of holding a live grant
  // credential in a browser tab.
  var secret = null;
  var catalog = { items: [], characters: [] };
  var destination = 'inventory';
  var noted = false;
  var selectedCharacter = null;
  var selectedItem = null;
  var snapshots = [];
  var selectedSnapshot = null;
  var snapshotCharacter = null;
  var incidents = [];
  var selectedIncident = null;
  var incidentReview = 'active';
  // Which scope is on screen. 'player' acts on one character, 'server' reads
  // across every account — the tab bar is the only thing standing between a
  // restore and the wrong player, so it is state, not decoration.
  var view = 'player';
  var pane = 'grant';
  var incidentSummary = null;

  var $ = function(id){ return document.getElementById(id); };

  function headers(){
    return { 'Content-Type': 'application/json', 'X-Admin-Secret': secret };
  }

  function message(el, kind, text){
    el.className = 'msg msg--' + kind;
    el.textContent = text;
    el.hidden = false;
  }

  function lock(reason){
    secret = null;
    catalog = { items: [], characters: [] };
    selectedCharacter = null;
    selectedItem = null;
    clearSnapshots();
    incidents = [];
    selectedIncident = null;
    markReviewFilter('active');
    $('incidents').textContent = '';
    $('incident-summary').textContent = '';
    $('incident-filter').value = '';
    $('incident-note').value = '';
    $('incident-detail').hidden = true;
    $('incident-msg').hidden = true;
    setView('player');
    setPane('grant');
    $('portal').hidden = true;
    $('gate').hidden = false;
    $('secret').value = '';
    if (reason) message($('gate-msg'), 'err', reason);
    $('secret').focus();
  }

  // Rows are built with DOM APIs, never innerHTML: usernames are player-authored
  // text and must never be parsed as markup.
  function fillList(listId, entries, selectedValue, onPick){
    var list = $(listId);
    list.textContent = '';
    if (!entries.length){
      var empty = document.createElement('p');
      empty.className = 'picklist__empty';
      empty.textContent = 'Nothing matches that filter.';
      list.appendChild(empty);
      return;
    }
    for (var i = 0; i < entries.length; i++){
      var entry = entries[i];
      var row = document.createElement('button');
      row.type = 'button';
      row.className = 'pick';
      row.setAttribute('role', 'option');
      row.setAttribute('data-value', entry.value);
      row.setAttribute('aria-selected', String(entry.value === selectedValue));
      if (entry.disabled) row.disabled = true;
      var name = document.createElement('span');
      name.textContent = entry.label;
      row.appendChild(name);
      var meta = document.createElement('span');
      meta.className = 'pick__meta';
      meta.textContent = entry.meta;
      row.appendChild(meta);
      row.addEventListener('click', onPick);
      list.appendChild(row);
    }
  }

  function characterEntries(query){
    var q = query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < catalog.characters.length; i++){
      var c = catalog.characters[i];
      if (q && c.username.toLowerCase().indexOf(q) === -1 && String(c.id) !== q) continue;
      var marks = ['#' + c.id, 'level ' + c.totalLevel];
      if (c.isIronman) marks.push('ironman');
      if (c.isOneLife) marks.push('one life');
      if (!c.hasSave) marks.push('never synced — cannot grant');
      out.push({ value: String(c.id), label: c.username, meta: marks.join(' · '), disabled: !c.hasSave });
    }
    return out;
  }

  function itemEntries(query){
    var q = query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < catalog.items.length; i++){
      var it = catalog.items[i];
      if (q && it.name.toLowerCase().indexOf(q) === -1 && it.id.indexOf(q) === -1) continue;
      out.push({ value: it.id, label: it.name, meta: it.id + (it.stackable ? ' · stacks' : '') });
    }
    return out;
  }

  function pickHandler(kind){
    return function(e){
      var value = e.currentTarget.getAttribute('data-value');
      if (kind === 'character') selectedCharacter = value; else selectedItem = value;
      refreshLists();
    };
  }

  function describeChosen(kind){
    var el = $(kind + '-chosen');
    var value = kind === 'character' ? selectedCharacter : selectedItem;
    el.textContent = '';
    if (!value){
      el.textContent = 'Nothing chosen yet.';
      return;
    }
    var strong = document.createElement('strong');
    if (kind === 'character'){
      var c = null;
      for (var i = 0; i < catalog.characters.length; i++) if (String(catalog.characters[i].id) === value) c = catalog.characters[i];
      strong.textContent = c ? c.username + ' (#' + c.id + ')' : value;
    } else {
      var it = null;
      for (var j = 0; j < catalog.items.length; j++) if (catalog.items[j].id === value) it = catalog.items[j];
      strong.textContent = it ? it.name : value;
    }
    el.appendChild(document.createTextNode('Chosen: '));
    el.appendChild(strong);
  }

  function refreshLists(){
    var itemMatches = itemEntries($('item-filter').value);
    var charMatches = characterEntries($('character-filter').value);

    // Filtering down to a single grantable match and then still having to click
    // it is a step with no decision in it — take it.
    if (itemMatches.length === 1) selectedItem = itemMatches[0].value;
    if (charMatches.length === 1 && !charMatches[0].disabled) selectedCharacter = charMatches[0].value;

    fillList('item', itemMatches, selectedItem, pickHandler('item'));
    fillList('character', charMatches, selectedCharacter, pickHandler('character'));
    $('item-count').textContent = itemMatches.length + ' of ' + catalog.items.length + ' items';
    $('character-count').textContent = charMatches.length + ' of ' + catalog.characters.length + ' characters';
    describeChosen('item');
    describeChosen('character');
    renderPlayerScope();
    // Snapshots belong to the character they were listed for. The picker moves
    // by click AND by the single-match auto-select above, so this is checked
    // here rather than in the click handler — leaving a stale list on screen is
    // how a restore lands on the wrong account.
    if (snapshotCharacter !== null && String(snapshotCharacter) !== String(selectedCharacter)) clearSnapshots();
  }

  function num(n){ return Number(n).toLocaleString('en-GB'); }

  function renderReceipt(body, dryRun){
    var rows = [
      ['Character', body.username + '  #' + body.character_id],
      ['Item', body.item_name + '  (' + body.item_id + ')'],
      ['Quantity', num(body.quantity)],
      ['Destination', body.destination],
      ['Held before', num(body.before)],
      ['Held after', num(body.after)],
      ['Save revision', body.save_revision === undefined ? '—' : num(body.save_revision)],
    ];
    ledgerRows('receipt-body', rows);
    $('receipt-tag').className = 'fm-tag ' + (dryRun ? 'fm-tag--brass' : 'fm-tag--verdigris');
    $('receipt-tag').textContent = dryRun ? 'Preview only — nothing written' : 'Granted';
    $('receipt').hidden = false;
    $('receipt').scrollIntoView({ block: 'nearest' });
  }

  function when(ms){
    var d = new Date(Number(ms) || 0);
    return isNaN(d.getTime()) ? '—' : d.toLocaleString('en-GB');
  }

  function ledgerRows(tbodyId, rows){
    var tbody = $(tbodyId);
    tbody.textContent = '';
    for (var i = 0; i < rows.length; i++){
      var tr = document.createElement('tr');
      var th = document.createElement('td');
      th.textContent = rows[i][0];
      var td = document.createElement('td');
      td.textContent = rows[i][1];
      td.className = 'fm-num';
      tr.appendChild(th); tr.appendChild(td);
      tbody.appendChild(tr);
    }
  }

  function clearSnapshots(){
    snapshots = [];
    selectedSnapshot = null;
    snapshotCharacter = null;
    $('snapshots').textContent = '';
    $('snapshot-count').textContent = '';
    $('snapshot-chosen').textContent = '';
    $('snapshot-detail').hidden = true;
    $('restore-msg').hidden = true;
  }

  function adminGet(path, onOk, msgEl){
    fetch(path, { headers: { 'X-Admin-Secret': secret } }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(body){
        return { status: res.status, body: body };
      });
    }).then(function(r){
      if (r.status === 401) return lock('That secret is no longer valid. Enter it again.');
      if (r.status >= 400 || !r.body || !r.body.ok) return message(msgEl, 'err', errorText(r.status, r.body));
      onOk(r.body);
    }).catch(function(){
      message(msgEl, 'err', 'Could not reach the server.');
    });
  }

  function loadSnapshots(preselectId){
    var msg = $('restore-msg');
    msg.hidden = true;
    clearSnapshots();
    var characterId = Number(selectedCharacter);
    if (!characterId) return message(msg, 'err', 'Choose a character first.');
    adminGet('/api/admin/restore-save?character_id=' + characterId, function(body){
      snapshots = body.snapshots || [];
      snapshotCharacter = String(characterId);
      var held = body.current && body.current.holdings ? body.current.holdings : null;
      $('snapshot-count').textContent = snapshots.length
        ? snapshots.length + ' snapshot' + (snapshots.length === 1 ? '' : 's') +
          (held ? ' · live save holds ' + num(held.distinctItems) + ' distinct items' : '')
        : 'No snapshots preserved for this character yet.';
      renderSnapshots();
      // Arriving from an incident: select the snapshot that incident named, so
      // the restore is one press away rather than a date to match by eye.
      if (preselectId && snapshots.some(function(x){ return x.id === preselectId; })) selectSnapshot(preselectId);
    }, msg);
  }

  function markReviewFilter(next){
    incidentReview = next;
    var buttons = $('incident-review').querySelectorAll('button');
    for (var i = 0; i < buttons.length; i++){
      buttons[i].setAttribute('aria-pressed', String(buttons[i].getAttribute('data-review') === next));
    }
  }

  function loadIncidents(){
    var msg = $('incident-msg');
    msg.hidden = true;
    $('incident-detail').hidden = true;
    $('incident-note').value = '';
    selectedIncident = null;
    adminGet('/api/admin/item-loss?limit=100&review=' + incidentReview, function(body){
      incidents = body.incidents || [];
      incidentSummary = body.summary || null;
      renderIncidents();
    }, msg);
  }

  var REVIEW_LABEL = { dismissed: 'not an incident', confirmed: 'confirmed loss', open: 'unreviewed' };

  /** File the admin's verdict. Re-lists rather than patching the row in place:
   * the server owns both the filter and the summary, and a dismissal usually
   * means the row leaves the queue it was dismissed from. */
  function reviewIncident(status){
    var inc = selectedIncidentRow();
    var msg = $('incident-msg');
    if (!inc) return message(msg, 'err', 'Choose an incident first.');
    msg.hidden = true;
    var buttons = ['incident-dismiss-btn', 'incident-confirm-btn', 'incident-reopen-btn'];
    for (var i = 0; i < buttons.length; i++) $(buttons[i]).disabled = true;
    fetch('/api/admin/item-loss', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ id: inc.id, status: status, note: $('incident-note').value }),
    }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(body){
        return { status: res.status, body: body };
      });
    }).then(function(r){
      if (r.status === 401) return lock('That secret is no longer valid. Enter it again.');
      if (r.status >= 400 || !r.body || !r.body.ok) return message(msg, 'err', errorText(r.status, r.body));
      loadIncidents();
      message(msg, 'ok', 'Filed as ' + REVIEW_LABEL[status] + '.');
    }).catch(function(){
      message(msg, 'err', 'Could not reach the server.');
    }).then(function(){
      for (var j = 0; j < buttons.length; j++) $(buttons[j]).disabled = false;
    });
  }

  function incidentMatches(){
    var q = $('incident-filter').value.trim().toLowerCase();
    if (!q) return incidents;
    var out = [];
    for (var i = 0; i < incidents.length; i++){
      var inc = incidents[i];
      var name = (inc.username || '').toLowerCase();
      if (name.indexOf(q) !== -1 || String(inc.character_id) === q) out.push(inc);
    }
    return out;
  }

  function renderIncidents(){
    var matches = incidentMatches();
    var s = incidentSummary;
    var line;
    if (!s) line = '';
    else if (!incidents.length) line = incidentReview === 'active'
      ? 'Nothing outstanding. Every flagged loss has been dismissed, or none has been caught.'
      : 'Nothing filed under that verdict yet.';
    else {
      line = s.incidents + ' incidents · ' + s.characters + ' character(s) · ' + s.unresolved +
        ' not restored since · ' + s.confirmed + ' confirmed · ' + s.dismissed + ' dismissed · ' +
        num(s.durableValue) + ' gp of durables, ' + num(s.resourceValue) + ' gp of resources';
      if (matches.length !== incidents.length) line = 'Showing ' + matches.length + ' of ' + line;
    }
    $('incident-summary').textContent = line;
    var entries = [];
    for (var i = 0; i < matches.length; i++){
      var inc = matches[i];
      var marks = [inc.source || 'unknown source'];
      if (inc.durable_units) marks.push(num(inc.durable_units) + ' durable (' + num(inc.durable_value) + ' gp)');
      if (inc.resource_units) marks.push(num(inc.resource_units) + ' resource');
      if (inc.review_status && inc.review_status !== 'open') marks.push(REVIEW_LABEL[inc.review_status]);
      if (inc.restored_since) marks.push('restored since');
      else if (!inc.history_id) marks.push('no snapshot');
      entries.push({
        value: String(inc.id),
        label: when(inc.created_at) + ' · ' + (inc.username || 'unknown') + ' #' + inc.character_id,
        meta: marks.join(' · '),
      });
    }
    fillList('incidents', entries, selectedIncident === null ? null : String(selectedIncident), pickIncident);
  }

  function selectedIncidentRow(){
    for (var i = 0; i < incidents.length; i++) if (incidents[i].id === selectedIncident) return incidents[i];
    return null;
  }

  function pickIncident(e){
    var id = Number(e.currentTarget.getAttribute('data-value'));
    var inc = null;
    for (var i = 0; i < incidents.length; i++) if (incidents[i].id === id) inc = incidents[i];
    if (!inc) return;
    selectedIncident = id;
    renderIncidents();

    var rows = [
      ['When', when(inc.created_at)],
      ['Character', (inc.username || 'unknown') + '  #' + inc.character_id],
      ['Owner', inc.owner_id === null ? '—' : String(inc.owner_id)],
      ['Written by', inc.source || '—'],
      ['Tripped', inc.reasons.length ? inc.reasons.join(', ') : '—'],
      ['Save revision', inc.previous_revision + ' → ' + inc.next_revision],
      ['Durable lost', num(inc.durable_units) + '  (' + num(inc.durable_value) + ' gp)'],
      ['Resources lost', num(inc.resource_units) + '  (' + num(inc.resource_value) + ' gp)'],
      ['Coins lost', num(inc.coins_lost)],
      ['Charges lost', num(inc.charges_lost)],
      ['Distinct items', num(inc.distinct_items_lost)],
      ['Incidents on this account', num(inc.character_incident_count)],
      ['Restored since', inc.restored_since ? 'yes' : 'no'],
      ['Verdict', REVIEW_LABEL[inc.review_status] + (inc.reviewed_at ? ' · ' + when(inc.reviewed_at) : '')],
    ];
    if (inc.review_note) rows.push(['Verdict note', inc.review_note]);
    for (var j = 0; j < inc.items.length; j++){
      rows.push(['· ' + inc.items[j].itemId, num(inc.items[j].lost) + '  (' + num(inc.items[j].value) + ' gp)']);
    }
    ledgerRows('incident-detail-body', rows);
    $('incident-note').value = inc.review_note || '';
    $('incident-reopen-btn').hidden = inc.review_status === 'open';
    $('incident-detail').hidden = false;
    $('incident-msg').hidden = true;
    $('incident-open-btn').textContent = 'Open ' + (inc.username || '#' + inc.character_id) + ' in Player actions';
  }

  /** The handoff the server view exists for: carry the incident's character —
   * and the snapshot that undoes it — into the player scope. Deliberately a
   * press rather than a side effect of selecting a row: switching scope under
   * someone reading a list is how the wrong account gets restored. */
  function openIncidentInPlayer(){
    var inc = selectedIncidentRow();
    if (!inc) return message($('incident-msg'), 'err', 'Choose an incident first.');
    selectedCharacter = String(inc.character_id);
    $('character-filter').value = '';
    setView('player');
    setPane('salvage');
    refreshLists();
    loadSnapshots(inc.history_id || 0);
    if (!inc.history_id){
      message($('restore-msg'), 'err', 'No snapshot was preserved at revision ' + inc.previous_revision + ' — pick the nearest one below by hand.');
    }
  }

  function setView(next){
    view = next;
    $('tab-player').setAttribute('aria-selected', String(next === 'player'));
    $('tab-server').setAttribute('aria-selected', String(next === 'server'));
    $('view-player').hidden = next !== 'player';
    $('view-server').hidden = next !== 'server';
    $('scope-lore').textContent = next === 'player'
      ? 'Everything below acts on one character. Choose them first.'
      : 'Across every account. Filing a verdict is the only write here — nothing touches a save.';
    // Opening the tab IS the request to see the queue — landing on an empty
    // panel with a button on it is a step with no decision in it. Once only:
    // after that the list is whatever the admin last loaded or filtered.
    if (next === 'server' && incidentSummary === null && secret) loadIncidents();
  }

  function setPane(next){
    pane = next;
    $('pane-grant-tab').setAttribute('aria-selected', String(next === 'grant'));
    $('pane-salvage-tab').setAttribute('aria-selected', String(next === 'salvage'));
    $('pane-grant').hidden = next !== 'grant';
    $('pane-salvage').hidden = next !== 'salvage';
  }

  /** The name every action in this view is about to hit, kept on screen above
   * them — a grant and a restore are both irreversible for whoever is on the
   * receiving end, and the picker scrolls out of sight. */
  function renderPlayerScope(){
    var chosen = null;
    for (var i = 0; i < catalog.characters.length; i++){
      if (String(catalog.characters[i].id) === String(selectedCharacter)) chosen = catalog.characters[i];
    }
    $('player-empty').hidden = !!selectedCharacter;
    $('player-actions').hidden = !selectedCharacter;
    if (!selectedCharacter) return;
    var el = $('player-scope');
    el.textContent = '';
    el.appendChild(document.createTextNode('Acting on '));
    var strong = document.createElement('strong');
    strong.textContent = chosen ? chosen.username + ' (#' + chosen.id + ')' : '#' + selectedCharacter;
    el.appendChild(strong);
    var marks = [];
    if (chosen && chosen.isIronman) marks.push('ironman');
    if (chosen && chosen.isOneLife) marks.push('one life');
    if (chosen) marks.push('total level ' + chosen.totalLevel);
    if (marks.length) el.appendChild(document.createTextNode(' — ' + marks.join(' · ')));
  }

  function snapshotNow(){
    var msg = $('restore-msg');
    msg.hidden = true;
    var characterId = Number(selectedCharacter);
    if (!characterId) return message(msg, 'err', 'Choose a character first.');
    var btn = $('snapshot-now-btn');
    btn.disabled = true;
    fetch('/api/admin/snapshot-save', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ character_id: characterId, reason: 'admin portal' }),
    }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(body){
        return { status: res.status, body: body };
      });
    }).then(function(r){
      if (r.status === 401) return lock('That secret is no longer valid. Enter it again.');
      if (r.status >= 400 || !r.body || !r.body.ok) return message(msg, 'err', errorText(r.status, r.body));
      // Re-list so the new row is on screen and immediately restorable. It
      // clears the panel (restore-msg included), so the receipt goes after it.
      loadSnapshots();
      message(msg, 'ok', 'Snapshot taken at save revision ' + num(r.body.save_revision) + '.');
    }).catch(function(){
      message(msg, 'err', 'Could not reach the server.');
    }).then(function(){ btn.disabled = false; });
  }

  function renderSnapshots(){
    var entries = [];
    for (var i = 0; i < snapshots.length; i++){
      var snap = snapshots[i];
      entries.push({
        value: String(snap.id),
        label: when(snap.created_at),
        meta: snap.reason + ' · rev ' + snap.save_revision,
      });
    }
    fillList('snapshots', entries, selectedSnapshot === null ? null : String(selectedSnapshot), pickSnapshot);
  }

  function pickSnapshot(e){
    selectSnapshot(Number(e.currentTarget.getAttribute('data-value')));
  }

  function selectSnapshot(id){
    selectedSnapshot = id;
    renderSnapshots();
    var msg = $('restore-msg');
    msg.hidden = true;
    adminGet('/api/admin/restore-save?character_id=' + Number(selectedCharacter) + '&history_id=' + id, function(body){
      var snap = body.snapshot || {};
      var loss = body.lost_since_snapshot || {};
      var holdings = snap.holdings || {};
      $('snapshot-chosen').textContent = 'Snapshot #' + snap.id + ' — ' + when(snap.created_at) +
        ', holding ' + num(holdings.distinctItems || 0) + ' distinct items';
      var rows = [
        ['Durable items', num(loss.durableUnits || 0) + '  (' + num(loss.durableValue || 0) + ' gp)'],
        ['Resources', num(loss.resourceUnits || 0) + '  (' + num(loss.resourceValue || 0) + ' gp)'],
        ['Coins', num(loss.coinsLost || 0)],
        ['Charges', num(loss.chargesLost || 0)],
      ];
      var top = loss.items || [];
      for (var i = 0; i < top.length; i++){
        rows.push(['· ' + top[i].itemId, num(top[i].lost)]);
      }
      ledgerRows('snapshot-detail-body', rows);
      $('snapshot-detail').hidden = false;
    }, msg);
  }

  function restore(dryRun){
    var msg = $('restore-msg');
    msg.hidden = true;
    if (!selectedSnapshot) return message(msg, 'err', 'Choose a snapshot.');
    if (!dryRun && !window.confirm('Overwrite this character\\'s live save with the snapshot? Everything gained since is discarded.')) return;
    $('restore-preview-btn').disabled = true;
    $('restore-btn').disabled = true;
    fetch('/api/admin/restore-save', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        character_id: Number(selectedCharacter),
        history_id: selectedSnapshot,
        dry_run: !!dryRun,
        reason: 'admin portal',
      }),
    }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(body){
        return { status: res.status, body: body };
      });
    }).then(function(r){
      if (r.status === 401) return lock('That secret is no longer valid. Enter it again.');
      if (r.status >= 400 || !r.body || !r.body.ok) return message(msg, 'err', errorText(r.status, r.body));
      var restores = r.body.restores || {};
      var discards = r.body.discards || {};
      var summary = 'restores ' + num(restores.durableUnits || 0) + ' durable / ' +
        num(restores.resourceUnits || 0) + ' resource units, discards ' +
        num(discards.durableUnits || 0) + ' / ' + num(discards.resourceUnits || 0);
      if (dryRun) return message(msg, 'ok', 'Preview only — nothing written. This would ' + summary + '.');
      loadSnapshots();
      message(msg, 'ok', 'Restored (' + summary + '). The player must reload the game to pull it.');
    }).catch(function(){
      message(msg, 'err', 'Could not reach the server.');
    }).then(function(){
      $('restore-preview-btn').disabled = false;
      $('restore-btn').disabled = false;
    });
  }

  function errorText(status, body){
    if (body && body.error) return body.error + (body.code ? '  (' + body.code + ')' : '');
    return 'Request failed with status ' + status + '.';
  }

  function grant(dryRun){
    var msg = $('form-msg');
    msg.hidden = true;
    $('receipt').hidden = true;
    var characterId = Number(selectedCharacter);
    var itemId = selectedItem;
    var quantity = Math.floor(Number($('quantity').value));
    if (!characterId) return message(msg, 'err', 'Choose a character.');
    if (!itemId) return message(msg, 'err', 'Choose an item.');
    if (!(quantity >= 1)) return message(msg, 'err', 'Quantity must be at least 1.');

    var form = $('grant-form');
    form.classList.add('spin');
    $('preview-btn').disabled = true;
    $('grant-btn').disabled = true;

    fetch('/api/admin/grant-item', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        character_id: characterId,
        item_id: itemId,
        quantity: quantity,
        destination: destination,
        noted: noted,
        dry_run: !!dryRun,
        reason: 'admin portal',
      }),
    }).then(function(res){
      return res.json().catch(function(){ return null; }).then(function(body){
        return { status: res.status, body: body };
      });
    }).then(function(r){
      if (r.status === 401) return lock('That secret is no longer valid. Enter it again.');
      if (r.status >= 400 || !r.body || !r.body.ok) return message(msg, 'err', errorText(r.status, r.body));
      renderReceipt(r.body, !!dryRun);
      if (!dryRun) message(msg, 'ok', 'Granted. The player must reload the game to pull the new save.');
    }).catch(function(){
      message(msg, 'err', 'Could not reach the server.');
    }).then(function(){
      form.classList.remove('spin');
      $('preview-btn').disabled = false;
      $('grant-btn').disabled = false;
    });
  }

  function unlock(){
    // Trimmed so what the "not stored" hint implies matches what actually gets
    // compared — the header itself is auto-trimmed by fetch() regardless.
    var entered = $('secret').value.trim();
    var msg = $('gate-msg');
    msg.hidden = true;
    if (!entered) return message(msg, 'err', 'Enter the admin secret.');
    var btn = $('unlock-btn');
    btn.disabled = true;
    secret = entered;

    fetch('/api/admin/catalog', { headers: { 'X-Admin-Secret': secret } })
      .then(function(res){
        return res.json().catch(function(){ return null; }).then(function(body){
          return { status: res.status, body: body };
        });
      })
      .then(function(r){
        if (r.status === 401){
          secret = null;
          return message(msg, 'err', 'That secret was refused.');
        }
        if (r.status >= 400 || !r.body || !r.body.ok){
          secret = null;
          return message(msg, 'err', errorText(r.status, r.body));
        }
        catalog = { items: r.body.items || [], characters: r.body.characters || [] };
        $('secret').value = '';
        $('gate').hidden = true;
        $('portal').hidden = false;
        setView('player');
        setPane('grant');
        refreshLists();
        if (r.body.truncated) message($('form-msg'), 'err', 'Character list was truncated — use the filter to find the account.');
        $('character-filter').focus();
      })
      .catch(function(){
        secret = null;
        message(msg, 'err', 'Could not reach the server.');
      })
      .then(function(){ btn.disabled = false; });
  }

  function setDestination(next){
    destination = next;
    $('dest-inventory').setAttribute('aria-pressed', String(next === 'inventory'));
    $('dest-bank').setAttribute('aria-pressed', String(next === 'bank'));
  }
  function setNoted(next){
    noted = next;
    $('noted-off').setAttribute('aria-pressed', String(!next));
    $('noted-on').setAttribute('aria-pressed', String(next));
  }

  document.addEventListener('DOMContentLoaded', function(){
    $('unlock-btn').addEventListener('click', unlock);
    $('secret').addEventListener('keydown', function(e){ if (e.key === 'Enter') unlock(); });
    $('lock-btn').addEventListener('click', function(){ lock(null); });
    $('item-filter').addEventListener('input', refreshLists);
    $('character-filter').addEventListener('input', refreshLists);
    $('preview-btn').addEventListener('click', function(){ grant(true); });
    $('grant-btn').addEventListener('click', function(){ grant(false); });
    $('tab-player').addEventListener('click', function(){ setView('player'); });
    $('tab-server').addEventListener('click', function(){ setView('server'); });
    $('pane-grant-tab').addEventListener('click', function(){ setPane('grant'); });
    $('pane-salvage-tab').addEventListener('click', function(){ setPane('salvage'); });
    $('incidents-btn').addEventListener('click', loadIncidents);
    $('incident-filter').addEventListener('input', renderIncidents);
    $('incident-open-btn').addEventListener('click', openIncidentInPlayer);
    // The verdict decides which rows the server returns, so changing it is a
    // re-list, not a client-side filter over what is already on screen.
    $('incident-review').addEventListener('click', function(e){
      var next = e.target && e.target.getAttribute && e.target.getAttribute('data-review');
      if (!next || next === incidentReview) return;
      markReviewFilter(next);
      loadIncidents();
    });
    $('incident-dismiss-btn').addEventListener('click', function(){ reviewIncident('dismissed'); });
    $('incident-confirm-btn').addEventListener('click', function(){ reviewIncident('confirmed'); });
    $('incident-reopen-btn').addEventListener('click', function(){ reviewIncident('open'); });
    $('snapshots-btn').addEventListener('click', function(){ loadSnapshots(); });
    $('snapshot-now-btn').addEventListener('click', snapshotNow);
    $('restore-preview-btn').addEventListener('click', function(){ restore(true); });
    $('restore-btn').addEventListener('click', function(){ restore(false); });
    $('dest-inventory').addEventListener('click', function(){ setDestination('inventory'); });
    $('dest-bank').addEventListener('click', function(){ setDestination('bank'); });
    $('noted-off').addEventListener('click', function(){ setNoted(false); });
    $('noted-on').addEventListener('click', function(){ setNoted(true); });
    var chips = document.querySelectorAll('#quantity-chips button');
    for (var i = 0; i < chips.length; i++){
      chips[i].addEventListener('click', function(e){
        $('quantity').value = e.currentTarget.getAttribute('data-qty');
      });
    }
    $('secret').focus();
  });
})();
`

const BODY = `
<div class="wrap">

  <section id="gate" class="gate">
    <div class="fm-frame">
      <span class="rivet rivet--bl"></span><span class="rivet rivet--br"></span>
      <div class="fm-parch">
        <img class="gate__seal" src="/public/forge/wax-seal.svg" alt="" aria-hidden="true">
        <p class="fm-eyebrow">PocketRPG</p>
        <h1 class="fm-banner gate__banner">Quartermaster</h1>
        <p class="fm-lore">The stores are sealed. Only the bearer of the seal may open the ledger.</p>
        <div class="field">
          <label for="secret">Admin secret</label>
          <input id="secret" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="•••••••••••••••••">
          <p class="field__hint">Held in this tab only — never stored. Reloading re-seals the door.</p>
        </div>
        <div class="actions">
          <button id="unlock-btn" type="button" class="fm-btn fm-btn--ember fm-btn--lg">Break the seal</button>
        </div>
        <p id="gate-msg" class="msg" hidden></p>
      </div>
    </div>
  </section>

  <main id="portal" hidden>
    <div class="fm-frame">
      <span class="rivet rivet--bl"></span><span class="rivet rivet--br"></span>
      <div class="fm-parch">
        <div class="crest">
          <div>
            <p class="fm-eyebrow">PocketRPG · Stores</p>
            <h1 class="fm-banner portal__banner">Quartermaster's Ledger</h1>
          </div>
          <button id="lock-btn" type="button" class="fm-btn">Seal</button>
        </div>

        <nav class="tabs" role="tablist" aria-label="Scope">
          <button id="tab-player" type="button" role="tab" aria-selected="true" aria-controls="view-player">Player</button>
          <button id="tab-server" type="button" role="tab" aria-selected="false" aria-controls="view-server">Server</button>
        </nav>
        <p class="fm-lore" id="scope-lore"></p>

        <section id="view-player" role="tabpanel" aria-labelledby="tab-player">
          <div class="fm-rule-head"><span>Character</span></div>
          <div class="field">
            <label for="character-filter">Who</label>
            <input id="character-filter" class="filter" type="text" autocomplete="off" spellcheck="false" placeholder="Filter by name or id…">
            <div id="character" class="picklist" role="listbox" aria-label="Character"></div>
            <p class="chosen" id="character-chosen"></p>
            <p class="field__hint" id="character-count"></p>
          </div>

          <p id="player-empty" class="scope scope--idle">No character chosen. Pick one above to unlock their actions.</p>

          <div id="player-actions" hidden>
            <p id="player-scope" class="scope"></p>

            <nav class="subnav" role="tablist" aria-label="Player action">
              <button id="pane-grant-tab" type="button" role="tab" aria-selected="true" aria-controls="pane-grant">Grant</button>
              <button id="pane-salvage-tab" type="button" role="tab" aria-selected="false" aria-controls="pane-salvage">Salvage</button>
            </nav>

            <section id="pane-grant" role="tabpanel" aria-labelledby="pane-grant-tab">
              <div id="grant-form">
                <div class="fm-rule-head"><span>Goods</span></div>
                <div class="field">
                  <label for="item-filter">Item</label>
                  <input id="item-filter" class="filter" type="text" autocomplete="off" spellcheck="false" placeholder="Filter by name or id…">
                  <div id="item" class="picklist" role="listbox" aria-label="Item"></div>
                  <p class="chosen" id="item-chosen"></p>
                  <p class="field__hint" id="item-count"></p>
                </div>

                <div class="field">
                  <label for="quantity">Quantity</label>
                  <input id="quantity" type="number" min="1" max="1000000000" step="1" value="1" class="fm-num-input">
                  <div class="chips" id="quantity-chips">
                    <button type="button" data-qty="1">1</button>
                    <button type="button" data-qty="10">10</button>
                    <button type="button" data-qty="100">100</button>
                    <button type="button" data-qty="1000">1K</button>
                    <button type="button" data-qty="100000">100K</button>
                    <button type="button" data-qty="1000000">1M</button>
                  </div>
                </div>

                <div class="fm-rule-head"><span>Delivery</span></div>
                <div class="field">
                  <label>Destination</label>
                  <div class="row">
                    <div class="fm-toggle" role="group" aria-label="Destination">
                      <button id="dest-inventory" type="button" aria-pressed="true">Inventory</button>
                      <button id="dest-bank" type="button" aria-pressed="false">Bank</button>
                    </div>
                  </div>
                  <p class="field__hint">Non-stackable items take one inventory slot each — send bulk to the bank, or note it.</p>
                </div>

                <div class="field">
                  <label>Noted</label>
                  <div class="row">
                    <div class="fm-toggle" role="group" aria-label="Noted">
                      <button id="noted-off" type="button" aria-pressed="true">Item</button>
                      <button id="noted-on" type="button" aria-pressed="false">Noted</button>
                    </div>
                  </div>
                </div>

                <div class="actions">
                  <button id="preview-btn" type="button" class="fm-btn fm-btn--brass">Preview</button>
                  <button id="grant-btn" type="button" class="fm-btn fm-btn--ember">Grant</button>
                </div>
                <p id="form-msg" class="msg" hidden></p>
              </div>

              <div id="receipt" hidden>
                <div class="fm-rule-head"><span>Ledger entry</span></div>
                <p><span id="receipt-tag" class="fm-tag"></span></p>
                <table class="fm-ledger">
                  <thead><tr><th>Entry</th><th>Value</th></tr></thead>
                  <tbody id="receipt-body"></tbody>
                </table>
              </div>
            </section>

            <section id="pane-salvage" role="tabpanel" aria-labelledby="pane-salvage-tab" hidden>
              <div class="fm-rule-head"><span>Salvage</span></div>
              <p class="fm-lore">Pull this character's save back out of the vault, from before whatever went missing.</p>
              <div class="field">
                <div class="actions">
                  <button id="snapshots-btn" type="button" class="fm-btn fm-btn--brass">Find snapshots</button>
                  <button id="snapshot-now-btn" type="button" class="fm-btn">Snapshot now</button>
                </div>
                <p class="field__hint" id="snapshot-count"></p>
                <div id="snapshots" class="picklist" role="listbox" aria-label="Snapshot"></div>
                <p class="chosen" id="snapshot-chosen"></p>
              </div>
              <div id="snapshot-detail" hidden>
                <table class="fm-ledger">
                  <thead><tr><th>Lost since this snapshot</th><th>Value</th></tr></thead>
                  <tbody id="snapshot-detail-body"></tbody>
                </table>
                <div class="actions">
                  <button id="restore-preview-btn" type="button" class="fm-btn fm-btn--brass">Preview restore</button>
                  <button id="restore-btn" type="button" class="fm-btn fm-btn--ember">Restore</button>
                </div>
              </div>
              <p id="restore-msg" class="msg" hidden></p>
            </section>
          </div>
        </section>

        <section id="view-server" role="tabpanel" aria-labelledby="tab-server" hidden>
          <div class="fm-rule-head"><span>Item-loss incidents</span></div>
          <p class="fm-lore">Every loss the guard has caught, across every account. Find one, then take it to that player's salvage — or file it as noise, so what is left is what matters.</p>
          <div class="field">
            <div class="actions">
              <button id="incidents-btn" type="button" class="fm-btn fm-btn--brass">Load incidents</button>
            </div>
            <div class="tabs" role="group" id="incident-review" aria-label="Verdict">
              <button type="button" data-review="active" aria-pressed="true">Open</button>
              <button type="button" data-review="confirmed" aria-pressed="false">Confirmed</button>
              <button type="button" data-review="dismissed" aria-pressed="false">Dismissed</button>
              <button type="button" data-review="all" aria-pressed="false">All</button>
            </div>
            <label for="incident-filter">Search</label>
            <input id="incident-filter" class="filter" type="text" autocomplete="off" spellcheck="false" placeholder="Filter by character name or id…">
            <p class="field__hint" id="incident-summary"></p>
            <div id="incidents" class="picklist" role="listbox" aria-label="Incident"></div>
            <p id="incident-msg" class="msg" hidden></p>
          </div>
          <div id="incident-detail" hidden>
            <table class="fm-ledger">
              <thead><tr><th>What went missing</th><th>Value</th></tr></thead>
              <tbody id="incident-detail-body"></tbody>
            </table>
            <div class="field">
              <label for="incident-note">Why (optional — kept with the verdict)</label>
              <input id="incident-note" class="filter" type="text" autocomplete="off" spellcheck="false" maxlength="200" placeholder="e.g. loadout preset swap, not a loss">
            </div>
            <div class="actions">
              <button id="incident-open-btn" type="button" class="fm-btn fm-btn--ember">Open in Player actions</button>
            </div>
            <div class="actions">
              <button id="incident-confirm-btn" type="button" class="fm-btn fm-btn--brass">Confirm real loss</button>
              <button id="incident-dismiss-btn" type="button" class="fm-btn">Not an incident</button>
              <button id="incident-reopen-btn" type="button" class="fm-btn" hidden>Reopen</button>
            </div>
          </div>
        </section>
      </div>
    </div>
  </main>

</div>
<p class="foot">Every grant and every restore is written to the audit log</p>
`

export function renderPortalPage() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="dark">
<title>PocketRPG · Quartermaster</title>
<style>${STYLES}</style>
</head>
<body>
${BODY}
<script>${SCRIPT}</script>
</body>
</html>`
}
