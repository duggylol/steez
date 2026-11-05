// Runtime configuration for the bot core. Steez's main process fills these in
// (from app-config.json, the import of older apps and the Settings page) before
// and while the bot runs, so every field is read lazily by the modules.
export const config = {
  dataDir: process.env.STEEZ_BOT_DATA || 'data',
  publicUrl: process.env.STEEZ_PUBLIC_URL || 'http://127.0.0.1:43112',
  clientId: process.env.STEEZ_TWITCH_CLIENT_ID || '',
  relayUrl: process.env.STEEZ_RELAY_URL || '', // SteezBot relay (Cloudflare Worker)
  // API keys live in the bot database (db.secrets) and are read through these getters.
  get anthropicKey() {
    return globalThis.__steezSecrets?.anthropicKey || process.env.ANTHROPIC_API_KEY || '';
  },
  get youtubeKey() {
    return globalThis.__steezSecrets?.youtubeKey || process.env.YOUTUBE_API_KEY || '';
  },
};
