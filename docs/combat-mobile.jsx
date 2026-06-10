// PocketRPG — Combat (mobile phone app)
const { useState, useEffect, useRef, useMemo } = React;
const { AREAS, STYLES, STYLE_META, FOOD, POTIONS, PRAYERS, WEAPONS, ARMOUR, PLAYER, monsterCount, raidCount } = window.CBT;
const { ItemArt, StyleChip, HpBar, DropTable, StatGrid, Celebration, useCombatSim, artLook, tint, hexA } = window.CBT_CORE;
const { useTweaks, TweaksPanel, TweakSection, TweakRadio, TweakSlider, TweakToggle } = window;

const ICON = window.iconUrl;

/* ───────────────────────── Top toolbar ───────────────────────── */
function TopBar({ hp }) {
  return (
    <div className="cb-top">
      <button className="cb-top__menu" aria-label="Menu"><span /><span /><span /></button>
      <button className="cb-pill cb-pill--skip"><img src={ICON('fast-forward-button', '#7ce88a')} alt="" />Skip 1h</button>
      <button className="cb-pill cb-pill--gem"><img src={ICON('cut-diamond', '#9b6cff')} alt="" />{PLAYER.gems}</button>
      <div className="cb-top__hp">
        <img src={ICON('hearts', '#e8554e')} alt="" />
        <div className="cb-top__hpbar"><HpBar value={hp} max={PLAYER.maxHp} variant="self" height={16} /></div>
      </div>
    </div>
  );
}

