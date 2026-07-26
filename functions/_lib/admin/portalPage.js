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
input[type="text"],input[type="password"],input[type="number"],select{
  width:100%;min-height:44px;padding:10px 12px;
  background:rgba(255,250,232,0.72);color:var(--fm-ink);
  border:1px solid var(--fm-rule);border-radius:var(--fm-r-sm);
  box-shadow:inset 0 1px 3px rgba(74,54,28,0.22);
  font-family:'Spectral',Georgia,serif;font-size:16px;
}
input[type="number"],.fm-num-input{font-family:'Spline Sans Mono',ui-monospace,monospace;font-variant-numeric:tabular-nums}
select{appearance:none;background-image:linear-gradient(45deg,transparent 50%,var(--fm-ink-soft) 50%),linear-gradient(135deg,var(--fm-ink-soft) 50%,transparent 50%);background-position:calc(100% - 18px) 20px,calc(100% - 13px) 20px;background-size:5px 5px,5px 5px;background-repeat:no-repeat;padding-right:36px}
select[size]{appearance:auto;background-image:none;padding-right:12px;min-height:auto}
input:focus-visible,select:focus-visible{outline:2px solid var(--fm-brass);outline-offset:1px}
input::placeholder{color:var(--fm-ink-faint)}
.filter{margin-bottom:6px}
.picklist{height:186px;overflow-y:auto}
.picklist option{padding:7px 8px;font-size:15px}
.picklist option:checked{background:var(--fm-brass) linear-gradient(0deg,var(--fm-brass),var(--fm-brass));color:var(--fm-btn-ink-on)}
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
.actions{display:flex;gap:10px;margin-top:22px}
.actions .fm-btn{flex:1}

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
    $('portal').hidden = true;
    $('gate').hidden = false;
    $('secret').value = '';
    if (reason) message($('gate-msg'), 'err', reason);
    $('secret').focus();
  }

  // Options are built with DOM APIs, never innerHTML: usernames are
  // player-authored text and must never be parsed as markup.
  function fillOptions(select, entries){
    select.textContent = '';
    for (var i = 0; i < entries.length; i++){
      var opt = document.createElement('option');
      opt.value = entries[i].value;
      opt.textContent = entries[i].label;
      if (entries[i].disabled) opt.disabled = true;
      select.appendChild(opt);
    }
  }

  function characterEntries(query){
    var q = query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < catalog.characters.length; i++){
      var c = catalog.characters[i];
      if (q && c.username.toLowerCase().indexOf(q) === -1 && String(c.id) !== q) continue;
      var marks = [];
      if (c.isIronman) marks.push('ironman');
      if (c.isOneLife) marks.push('one life');
      if (!c.hasSave) marks.push('no save');
      out.push({
        value: String(c.id),
        label: c.username + '  #' + c.id + '  · lvl ' + c.totalLevel + (marks.length ? '  · ' + marks.join(', ') : ''),
        disabled: !c.hasSave,
      });
    }
    return out;
  }

  function itemEntries(query){
    var q = query.trim().toLowerCase();
    var out = [];
    for (var i = 0; i < catalog.items.length; i++){
      var it = catalog.items[i];
      if (q && it.name.toLowerCase().indexOf(q) === -1 && it.id.indexOf(q) === -1) continue;
      out.push({ value: it.id, label: it.name + (it.stackable ? '  · stacks' : '') });
    }
    return out;
  }

  function refreshLists(){
    var itemSel = $('item');
    var charSel = $('character');
    var keptItem = itemSel.value;
    var keptChar = charSel.value;
    fillOptions(itemSel, itemEntries($('item-filter').value));
    fillOptions(charSel, characterEntries($('character-filter').value));
    if (keptItem) itemSel.value = keptItem;
    if (keptChar) charSel.value = keptChar;
    $('item-count').textContent = itemSel.options.length + ' of ' + catalog.items.length + ' items';
    $('character-count').textContent = charSel.options.length + ' of ' + catalog.characters.length + ' characters';
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
    var tbody = $('receipt-body');
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
    $('receipt-tag').className = 'fm-tag ' + (dryRun ? 'fm-tag--brass' : 'fm-tag--verdigris');
    $('receipt-tag').textContent = dryRun ? 'Preview only — nothing written' : 'Granted';
    $('receipt').hidden = false;
    $('receipt').scrollIntoView({ block: 'nearest' });
  }

  function errorText(status, body){
    if (body && body.error) return body.error + (body.code ? '  (' + body.code + ')' : '');
    return 'Request failed with status ' + status + '.';
  }

  function grant(dryRun){
    var msg = $('form-msg');
    msg.hidden = true;
    $('receipt').hidden = true;
    var characterId = Number($('character').value);
    var itemId = $('item').value;
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
        <p class="fm-lore">Sign an item out of the stores and into a character's hands.</p>

        <div id="grant-form">
          <div class="fm-rule-head"><span>Recipient</span></div>
          <div class="field">
            <label for="character-filter">Character</label>
            <input id="character-filter" class="filter" type="text" autocomplete="off" spellcheck="false" placeholder="Filter by name or id…">
            <select id="character" class="picklist" size="6" aria-label="Character"></select>
            <p class="field__hint" id="character-count"></p>
          </div>

          <div class="fm-rule-head"><span>Goods</span></div>
          <div class="field">
            <label for="item-filter">Item</label>
            <input id="item-filter" class="filter" type="text" autocomplete="off" spellcheck="false" placeholder="Filter by name or id…">
            <select id="item" class="picklist" size="6" aria-label="Item"></select>
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
      </div>
    </div>
  </main>

</div>
<p class="foot">Every grant is written to the audit log</p>
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
