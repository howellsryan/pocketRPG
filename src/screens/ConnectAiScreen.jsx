import { useState } from 'preact/hooks'
import Card from '../components/Card.jsx'
import Button from '../components/Button.jsx'

// Brand marks for the provider tabs/headers. Inline single-path SVGs (fill via
// currentColor) so they scale crisply and inherit a Tailwind text-color class.
// Claude sunburst is from simple-icons; OpenAI's mark is the canonical logo.
function ClaudeBrandIcon(props) {
  return (
    <svg viewBox="0 0 24 24" class={props.class || 'w-5 h-5'} fill="currentColor" role="img" aria-hidden="true">
      <path d="m4.7144 15.9555 4.7174-2.6471.079-.2307-.079-.1275h-.2307l-.7893-.0486-2.6956-.0729-2.3375-.0971-2.2646-.1214-.5707-.1215-.5343-.7042.0546-.3522.4797-.3218.686.0608 1.5179.1032 2.2767.1578 1.6514.0972 2.4468.255h.3886l.0546-.1579-.1336-.0971-.1032-.0972L6.973 9.8356l-2.55-1.6879-1.3356-.9714-.7225-.4918-.3643-.4614-.1578-1.0078.6557-.7225.8803.0607.2246.0607.8925.686 1.9064 1.4754 2.4893 1.8336.3643.3035.1457-.1032.0182-.0728-.164-.2733-1.3539-2.4467-1.445-2.4893-.6435-1.032-.17-.6194c-.0607-.255-.1032-.4674-.1032-.7285L6.287.1335 6.6997 0l.9957.1336.419.3642.6192 1.4147 1.0018 2.2282 1.5543 3.0296.4553.8985.2429.8318.091.255h.1579v-.1457l.1275-1.706.2368-2.0947.2307-2.6957.0789-.7589.3764-.9107.7468-.4918.5828.2793.4797.686-.0668.4433-.2853 1.8517-.5586 2.9021-.3643 1.9429h.2125l.2429-.2429.9835-1.3053 1.6514-2.0643.7286-.8196.85-.9046.5464-.4311h1.0321l.759 1.1293-.34 1.1657-1.0625 1.3478-.8804 1.1414-1.2628 1.7-.7893 1.36.0729.1093.1882-.0183 2.8535-.607 1.5421-.2794 1.8396-.3157.8318.3886.091.3946-.3278.8075-1.967.4857-2.3072.4614-3.4364.8136-.0425.0304.0486.0607 1.5482.1457.6618.0364h1.621l3.0175.2247.7892.522.4736.6376-.079.4857-1.2142.6193-1.6393-.3886-3.825-.9107-1.3113-.3279h-.1822v.1093l1.0929 1.0686 2.0035 1.8092 2.5075 2.3314.1275.5768-.3218.4554-.34-.0486-2.2039-1.6575-.85-.7468-1.9246-1.621h-.1275v.17l.4432.6496 2.3436 3.5214.1214 1.0807-.17.3521-.6071.2125-.6679-.1214-1.3721-1.9246L14.38 17.959l-1.1414-1.9428-.1397.079-.674 7.2552-.3156.3703-.7286.2793-.6071-.4614-.3218-.7468.3218-1.4753.3886-1.9246.3157-1.53.2853-1.9004.17-.6314-.0121-.0425-.1397.0182-1.4328 1.9672-2.1796 2.9446-1.7243 1.8456-.4128.164-.7164-.3704.0667-.6618.4008-.5889 2.386-3.0357 1.4389-1.882.929-1.0868-.0062-.1579h-.0546l-6.3385 4.1164-1.1293.1457-.4857-.4554.0608-.7467.2307-.2429 1.9064-1.3114Z" />
    </svg>
  )
}

