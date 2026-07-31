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
 * Rigs whose melee swing plays the RANGED clip because their own melee clip is
 * unusable. Zaryth's rears up, strikes, and then collapses to the floor with no
 * recovery — trimmed at the follow-through it reads as a slow reach, and untrimmed
 * as the boss dying mid-fight. It rerolls its style every swing, so that clip was
 * a third of everything you ever saw it do.
 *
 * A per-monster override rather than a rebuild of the asset: the arena and the
 * world load different GLBs built from the same source, and one list keeps them
 * swinging alike. Kept explicit — a rig gets here because someone watched it.
 */
const MELEE_SWINGS_WITH_RANGED_CLIP = new Set(['zaryth_the_empty_lord'])

/**
 * The clip a monster should swing with for `attackStyle`.
 *
 * Ranged and magic deliberately share one clip: a cast and a bolt both read as
 * "strikes from where it stands", where every melee style is a lunge. Anything
 * unrecognised falls back to the melee clip, which every rig has.
 */
export function monsterAttackClipName(attackStyle, monsterId) {
  const ranged = attackStyle === 'ranged' || attackStyle === 'magic'
  if (ranged || MELEE_SWINGS_WITH_RANGED_CLIP.has(monsterId)) return MONSTER_CLIP_ATTACK_RANGED
  return MONSTER_CLIP_ATTACK
}

/**
 * Picks the attack clip out of a rig's clips for `attackStyle`, falling back to
 * the melee clip when the rig has no style-specific one. Returns null for a rig
 * with no attack clip at all — those keep the procedural lunge.
 *
 * @param {Array<{name: string}>} clips
 */
export function selectMonsterAttackClip(clips, attackStyle, monsterId) {
  const list = Array.isArray(clips) ? clips : []
  const wanted = monsterAttackClipName(attackStyle, monsterId)
  return list.find((c) => c && c.name === wanted)
    || list.find((c) => c && c.name === MONSTER_CLIP_ATTACK)
    || null
}
