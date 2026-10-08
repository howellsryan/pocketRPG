// One policy for both client flags and staged assets. Branch names alone do
// not identify an environment: the preview Worker can also be built from main.
function resolveWorldBuildFlags(env) {
  const worldBetaEnabled = env.POCKETRPG_BUILD_ENV === 'preview' && env.EnableWorldBeta === 'true'
  return {
    worldBetaEnabled,
    worldLairsEnabled: worldBetaEnabled && (env.EnableWorldLairs == null || env.EnableWorldLairs === 'true'),
  }
}
module.exports = { resolveWorldBuildFlags }
