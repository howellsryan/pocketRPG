/* PocketRPG — world map prototype logic (vanilla). */
(function () {
  const W = window.WORLD;
  const LS = 'prpg.world.loc';
  const $ = (s, r = document) => r.querySelector(s);

  // ── state ──────────────────────────────────────────────────────────
  let here = localStorage.getItem(LS) || 'emberhold';
  if (!W.places[here]) here = 'emberhold';
  let view = { x: 0, y: 0, k: 1 };
  let travelling = false;
  let travelRAF = null;

  // ── adjacency map for pathfinding ──────────────────────────────────
  const adj = {};
  Object.keys(W.places).forEach(id => (adj[id] = []));
  W.edges.forEach(([a, b, t]) => { adj[a].push([b, t]); adj[b].push([a, t]); });

  function shortestPath(from, to) {
    if (from === to) return { path: [from], ticks: 0 };
    const dist = {}, prev = {}, seen = {};
    Object.keys(W.places).forEach(id => (dist[id] = Infinity));
    dist[from] = 0;
    while (true) {
      let u = null, best = Infinity;
      for (const id in dist) if (!seen[id] && dist[id] < best) { best = dist[id]; u = id; }
      if (u === null) break;
      if (u === to) break;
      seen[u] = 1;
      for (const [v, t] of adj[u]) if (dist[u] + t < dist[v]) { dist[v] = dist[u] + t; prev[v] = u; }
    }
    if (dist[to] === Infinity) return null;
    const path = [to]; let c = to;
    while (c !== from) { c = prev[c]; path.unshift(c); }
    return { path, ticks: dist[to] };
  }

  // ── build the board ────────────────────────────────────────────────
  const board = $('#board');
  const chart = $('.board__chart');
  const routes = $('#routes');
  chart.style.width = W.board.w + 'px';
  chart.style.height = W.board.h + 'px';
  routes.setAttribute('width', W.board.w);
  routes.setAttribute('height', W.board.h);
  routes.style.width = W.board.w + 'px';
  routes.style.height = W.board.h + 'px';

  // routes (under nodes)
  const NS = 'http://www.w3.org/2000/svg';
  W.edges.forEach(([a, b, t]) => {
    const pa = W.places[a], pb = W.places[b];
    const line = document.createElementNS(NS, 'line');
    line.setAttribute('x1', pa.x); line.setAttribute('y1', pa.y);
    line.setAttribute('x2', pb.x); line.setAttribute('y2', pb.y);
    line.setAttribute('stroke', '#7c5c2a');
    line.setAttribute('stroke-width', '3');
    line.setAttribute('stroke-dasharray', '2 9');
    line.setAttribute('stroke-linecap', 'round');
    line.setAttribute('opacity', '0.85');
    routes.appendChild(line);
    // tick label at midpoint
    const mx = (pa.x + pb.x) / 2, my = (pa.y + pb.y) / 2;
    const txt = `${t}t`;
    const w = txt.length * 8 + 12;
    const bg = document.createElementNS(NS, 'rect');
    bg.setAttribute('x', mx - w / 2); bg.setAttribute('y', my - 12);
    bg.setAttribute('width', w); bg.setAttribute('height', 22);
    bg.setAttribute('rx', 4); bg.setAttribute('class', 'route-tick-bg');
    bg.setAttribute('stroke', '#b6a079'); bg.setAttribute('stroke-width', '1');
    routes.appendChild(bg);
    const label = document.createElementNS(NS, 'text');
    label.setAttribute('x', mx); label.setAttribute('y', my + 4);
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('class', 'route-tick');
    label.textContent = txt;
    routes.appendChild(label);
  });

  // nodes
  Object.entries(W.places).forEach(([id, p]) => {
    const tier = W.tiers[p.tier];
    const btn = document.createElement('button');
    btn.className = 'node' + (id === here ? ' node--here' : '');
    btn.dataset.id = id;
    btn.style.left = p.x + 'px';
    btn.style.top = p.y + 'px';
    btn.style.setProperty('--node-accent', p.accent);
    const sz = tier.size;
    btn.innerHTML = `
      <div class="node__medal" style="width:${sz}px;height:${sz}px">
        <div class="node__face">
          <i data-icon="${p.icon}" data-color="${cssVar(p.accent)}" data-size="${Math.round(sz * 0.42)}"></i>
        </div>
      </div>
      <div class="node__plate">
        <span class="node__name">${p.name}</span>
        <span class="node__tier">${tier.label}</span>
      </div>`;
    btn.addEventListener('click', (e) => { e.stopPropagation(); onNodeClick(id); });
    board.appendChild(btn);
  });

  // traveller token
  const tok = document.createElement('div');
  tok.id = 'traveller';
  tok.innerHTML = '<i data-icon="sprint" data-color="#2a0f02" data-size="16"></i>';
  board.appendChild(tok);

  if (window.PRPGfillIcons) window.PRPGfillIcons();

  function cssVar(v) {
    // resolve var(--x) to a hex for the inline icon injector
    const m = /var\((--[\w-]+)\)/.exec(v);
    if (!m) return v;
    return getComputedStyle(document.documentElement).getPropertyValue(m[1]).trim() || '#b08842';
  }

  // ── view transform / pan / zoom ────────────────────────────────────
  function applyView() {
    board.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.k})`;
  }
  function clampView() {
    view.k = Math.max(0.35, Math.min(2.2, view.k));
  }
  function centerOn(id, k) {
    const p = W.places[id];
    const stage = $('.stage');
    if (k != null) view.k = k;
    clampView();
    view.x = stage.clientWidth / 2 - p.x * view.k;
    view.y = stage.clientHeight / 2 - p.y * view.k;
    applyView();
  }
  function fitAll() {
    const stage = $('.stage');
    const pad = 90;
    const kx = (stage.clientWidth - pad * 2) / W.board.w;
    const ky = (stage.clientHeight - pad * 2) / W.board.h;
    view.k = Math.max(0.35, Math.min(1, Math.min(kx, ky)));
    view.x = (stage.clientWidth - W.board.w * view.k) / 2;
    view.y = (stage.clientHeight - W.board.h * view.k) / 2;
    applyView();
  }

  const stage = $('.stage');
  let drag = null;
  stage.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.node')) return;
    drag = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: 0 };
    stage.classList.add('grabbing');
    stage.setPointerCapture(e.pointerId);
  });
  stage.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    drag.moved += Math.abs(dx) + Math.abs(dy);
    view.x = drag.vx + dx; view.y = drag.vy + dy;
    applyView();
  });
  const endDrag = () => { drag = null; stage.classList.remove('grabbing'); };
  stage.addEventListener('pointerup', endDrag);
  stage.addEventListener('pointercancel', endDrag);
  stage.addEventListener('pointerleave', endDrag);

  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    const rect = stage.getBoundingClientRect();
    const mx = e.clientX - rect.left, my = e.clientY - rect.top;
    const wx = (mx - view.x) / view.k, wy = (my - view.y) / view.k;
    view.k *= e.deltaY < 0 ? 1.12 : 0.89;
    clampView();
    view.x = mx - wx * view.k; view.y = my - wy * view.k;
    applyView();
  }, { passive: false });

  function zoomBy(f) {
    const stage = $('.stage');
    const cx = stage.clientWidth / 2, cy = stage.clientHeight / 2;
    const wx = (cx - view.x) / view.k, wy = (cy - view.y) / view.k;
    view.k *= f; clampView();
    view.x = cx - wx * view.k; view.y = cy - wy * view.k; applyView();
  }
  $('#zin').addEventListener('click', () => zoomBy(1.25));
  $('#zout').addEventListener('click', () => zoomBy(0.8));
  $('#zfit').addEventListener('click', fitAll);

  // ── node click → travel or open ────────────────────────────────────
  function onNodeClick(id) {
    if (drag && drag.moved > 6) return;
    if (travelling) return;
    if (id === here) { openHub(id); return; }
    startTravel(id);
  }

  // ── travel ─────────────────────────────────────────────────────────
  const travelbar = $('.travelbar');
  function startTravel(dest) {
    const res = shortestPath(here, dest);
    if (!res) return;
    travelling = true;
    const totalTicks = res.ticks;
    const totalMs = totalTicks * W.msPerTick;
    // banner
    travelbar.classList.add('on');
    $('#tv-lead').innerHTML = `Travelling to <b>${W.places[dest].name}</b>`;
    $('#tv-ticks').textContent = `0 / ${totalTicks} ticks`;
    $('#tv-route').textContent = 'Route: ' + res.path.map(p => W.places[p].name).join(' → ');
    $('#tv-fill').style.width = '0%';
    tok.classList.add('on');

    // build cumulative leg distances for token interpolation
    const legs = [];
    for (let i = 0; i < res.path.length - 1; i++) {
      const a = W.places[res.path[i]], b = W.places[res.path[i + 1]];
      const t = adj[res.path[i]].find(([v]) => v === res.path[i + 1])[1];
      legs.push({ a, b, t });
    }
    centerOn(here, Math.max(view.k, 0.7));

    const t0 = performance.now();
    function step(now) {
      let el = now - t0;
      if (el > totalMs) el = totalMs;
      const frac = totalMs ? el / totalMs : 1;
      const doneTicks = Math.round(frac * totalTicks);
      $('#tv-ticks').textContent = `${doneTicks} / ${totalTicks} ticks`;
      $('#tv-fill').style.width = (frac * 100) + '%';
      // position token along legs
      let travelled = frac * totalTicks, acc = 0, placed = false;
      for (const lg of legs) {
        if (travelled <= acc + lg.t) {
          const f = (travelled - acc) / lg.t;
          tok.style.left = (lg.a.x + (lg.b.x - lg.a.x) * f) + 'px';
          tok.style.top = (lg.a.y + (lg.b.y - lg.a.y) * f) + 'px';
          placed = true; break;
        }
        acc += lg.t;
      }
      if (!placed) { const last = legs[legs.length - 1].b; tok.style.left = last.x + 'px'; tok.style.top = last.y + 'px'; }
      // keep camera gently following
      const stg = $('.stage');
      const tx = parseFloat(tok.style.left), ty = parseFloat(tok.style.top);
      view.x = stg.clientWidth / 2 - tx * view.k;
      view.y = stg.clientHeight / 2 - ty * view.k;
      applyView();

      if (el < totalMs) { travelRAF = requestAnimationFrame(step); }
      else { arrive(dest); }
    }
    travelRAF = requestAnimationFrame(step);
  }

  function arrive(dest) {
    travelling = false;
    tok.classList.remove('on');
    travelbar.classList.remove('on');
    setHere(dest);
    toast(`Arrived at ${W.places[dest].name}`);
    openHub(dest);
  }

  $('#tv-cancel').addEventListener('click', () => {
    if (!travelling) return;
    cancelAnimationFrame(travelRAF);
    travelling = false;
    tok.classList.remove('on');
    travelbar.classList.remove('on');
    toast('Travel cancelled');
  });

  function setHere(id) {
    here = id;
    localStorage.setItem(LS, id);
    document.querySelectorAll('.node').forEach(n => n.classList.toggle('node--here', n.dataset.id === id));
    $('#loc-name').textContent = W.places[id].name;
  }

  // ── place hub ──────────────────────────────────────────────────────
  const scrim = $('#scrim');
  const hub = $('#hub');
  function openHub(id) {
    const p = W.places[id];
    const tier = W.tiers[p.tier];
    $('#hub-tier').innerHTML = `<i data-icon="${p.icon}" data-color="#ffffff" data-size="12"></i> ${tier.label}`;
    $('#hub-name').textContent = p.name;
    $('#hub-sub').textContent = p.sub;
    $('#hub-lore').textContent = p.lore;
    // banner art slot (user can drop their own)
    $('#hub-banner').innerHTML =
      `<div class="hub__bannerwrap"><image-slot id="banner-${id}" shape="rect" fit="cover" placeholder="Drop art for ${p.name}"></image-slot></div>`;
    // activities
    const list = $('#hub-acts');
    list.innerHTML = '';
    p.activities.forEach(a => {
      const k = W.kinds[a.t];
      const el = document.createElement('button');
      el.className = 'act';
      el.innerHTML = `
        <span class="act__icon"><i data-icon="${a.icon}" data-color="${cssVar(p.accent)}" data-size="22"></i></span>
        <span class="act__main">
          <span class="act__name">${a.name}</span>
          <span class="act__note">${a.note}</span>
        </span>
        <span class="act__right">
          <span class="act__lvl">${a.lvl}</span>
          <span class="tag tag--${k.cls}">${k.label}</span>
        </span>`;
      el.addEventListener('click', () => toast(`${k.label}: ${a.name}`));
      list.appendChild(el);
    });
    $('#hub-tierblurb').textContent = tier.blurb;
    if (window.PRPGfillIcons) window.PRPGfillIcons();
    scrim.classList.add('on');
    hub.classList.add('on');
  }
  function closeHub() { scrim.classList.remove('on'); hub.classList.remove('on'); }
  $('#hub-close').addEventListener('click', closeHub);
  scrim.addEventListener('click', closeHub);

  // ── toast ──────────────────────────────────────────────────────────
  let toastT = null;
  function toast(msg) {
    const t = $('#toast');
    $('#toast-msg').textContent = msg;
    t.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(() => t.classList.remove('on'), 1900);
  }

  // ── boot ───────────────────────────────────────────────────────────
  setHere(here);
  fitAll();
  window.addEventListener('resize', () => { if (!travelling) applyView(); });
})();
