# Steez

One lightweight desktop app for streamers that replaces three tools:

- **Chat bot**: a StreamElements / Streamlabs bot replacement with commands, timers, moderation, loyalty points, games, giveaways, polls, bets, AI, alerts, achievements and analytics.
- **Song Requests**: SongSeek built in. Spotify, YouTube and SoundCloud requests from chat or channel points.
- **Viewer Queue**: QueueUp built in. Party and queue management, an OBS overlay, and TikTok gift tracking.

Steez uses one Twitch login and one chat connection for everything. Its single local server hosts every OBS overlay. It checks for updates on every launch.

## Install

Download `Steez-Setup-x.y.z.exe` from [Releases](https://github.com/duggylol/steez/releases) and run it. Installation takes one click, and Steez opens when it's done.

Windows SmartScreen may say "unknown publisher" because the installer isn't code-signed. Click **More info → Run anyway**.

## First run

1. **Connect your channel** under *Settings → Twitch accounts*. Steez has a built-in Twitch app, so there's nothing to register. Optionally connect a separate bot account, then type `/mod <botname>` in your chat.
2. **Song requests.** Connect Spotify on the *Song Requests* page. If SongSeek was installed, Steez already imported your Spotify login, your Spotify app and your settings.
3. **OBS.** The *OBS Overlays* page lists every browser source with copy buttons.

### Coming from SongSeek or QueueUp

On first launch Steez reads the other apps' data, but only reads it and never changes those files:

| From | What carries over |
|---|---|
| SongSeek (`%APPDATA%\SongSeek`) | Spotify login and Spotify app, Twitch app and login (if still valid), reward name, toggles, volume, pending requests |
| QueueUp (`%APPDATA%\queueup`) | Queue, party, rules, overlay styling, gift overlay styling, TikTok username, avatar cache |

Once you've checked everything carried over, you can uninstall the old apps.

The SongSeek now-playing overlay keeps its address, `http://127.0.0.1:43112/overlay`, so existing OBS sources keep working. QueueUp's overlays moved to `/overlay/queue` and `/overlay/gifts`.

## SteezBot (shared bot account)

By default the bot's chat replies come from the shared **SteezBot** account, like Nightbot or StreamElements. They carry Twitch's *Chat Bot* badge, and streamers need no bot account of their own. The **relay** behind this is a tiny Cloudflare Worker (`relay/`, free tier). It holds SteezBot's credentials so they never ship inside the app.

**How it works.** Steez sends the relay the message plus the streamer's own Twitch token, which proves they own the channel. The relay:
- validates the token with Twitch, keeps only a short-lived hash of it, and never stores it;
- checks that the streamer granted `channel:bot`;
- rate-limits each channel to 20 messages per 30 seconds;
- posts through Twitch's chat API as SteezBot.

Moderation (timeouts, deleting messages, shield mode) uses the streamer's own login. If the relay is unreachable, Steez falls back to the streamer's account so chat never goes quiet. Streamers can choose *My account*, or connect a custom bot account, under *Settings → Bot identity*.

**Owner setup (once):**
1. In the [Twitch developer console](https://dev.twitch.tv/console/apps), the Steez app must be **Confidential**. Click **New Secret** and keep the secret handy.
2. Run:
   ```bash
   npm run relay:setup
   ```
   It logs in to Cloudflare, deploys the relay, and asks for the bot username and the client secret.
3. Log in to Twitch as the bot account, open `<relay-url>/setup`, and click **Authorize**.
4. Put the relay URL in `BUILTIN_RELAY_URL` in `src/main/main.js`, then ship an update.

**If someone abuses SteezBot:** add their Twitch user ID to `BLOCKED_CHANNELS` in `relay/wrangler.toml`, then run:
```bash
npm run relay:deploy
```

## Updates

Steez updates itself the way Discord does. On every launch, the start-up screen asks GitHub for a newer release. If there is one, Steez downloads and installs it before the app opens. While Steez is running it re-checks every 30 minutes and offers **Restart to update**. You can switch off the launch check in *Settings → Updates*.

### Publishing an update

1. Commit your changes.
2. Run one of:
   ```bash
   npm run ship:patch
   ```
   ```bash
   npm run ship:minor
   ```
   This bumps the version, tags the commit and pushes it.
3. GitHub Actions (`.github/workflows/release.yml`) builds the installer and publishes it as a release. Every copy of Steez installs it on its next launch.

### Twitch app

Steez ships with a built-in Twitch app (Client ID `dlf5rup2h6khs3zd6raa328q9uuetl`). In the [Twitch developer console](https://dev.twitch.tv/console/apps), it must keep:
- OAuth Redirect URL: `http://localhost:43111`
- Client Type: *Public*

To use a different app for a build, set the repository secret `STEEZ_TWITCH_CLIENT_ID`; CI writes it into `app-config.json`. Individual users can also switch to their own app under *Settings → Twitch application*.

## Development

```bash
npm install
```
```bash
npm run dev
```

`npm run dev` starts Vite plus Electron with hot reload. Other commands:

| Command | What it does |
|---|---|
| `npm test` | Chat-bot pipeline tests and QueueUp state tests |
| `npm run dist` | Build the installer locally into `release/` |
| `npm run icon` | Re-render `build/icon.png` from `build/icon.svg` |

Set `STEEZ_USER_DATA=<folder>` to run with a throwaway profile. Add `STEEZ_SNAPSHOTS=<folder>` to save a screenshot of every page and quit.

### Layout

```
src/main/            Electron main process
  main.js            start-up (splash → update check → services → window)
  updater.js         launch-time + background updates (GitHub Releases)
  server.js          the one local server (UI, overlays, API, websockets) on 127.0.0.1:43112
  twitchHub.js       the shared Twitch connection handed to every feature
  importer.js        finds SongSeek / QueueUp data
  bot/               chat bot core + modules
  songseek/          song requests (Spotify control, search, yt-dlp, now-playing overlay)
  queueup/           viewer queue, TikTok gifts, queue + gift overlays
src/renderer/        React UI (one design system: styles/steez.css + ui.jsx)
resources/bin/       bundled yt-dlp
```
