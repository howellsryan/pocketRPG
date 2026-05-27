import type { CapacitorConfig } from '@capacitor/cli'

// Wraps the self-contained www/ bundle (npm run build:app) in a native iOS
// shell. The app talks to the live API at pocketrpg.co.uk (see src/cloud/apiBase.js),
// so no dev server URL is configured here — content is bundled for offline-first.
const config: CapacitorConfig = {
  appId: 'uk.co.pocketrpg.app',
  appName: 'PocketRPG',
  webDir: 'www',
  ios: {
    contentInset: 'always',
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 600,
      backgroundColor: '#0f0f0f',
      showSpinner: false,
    },
  },
}

export default config
