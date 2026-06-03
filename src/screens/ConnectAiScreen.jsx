import { useState } from 'preact/hooks'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'

// Step-by-step connector guides. Kept current with the Claude and ChatGPT
// custom-connector / MCP flows (both reworked their settings UI in late 2025 /
// early 2026). Players connect by adding the shared MCP server URL below as a
// custom connector; per-account access comes from the OAuth sign-in, not the URL.
const GUIDES = {
  claude: {
    label: 'Claude',
    icon: '✳️',
    plan: 'Needs a paid Claude plan (Pro, Max, Team or Enterprise). On Team/Enterprise only an Owner can add a connector.',
    steps: [
      'Open Claude on a computer — claude.ai in a browser or the Claude desktop app (see the mobile note below).',
      'Go to Settings → Connectors (under "Customize").',
      'Scroll down and click "Add custom connector".',
      'Give it a name (e.g. PocketRPG) and paste the MCP server URL above. Leave the OAuth fields under "Advanced settings" blank.',
      'Click "Add", then "Connect" — a PocketRPG window opens.',
      'Sign in if asked and choose "Allow access" to approve.',
      'In a chat, open the tools/connectors menu and enable PocketRPG, then ask it about your character.',
    ],
  },
  chatgpt: {
    label: 'ChatGPT',
    icon: '🟢',
    plan: 'Needs a paid ChatGPT plan (Plus, Pro, Team, Enterprise or Edu). Custom MCP connectors live behind Developer mode (beta).',
    steps: [
      'Open ChatGPT on a computer — chatgpt.com in a browser or the desktop app (see the mobile note below).',
      'Go to Settings → Apps & Connectors → "Advanced settings" and turn on "Developer mode".',
      'Back on Apps & Connectors, click "Create" to add a custom connector.',
      'Give it a name (e.g. PocketRPG), paste the MCP server URL above, and pick OAuth as the authentication.',
      'Click "Create" — a PocketRPG window opens. Sign in if asked and choose "Allow access".',
      'Start a new chat, open the "+" / Developer mode menu, enable the PocketRPG tools, then ask it about your character.',
    ],
  },
}