function ChatGptBrandIcon(props) {
  return (
    <svg viewBox="0 0 24 24" class={props.class || 'w-5 h-5'} fill="currentColor" role="img" aria-hidden="true">
      <path d="M22.2819 9.8211a5.9847 5.9847 0 0 0-.5157-4.9108 6.0462 6.0462 0 0 0-6.5098-2.9A6.0651 6.0651 0 0 0 4.9807 4.1818a5.9847 5.9847 0 0 0-3.9977 2.9 6.0462 6.0462 0 0 0 .7427 7.0966 5.98 5.98 0 0 0 .511 4.9107 6.051 6.051 0 0 0 6.5146 2.9001A5.9847 5.9847 0 0 0 13.2599 24a6.0557 6.0557 0 0 0 5.7718-4.2058 5.9894 5.9894 0 0 0 3.9977-2.9001 6.0557 6.0557 0 0 0-.7475-7.0729zm-9.022 12.6081a4.4755 4.4755 0 0 1-2.8764-1.0408l.1419-.0804 4.7783-2.7582a.7948.7948 0 0 0 .3927-.6813v-6.7369l2.02 1.1686a.071.071 0 0 1 .038.052v5.5826a4.504 4.504 0 0 1-4.4945 4.4944zm-9.6607-4.1254a4.4708 4.4708 0 0 1-.5346-3.0137l.142.0852 4.783 2.7582a.7712.7712 0 0 0 .7806 0l5.8428-3.3685v2.3324a.0804.0804 0 0 1-.0332.0615L9.74 19.9502a4.4992 4.4992 0 0 1-6.1408-1.6464zM2.3408 7.8956a4.485 4.485 0 0 1 2.3655-1.9728V11.6a.7664.7664 0 0 0 .3879.6765l5.8144 3.3543-2.0201 1.1685a.0757.0757 0 0 1-.071 0l-4.8303-2.7865A4.504 4.504 0 0 1 2.3408 7.872zm16.5963 3.8558L13.1038 8.364 15.1192 7.2a.0757.0757 0 0 1 .071 0l4.8303 2.7913a4.4944 4.4944 0 0 1-.6765 8.1042v-5.6772a.79.79 0 0 0-.407-.667zm2.0107-3.0231l-.142-.0852-4.7735-2.7818a.7759.7759 0 0 0-.7854 0L9.409 9.2297V6.8974a.0662.0662 0 0 1 .0284-.0615l4.8303-2.7866a4.4992 4.4992 0 0 1 6.6802 4.66zM8.3065 12.863l-2.02-1.1638a.0804.0804 0 0 1-.038-.0567V6.0742a4.4992 4.4992 0 0 1 7.3757-3.4537l-.142.0805L8.704 5.459a.7948.7948 0 0 0-.3927.6813zm1.0976-2.3654l2.602-1.4998 2.6069 1.4998v2.9994l-2.5974 1.4997-2.6067-1.4997Z" />
    </svg>
  )
}

// Step-by-step connector guides. Kept current with the Claude and ChatGPT
// custom-connector / MCP flows (both reworked their settings UI in late 2025 /
// early 2026). Players connect by adding the shared MCP server URL below as a
// custom connector; per-account access comes from the OAuth sign-in, not the URL.
const GUIDES = {
  claude: {
    label: 'Claude',
    Icon: ClaudeBrandIcon,
    iconClass: 'text-[#D97757]',
    plan: 'Works on any Claude plan, including Free — Free accounts can add just one custom connector. (On Team/Enterprise only an Owner can add connectors.)',
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
    Icon: ChatGptBrandIcon,
    iconClass: 'text-[var(--color-parchment)]',
    plan: 'Needs a paid ChatGPT plan (Plus, Pro, Business, Enterprise or Edu) — custom MCP connectors live behind Developer mode (beta) and the free tier can\'t add them.',
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
                <g.Icon class={`w-5 h-5 ${g.iconClass}`} />
                {g.label}
              </button>
            )
          })}
        </div>

        {/* Selected provider guide */}
        <Card className="p-4">
          <h2 class="font-[var(--font-display)] text-base font-bold text-[var(--color-gold)] mb-2 flex items-center gap-2">
            <guide.Icon class={`w-5 h-5 ${guide.iconClass}`} />
            Connect with {guide.label}
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
