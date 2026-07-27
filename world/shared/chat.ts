// Re-export only. The sanitiser itself lives in src/engine/playerChat.js
// because co-op boss rooms and the Pages edge need the same one, and those
// import from src/ rather than from world/shared.
export { CHAT_MAX_CHARS, sanitizeChat } from '../../src/engine/playerChat.js'
