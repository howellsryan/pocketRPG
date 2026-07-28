/**
 * Animation-clip naming convention for rigged monster GLBs.
 *
 * A monster rig is wired by clip NAME, not by index — an imported model is
 * renamed into these at asset-processing time (`scripts/process-3d-model.mjs
 * --clip old=new`), so the runtime never has to know which exporter produced it.
 *
 * A rig may ship one attack clip or two. Two lets a boss that changes combat
 * style mid-fight swing differently for melee than it does for a ranged or
 * magic attack; one is used for every style, which is what every existing rig
 * does.
 */
export const MONSTER_CLIP_IDLE = 'Idle'
export const MONSTER_CLIP_DEATH = 'Death'
export const MONSTER_CLIP_ATTACK = 'Attack'
export const MONSTER_CLIP_ATTACK_RANGED = 'AttackRanged'

/**
 * The clip a monster should swing with for `attackStyle`.
 *
 * Ranged and magic deliberately share one clip: a cast and a bolt both read as
 * "strikes from where it stands", where every melee style is a lunge. Anything
 * unrecognised falls back to the melee clip, which every rig has.
 */
export function monsterAttackClipName(attackStyle) {
  return attackStyle === 'ranged' || attackStyle === 'magic'
    ? MONSTER_CLIP_ATTACK_RANGED
    : MONSTER_CLIP_ATTACK
}

/**
 * Picks the attack clip out of a rig's clips for `attackStyle`, falling back to
 * the melee clip when the rig has no style-specific one. Returns null for a rig
 * with no attack clip at all — those keep the procedural lunge.
 *
 * @param {Array<{name: string}>} clips
 */
export function selectMonsterAttackClip(clips, attackStyle) {
  const list = Array.isArray(clips) ? clips : []
  const wanted = monsterAttackClipName(attackStyle)
  return list.find((c) => c && c.name === wanted)
    || list.find((c) => c && c.name === MONSTER_CLIP_ATTACK)
    || null
}
