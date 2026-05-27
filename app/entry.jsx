// Native/offline app entry. Unlike the web single-file build (which pulls
// Tailwind and fonts from CDNs), the packaged app must be fully self-contained,
// so fonts are bundled here and Tailwind is compiled at build time via
// @tailwindcss/vite. Weights mirror the web build's Google Fonts request:
// Cinzel 400/700/900, Nunito 400/600/700, JetBrains Mono 400/700.
import './app.css'
import '@fontsource/cinzel/400.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/cinzel/900.css'
import '@fontsource/nunito/400.css'
import '@fontsource/nunito/600.css'
import '@fontsource/nunito/700.css'
import '@fontsource/jetbrains-mono/400.css'
import '@fontsource/jetbrains-mono/700.css'

import '../src/main.jsx'
