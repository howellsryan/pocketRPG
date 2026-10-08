import { execFileSync } from 'node:child_process'
// Preview is an environment, including when its source branch is main.
execFileSync(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:site'], {
  stdio: 'inherit', env: { ...process.env, POCKETRPG_BUILD_ENV: 'preview', EnableWorldBeta: 'true' },
})