export default function ConnectAiScreen({ isCloudAccount }) {
  const [provider, setProvider] = useState('claude')
  const [copied, setCopied] = useState(false)

  const mcpServerUrl = typeof window !== 'undefined' ? `${window.location.origin}/api/mcp` : '/api/mcp'

  async function copyUrl() {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(mcpServerUrl)
      } else {
        const ta = document.createElement('textarea')
        ta.value = mcpServerUrl
        ta.setAttribute('readonly', '')
        document.body.appendChild(ta)
        ta.select()
        document.execCommand('copy')
        ta.remove()
      }
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch { /* clipboard unavailable — user can select manually */ }
  }

  const guide = GUIDES[provider]

  return (
    <div class="h-full flex flex-col">
      <div class="flex-shrink-0 bg-[#111] border-b border-[var(--color-void-border)] px-4 py-3">
        <h1 class="font-[var(--font-display)] text-lg font-bold text-[var(--color-gold)]">🤖 Connect AI</h1>
      </div>

      <div class="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        <p class="text-sm text-[var(--color-parchment)] opacity-75 leading-relaxed">
          PocketRPG runs an <b>MCP server</b> so an AI assistant like <b>Claude</b> or <b>ChatGPT</b> can
          view your characters and take server-authoritative actions (shop, skips, idle tasks, quests) for
          you. Add the server below as a <b>custom connector</b> — you approve access in your browser, so
          there's no token to copy.
        </p>

        {!isCloudAccount && (
          <Card className="p-3 bg-[#2a1d12] border border-[#5a3d1a]">
            <p class="text-xs text-[var(--color-parchment)] opacity-90 leading-relaxed">
              You're playing on a local account. Sign in with a cloud account (GitHub or Google) to connect
              an AI assistant — the MCP server only works with cloud characters.
            </p>
          </Card>
        )}

        {/* Private connector URL */}
        <div>
          <div class="text-xs uppercase tracking-wide opacity-50 mb-1">MCP server URL</div>
          <div class="flex items-center gap-2">
            <code class="flex-1 min-w-0 break-all rounded-lg bg-[#111] border border-[var(--color-void-border)] p-2 font-[var(--font-mono)] text-xs text-[var(--color-gold)]">
              {mcpServerUrl}
            </code>
            <Button size="md" variant="primary" onClick={copyUrl}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
          <p class="text-[11px] text-[var(--color-parchment)] opacity-50 mt-1">
            This URL is the same for every player — it isn't a secret. Your characters are protected by the
            sign-in step: when you connect, you log into PocketRPG and approve access, and the connector
            gets a personal token that ties it to <b>your</b> account.
          </p>
        </div>

        {/* Provider tabs */}
        <div class="flex gap-2">
          {Object.entries(GUIDES).map(([key, g]) => {
            const active = provider === key
            return (
              <button
                key={key}
                type="button"
                onClick={() => setProvider(key)}
                aria-pressed={active}
                class={`flex-1 min-h-[44px] flex items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer transition-colors ${
                  active
                    ? 'bg-[var(--color-void-light)] border-[var(--color-gold)] text-[var(--color-gold)]'
                    : 'bg-transparent border-[var(--color-void-border)] text-[var(--color-parchment)] opacity-70 hover:opacity-100'
                }`}
              >
                <span class="text-lg leading-none">{g.icon}</span>
                {g.label}
              </button>
            )
          })}
        </div>

        {/* Selected provider guide */}
        <Card className="p-4">
          <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-2">
            {guide.icon} Connect with {guide.label}
          </h2>
          <p class="text-xs text-[var(--color-parchment)] opacity-70 mb-3 leading-relaxed">{guide.plan}</p>
          <ol class="list-decimal pl-5 space-y-2">
            {guide.steps.map((step) => (
              <li key={step} class="text-sm text-[var(--color-parchment)] opacity-90 leading-relaxed">{step}</li>
            ))}
          </ol>
        </Card>

        {/* Mobile note */}
        <Card className="p-3 bg-[#2a1d12] border border-[#5a3d1a]">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-lg">📱</span>
            <span class="font-bold text-[var(--color-gold)] text-sm">Mobile apps don't work — use a computer</span>
          </div>
          <ul class="list-disc pl-4 space-y-1 text-xs text-[var(--color-parchment)] opacity-85 leading-relaxed">
            <li>The <b>ChatGPT</b> mobile app has no Developer mode, so you can't add or use a custom connector there.</li>
            <li>The <b>Claude</b> mobile app doesn't show the "Add custom connector" option either.</li>
            <li>Set the connector up on a desktop/laptop (browser or desktop app). PocketRPG itself is mobile-friendly — only the AI connector setup needs a computer.</li>
          </ul>
        </Card>

        {/* Switch account / disconnect */}
        <Card className="p-3">
          <div class="flex items-center gap-2 mb-1">
            <span class="text-lg">🔁</span>
            <span class="font-bold text-[var(--color-gold)] text-sm">Switch account or disconnect</span>
          </div>
          <ul class="list-disc pl-4 space-y-1 text-xs text-[var(--color-parchment)] opacity-85 leading-relaxed">
            <li>To disconnect, remove the PocketRPG connector in your AI client's settings — that deletes the stored access token.</li>
            <li>To switch accounts, reconnect and choose <b>"Use a different account"</b> on the PocketRPG sign-in screen, then sign in with the account you want.</li>
            <li>You can also ask the assistant to <b>log out</b> — it will walk you through these steps. Access expires on its own within 30 days.</li>
          </ul>
        </Card>

        {/* Control / security note */}
        <Card className="p-3">
          <div class="font-bold text-[var(--color-gold)] text-sm mb-1">You stay in control</div>
          <p class="text-xs text-[var(--color-parchment)] opacity-80 leading-relaxed">
            Access is granted only after you approve it, and an assistant can only do what these tools allow
            (view state, idle tasks, quests, shop purchases, credit skips) — it can never wipe your account
            or change your password. Access expires within <b>30 days</b>, and logging out revokes it sooner.
          </p>
        </Card>
      </div>
    </div>
  )
}