/* ───────────────────────── Idle toggle row ───────────────────────── */
function IdleToggles({ state, onOpen }) {
  const items = [
    { id: 'eat', label: 'Idle Eat', icon: 'meat', on: !!state.food },
    { id: 'pray', label: 'Idle Pray', icon: 'prayer', on: state.prayers.length > 0 },
    { id: 'potion', label: 'Idle Potion', icon: 'potion-ball', on: state.potions.length > 0 },
  ];
  return (
    <div className="cb-idlerow">
      {items.map(it => (
        <button key={it.id} className={'cb-idle' + (it.on ? ' is-on' : '')} onClick={() => onOpen(it.id)}>
          <ItemArt icon={it.icon} accent={it.on ? '#3fb56b' : '#6b675c'} gold={false} size={17} glow={it.on ? 0.8 : 0} />
          <span>{it.label}</span>
          {it.on && <img className="cb-idle__chk" src={ICON('check-mark', '#7ce88a')} alt="" />}
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── Attack-style selector ───────────────────────── */
function StyleSelector({ value, onChange }) {
  return (
    <div className="cb-styles">
      {STYLES.map(s => (
        <button key={s.id} className={'cb-styleseg' + (value === s.id ? ' is-on' : '')} onClick={() => onChange(s.id)}>
          <ItemArt icon={s.icon} accent={value === s.id ? '#f0c040' : '#8a8578'} gold={value === s.id} size={15} glow={value === s.id ? 0.7 : 0} />
          <span>{s.name}</span>
        </button>
      ))}
    </div>
  );
}

/* ───────────────────────── Monster row (inside expanded area) ───────────────────────── */
function MonsterRow({ mon, accent, gold, onFight, onInfo }) {
  return (
    <div className="cb-mon" onClick={onFight}>
      <div className="cb-mon__art">
        <ItemArt icon={mon.icon} accent={accent} gold={gold} size={42} glow={0.95} />
      </div>
      <div className="cb-mon__body">
        <div className="cb-mon__name">{mon.name}</div>
        <div className="cb-mon__stats">
          <span>HP {mon.hp}</span><i /><span>Att {mon.att}</span><i /><span>Def {mon.def}</span>
        </div>
      </div>
      <div className="cb-mon__meta">
        <span className="cb-mon__cb">CB {mon.cb}</span>
        {mon.kc > 0 && <span className="cb-mon__kc">KC {mon.kc}</span>}
      </div>
      <button className="cb-mon__info" onClick={(e) => { e.stopPropagation(); onInfo(); }} aria-label="Info">
        <img src={ICON('info', '#f0c040')} alt="i" />
      </button>
    </div>
  );
}

/* ───────────────────────── Area row (collapsible / raid) ───────────────────────── */
function AreaRow({ area, open, gold, onToggle, onFight, onInfo, onRaid }) {
  const isRaid = area.type === 'raid';
  const monCount = isRaid ? null : area.monsters.length;
  return (
    <div className={'cb-area' + (open ? ' is-open' : '') + (isRaid ? ' cb-area--raid' : '')}>
      <button className="cb-area__head" onClick={() => isRaid ? onRaid(area) : (area.boss ? onFight(area, area.monsters[0]) : onToggle(area.id))}>
        <div className="cb-area__glow" style={{ background: `radial-gradient(circle, ${hexA(area.accent, 0.5)}, transparent 66%)` }} />
        <div className="cb-area__icon"><ItemArt icon={area.icon} accent={area.accent} gold={gold} size={30} glow={0.95} /></div>
        <div className="cb-area__txt">
          <div className="cb-area__name">{area.name}</div>
          <div className="cb-area__blurb">{area.blurb}</div>
        </div>
        {isRaid ? (
          <span className="cb-area__raidtag">RAID</span>
        ) : (
          <span className="cb-area__count">{monCount} {monCount === 1 ? 'foe' : 'foes'}</span>
        )}
        <span className="cb-area__chev">
          {isRaid || area.boss
            ? <img src={ICON('play-button', tint(area.accent, 0.3))} alt="" />
            : <span className={'cb-chev' + (open ? ' down' : '')} />}
        </span>
      </button>
      {open && !isRaid && (
        <div className="cb-area__list">
          {area.monsters.map((m, i) => (
            <MonsterRow key={i} mon={m} accent={area.accent} gold={gold} onFight={() => onFight(area, m)} onInfo={() => onInfo(area, m)} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ───────────────────────── SELECT screen ───────────────────────── */
function SelectScreen({ idle, style, setStyle, gold, openId, setOpenId, onFight, onInfo, onRaid, onOpenIdle, playerHp }) {
  return (
    <div className="screen-scroll">
      <div className="cb-pad">
        <div className="cb-select__head">
          <h1 className="cb-h1">Choose a Monster</h1>
          <div className="cb-h1sub">{monsterCount} foes · {raidCount} raids await</div>
        </div>
        <IdleToggles state={idle} onOpen={onOpenIdle} />
        <StyleSelector value={style} onChange={setStyle} />
        <div className="cb-arealist">
          {AREAS.map(area => (
            <AreaRow key={area.id} area={area} open={openId === area.id} gold={gold}
              onToggle={(id) => setOpenId(openId === id ? null : id)}
              onFight={onFight} onInfo={onInfo} onRaid={onRaid} />
          ))}
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── COMBAT screen ───────────────────────── */
function CombatScreen({ area, mon, style, idle, setIdle, gold, speed, onBack, onUnique, onOpenIdle, onInfo }) {
  const prayerOn = idle.prayers.length > 0;
  const { monHp, playerHp, log, kills, kph, killFlash } = useCombatSim({
    monster: mon, style, speed, idleEat: !!idle.food, food: idle.food, prayerOn, running: true, onUnique,
  });
  const logRef = useRef(null);
  useEffect(() => { const el = logRef.current; if (el) el.scrollTop = el.scrollHeight; }, [log]);

  const [invTab, setInvTab] = useState('food');
  const [weapon, setWeapon] = useState(WEAPONS[0].name);
  const [armour, setArmour] = useState(() => ARMOUR.map(a => a.name)); // all equipped by default
  const [pulse, setPulse] = useState(null); // {id, text, tone}
  const pulseSeq = useRef(0);
  function flash(text, tone) { const id = ++pulseSeq.current; setPulse({ id, text, tone }); setTimeout(() => setPulse(p => (p && p.id === id) ? null : p), 1400); }

  const actions = [
    { id: 'spec', label: 'Special', icon: 'lightning-arc', on: false, tone: 'dim', open: null },
    { id: 'cast', label: 'Cast', icon: 'crystal-ball', on: false, tone: 'dim', open: null },
    { id: 'pray', label: 'Prayer', icon: 'prayer', on: prayerOn, tone: 'green', open: 'pray' },
  ];

  return (
    <div className="screen-scroll cb-combat">
      <div className="cb-pad">
        <button className="cb-back" onClick={onBack}><span className="cb-back__arrow">←</span> Back</button>

        <div className="cb-fight__head">
          <div className="cb-fight__id">
            <ItemArt icon={mon.icon} accent={area.accent} size={34} glow={1} />
            <div>
              <div className="cb-fight__name">{mon.name}</div>
              <div className="cb-fight__chips">
                <StyleChip style={mon.style} label={mon.style} />
                <StyleChip style={mon.weakness} label={mon.weakness} kind="weak" />
              </div>
            </div>
          </div>
          <button className="cb-fight__cb" onClick={() => onInfo(area, mon)}>CB {mon.cb}<img src={ICON('info', '#e0564b')} alt="" /></button>
        </div>

        <div className="cb-hpblock">
          <div className="cb-hplabel"><span>{mon.name}</span><span className="cb-hplabel__v">{Math.max(0, Math.round(monHp))}/{mon.hp}</span></div>
          <HpBar value={monHp} max={mon.hp} variant="enemy" height={24} />
        </div>
        <div className="cb-hpblock">
          <div className="cb-hplabel">
            <span>Your Hitpoints</span>
            <span className="cb-hplabel__right">
              {idle.potions.length > 0 && <span className="cb-pottimer"><ItemArt icon="round-bottom-flask" accent="#3fb56b" size={12} glow={0.5} />277s</span>}
              <span className="cb-hplabel__v" style={{ color: '#7ce88a' }}>{Math.max(0, Math.round(playerHp))}/{PLAYER.maxHp}</span>
            </span>
          </div>
          <HpBar value={playerHp} max={PLAYER.maxHp} variant="self" height={24} />
        </div>

        <div className="cb-qa">
          <div className="cb-qa__tabs">
            {[['food','Food',FOOD.length],['potion','Potions',POTIONS.length],['weapon','Weapons',WEAPONS.length],['armour','Armour',ARMOUR.length]].map(([id,label,n]) => (
              <button key={id} className={'cb-qa__tab' + (invTab === id ? ' is-on' : '')} onClick={() => setInvTab(id)}>
                {label}<span className="cb-qa__tabn">{n}</span>
              </button>
            ))}
          </div>

          {pulse && <div key={pulse.id} className={'cb-qa__pulse cb-qa__pulse--' + pulse.tone}>{pulse.text}</div>}

          <div className="cb-qa__grid">
            {invTab === 'food' && FOOD.map((f, i) => {
              const active = idle.food && idle.food.name === f.name;
              return (
                <button key={i} className={'cb-slot cb-slot--food' + (active ? ' is-active' : '')}
                  onClick={() => { setIdle(p => ({ ...p, food: f })); flash('Eating ' + f.name + ' · +' + f.heal, 'heal'); }}>
                  <span className="cb-slot__qty">{window.formatNum(f.own)}</span>
                  <ItemArt icon={f.icon} accent="#e2944a" gold={gold && active} size={32} glow={active ? 1 : 0.55} />
                  <span className="cb-slot__name">{f.name}</span>
                  <span className="cb-slot__tag heal">+{f.heal}</span>
                  {active && <span className="cb-slot__ring" />}
                </button>
              );
            })}

            {invTab === 'potion' && POTIONS.map((p, i) => {
              const active = idle.potions.some(x => x.name === p.name);
              return (
                <button key={i} className={'cb-slot cb-slot--potion' + (active ? ' is-active' : '')}
                  onClick={() => { setIdle(prev => { const has = prev.potions.some(x => x.name === p.name); flash((has ? 'Stowed ' : 'Sipping ') + p.name, 'potion'); return { ...prev, potions: has ? prev.potions.filter(x => x.name !== p.name) : prev.potions.concat(p) }; }); }}>
                  <span className="cb-slot__qty">{window.formatNum(p.own)}</span>
                  <ItemArt icon={p.icon} accent="#3fb56b" gold={gold && active} size={32} glow={active ? 1 : 0.55} />
                  <span className="cb-slot__name">{p.name}</span>
                  {active && <span className="cb-slot__ring" />}
                </button>
              );
            })}

            {invTab === 'weapon' && WEAPONS.map((w, i) => {
              const active = weapon === w.name;
              return (
                <button key={i} className={'cb-slot cb-slot--weapon' + (active ? ' is-active' : '')}
                  onClick={() => { setWeapon(w.name); flash('Wielding ' + w.name, 'gear'); }}>
                  <ItemArt icon={w.icon} accent="#e0564b" gold={gold && active} size={32} glow={active ? 1 : 0.55} />
                  <span className="cb-slot__name">{w.name}</span>
                  <span className="cb-slot__tag">{w.style}</span>
                  {active && <span className="cb-slot__ring" />}
                </button>
              );
            })}

            {invTab === 'armour' && ARMOUR.map((a, i) => {
              const active = armour.includes(a.name);
              return (
                <button key={i} className={'cb-slot cb-slot--armour' + (active ? ' is-active' : '')}
                  onClick={() => { setArmour(prev => prev.includes(a.name) ? prev.filter(x => x !== a.name) : prev.concat(a.name)); flash((active ? 'Removed ' : 'Equipped ') + a.name, 'gear'); }}>
                  <ItemArt icon={a.icon} accent="#9b6cff" gold={gold && active} size={32} glow={active ? 1 : 0.55} />
                  <span className="cb-slot__name">{a.name}</span>
                  <span className="cb-slot__tag">{a.slot}</span>
                  {active && <span className="cb-slot__ring" />}
                </button>
              );
            })}
          </div>
        </div>

        <div className="cb-kstats">
          <div className="cb-kstat"><span className="cb-kstat__k">Kills</span><span className="cb-kstat__v">{kills}</span></div>
          <div className="cb-kstat"><span className="cb-kstat__k">Kills / hr</span><span className="cb-kstat__v">{kph || '—'}</span></div>
        </div>

        <div className="cb-actions">
          {actions.map(a => (
            <button key={a.id} className={'cb-act cb-act--' + a.tone + (a.on ? ' is-on' : '')}
              onClick={() => a.open && onOpenIdle(a.open)} disabled={a.tone === 'dim'}>
              <ItemArt icon={a.icon} accent={a.tone === 'green' ? '#3fb56b' : a.tone === 'violet' ? '#9b6cff' : '#6b675c'} gold={false} size={18} glow={a.on ? 0.7 : 0} />
              <span>{a.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div className="cb-killflash" key={killFlash} />
    </div>
  );
}

/* ───────────────────────── INFO sheet ───────────────────────── */
function InfoSheet({ area, mon, gold, onClose }) {
  return (
    <div className="cb-overlay" onClick={onClose}>
      <div className="cb-sheet" onClick={e => e.stopPropagation()}>
        <div className="cb-sheet__grab" />
        <div className="cb-sheet__hero">
          <div className="cb-sheet__emblem">
            <div className="cb-sheet__glow" style={{ background: `radial-gradient(circle, ${hexA(area.accent, 0.55)}, transparent 64%)` }} />
            <ItemArt icon={mon.icon} accent={area.accent} gold={gold} size={56} glow={1.2} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="cb-sheet__name">{mon.name}</h2>
            <div className="cb-sheet__chips">
              <StyleChip style={mon.style} label={'Uses ' + mon.style} />
              <StyleChip style={mon.weakness} label={'Weak: ' + mon.weakness} kind="!" />
            </div>
          </div>
        </div>
        <div className="cb-sheet__scroll">
          <StatGrid mon={mon} />
          <div className="cb-sheet__sec">Drop Table</div>
          <DropTable drops={mon.drops} unique={mon.unique} accent={area.accent} />
        </div>
      </div>
    </div>
  );
}

/* ───────────────────────── RAID sheet ───────────────────────── */
function RaidSheet({ area, gold, onClose }) {
  const r = area.raid;
  return (
    <div className="cb-overlay" onClick={onClose}>
      <div className="cb-sheet cb-sheet--raid" onClick={e => e.stopPropagation()}>
        <div className="cb-sheet__grab" />
        <div className="cb-sheet__hero">
          <div className="cb-sheet__emblem">
            <div className="cb-sheet__glow" style={{ background: `radial-gradient(circle, ${hexA(area.accent, 0.55)}, transparent 64%)` }} />
            <ItemArt icon={area.icon} accent={area.accent} gold={gold} size={56} glow={1.3} />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="cb-raid__tag">RAID</div>
            <h2 className="cb-sheet__name">{area.name}</h2>
            <div className="cb-sheet__sub">{r.scale} · {r.cb}</div>
          </div>
        </div>
        <div className="cb-sheet__scroll">
          <div className="cb-raid__times">
            <div className="cb-raid__time"><span className="cb-raid__tk">Best Time</span><span className="cb-raid__tv gold">{r.bestTime}</span></div>
            <div className="cb-raid__time"><span className="cb-raid__tk">Average</span><span className="cb-raid__tv">{r.avgTime}</span></div>
            <div className="cb-raid__time"><span className="cb-raid__tk">Completions</span><span className="cb-raid__tv">{r.kc}</span></div>
          </div>

          <div className="cb-sheet__sec">Chambers</div>
          <div className="cb-rooms">
            {r.rooms.map((room, i) => (
              <div key={i} className={'cb-room' + (room.cleared ? ' is-clear' : '')}>
                <div className="cb-room__rail"><span className="cb-room__dot" />{i < r.rooms.length - 1 && <span className="cb-room__line" />}</div>
                <div className="cb-room__icon"><ItemArt icon={room.icon} accent={area.accent} gold={room.cleared} size={26} glow={room.cleared ? 1 : 0.5} locked={!room.cleared && i > 0 && !r.rooms[i-1].cleared} /></div>
                <div className="cb-room__body">
                  <div className="cb-room__name">{room.name}</div>
                  <div className="cb-room__boss">{room.boss} · {room.hp} HP</div>
                </div>
                <div className="cb-room__right">
                  <StyleChip style={room.style} label={room.style} />
                  <span className={'cb-room__status' + (room.cleared ? ' clear' : '')}>{room.cleared ? '✓ Cleared' : 'Locked'}</span>
                </div>
              </div>
            ))}
          </div>

          <div className="cb-sheet__sec">Requirements</div>
          <div className="cb-reqs">
            {r.require.map((req, i) => <span key={i} className="cb-req"><img src={ICON('check-mark', '#7ce88a')} alt="" />{req}</span>)}
          </div>

          <div className="cb-sheet__sec">Reward Table</div>
          <DropTable drops={r.drops} unique={r.unique} accent={area.accent} />
        </div>
        <button className="cb-raid__enter">Enter Raid</button>
      </div>
    </div>
  );
}

/* ───────────────────────── IDLE config sheets ───────────────────────── */
function IdleSheet({ kind, idle, setIdle, onClose }) {
  const conf = {
    eat:    { title: 'Idle Eat', icon: 'meat', accent: '#e2944a', desc: 'Pick food the simulator may eat. While food is equipped you cannot die.', list: FOOD, key: 'food', single: true },
    potion: { title: 'Idle Potion', icon: 'potion-ball', accent: '#3fb56b', desc: 'Potions are sipped automatically to keep your boosts active.', list: POTIONS, key: 'potions', single: false },
    pray:   { title: 'Idle Pray', icon: 'prayer', accent: '#f0c040', desc: 'Active prayers drain points but are auto-flicked while fighting.', list: PRAYERS, key: 'prayers', single: false },
    gear:   null,
  }[kind];
  if (!conf) return null;

  function isSel(item) {
    if (conf.single) return idle.food && idle.food.name === item.name;
    return (idle[conf.key] || []).some(x => x.name === item.name);
  }
  function toggle(item) {
    if (conf.single) {
      setIdle(prev => ({ ...prev, food: prev.food && prev.food.name === item.name ? null : item }));
    } else {
      setIdle(prev => {
        const cur = prev[conf.key] || [];
        const has = cur.some(x => x.name === item.name);
        return { ...prev, [conf.key]: has ? cur.filter(x => x.name !== item.name) : cur.concat(item) };
      });
    }
  }

  return (
    <div className="cb-overlay" onClick={onClose}>
      <div className="cb-sheet cb-sheet--idle" onClick={e => e.stopPropagation()}>
        <div className="cb-idlehead">
          <div className="cb-idlehead__title"><ItemArt icon={conf.icon} accent={conf.accent} size={22} glow={0.8} /><h2>{conf.title}</h2></div>
          <button className="cb-x" onClick={onClose}><img src={ICON('cancel', '#cdbf9f')} alt="×" /></button>
        </div>
        <p className="cb-idledesc">{conf.desc}</p>
        <div className="cb-idlelist">
          {conf.list.map((item, i) => {
            const sel = isSel(item);
            const sub = item.heal != null ? `+${item.heal} HP` : item.effect || item.desc;
            return (
              <div key={i} className={'cb-fooditem' + (sel ? ' is-sel' : '')} onClick={() => toggle(item)}>
                <div className="cb-fooditem__art"><ItemArt icon={item.icon} accent={conf.accent} gold={sel} size={30} glow={sel ? 1 : 0.6} /></div>
                <div className="cb-fooditem__body">
                  <div className="cb-fooditem__name">{item.name}{item.heal != null && <span className="cb-fooditem__heal"> · +{item.heal} HP</span>}</div>
                  <div className="cb-fooditem__sub">{item.own != null ? `Own ${window.formatNum(item.own)}` : sub}{item.own != null && (item.effect || item.desc) ? ` · ${item.effect || item.desc}` : ''}</div>
                </div>
                <span className={'cb-fooditem__btn' + (sel ? ' is-sel' : '')}>{sel ? (conf.single ? 'Clear' : 'On') : 'Use'}</span>
              </div>
            );
          })}
        </div>
        <button className="cb-done" onClick={onClose}>Done</button>
      </div>
    </div>
  );
}

/* ───────────────────────── App ───────────────────────── */
const TWEAK_DEFAULTS = /*EDITMODE-BEGIN*/{
  "artStyle": "colored",
  "speed": 1.4,
  "celebrate": true
}/*EDITMODE-END*/;

function App() {
  const [t, setTweak] = useTweaks(TWEAK_DEFAULTS);
  const gold = t.artStyle === 'gold';
  const [style, setStyle] = useState('aggressive');
  const [openId, setOpenId] = useState('nagadoth');
  const [view, setView] = useState({ screen: 'select' }); // {screen:'select'|'combat', area, mon}
  const [info, setInfo] = useState(null);   // {area, mon}
  const [raid, setRaid] = useState(null);   // area
  const [idleSheet, setIdleSheet] = useState(null); // 'eat'|'potion'|'pray'|'gear'
  const [cele, setCele] = useState(null);
  const [idle, setIdle] = useState({ food: FOOD[1], potions: [POTIONS[0]], prayers: [PRAYERS[1]] });

  function fight(area, mon) { setView({ screen: 'combat', area, mon }); }
  function handleUnique(u) { if (t.celebrate) setCele({ ...u, kind: 'rare' }); }

  return (
    <div className="phone">
      <div className="notch" />
      <div className="phone__screen">
        <div className="statusbar">
          <span>9:41</span>
          <div className="right"><span className="sb-batt"><span className="sb-batt__fill" /></span></div>
        </div>

        <TopBar hp={PLAYER.maxHp} />

        {view.screen === 'select' ? (
          <SelectScreen idle={idle} style={style} setStyle={setStyle} gold={gold}
            openId={openId} setOpenId={setOpenId} onFight={fight} onInfo={(a, m) => setInfo({ area: a, mon: m })}
            onRaid={setRaid} onOpenIdle={setIdleSheet} playerHp={PLAYER.maxHp} />
        ) : (
          <CombatScreen area={view.area} mon={view.mon} style={style} idle={idle} setIdle={setIdle} gold={gold} speed={t.speed}
            onBack={() => setView({ screen: 'select' })} onUnique={handleUnique}
            onOpenIdle={setIdleSheet} onInfo={(a, m) => setInfo({ area: a, mon: m })} />
        )}

        {info && <InfoSheet area={info.area} mon={info.mon} gold={gold} onClose={() => setInfo(null)} />}
        {raid && <RaidSheet area={raid} gold={gold} onClose={() => setRaid(null)} />}
        {idleSheet && <IdleSheet kind={idleSheet} idle={idle} setIdle={setIdle} onClose={() => setIdleSheet(null)} />}
        {cele && <Celebration event={cele} onDone={() => setCele(null)} />}
      </div>

      <TweaksPanel>
        <TweakSection label="Combat" />
        <TweakSlider label="Combat speed" value={t.speed} min={0.5} max={3} step={0.1} unit="×" onChange={v => setTweak('speed', v)} />
        <TweakToggle label="Celebrate rare drops" value={t.celebrate} onChange={v => setTweak('celebrate', v)} />
        <TweakSection label="Art" />
        <TweakRadio label="Style" value={t.artStyle} options={['colored', 'gold']} onChange={v => setTweak('artStyle', v)} />
      </TweaksPanel>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
