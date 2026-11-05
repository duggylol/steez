import { useEffect, useState } from 'react';
import { PageHeader, Panel, Button, Field, Toggle, Tabs, Pill, copyText, toast, useAction } from '../ui.jsx';
import { api } from '../lib/bot.js';
import BotPage from './bot/BotPage.jsx';

const REDIRECT = 'http://localhost:43111';

function TwitchApp({ settings, setSettings }) {
  const custom = !!settings.twitchClientId;
  const [open, setOpen] = useState(custom);
  const [clientId, setClientId] = useState(settings.twitchClientId || '');
  const run = useAction();
  const save = (id) =>
    run(async () => {
      const s = await window.steez.settings.set({ twitchClientId: id });
      setSettings(s);
      setClientId(id);
    }, id ? 'Custom Twitch app saved — reconnect your accounts' : 'Using the built-in Steez app — reconnect your accounts');
  if (!open)
    return (
      <Panel title="Twitch application">
        <div className="row">
          <div className="grow faint small">Steez uses its built-in Twitch app — nothing to set up.</div>
          <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
            Use my own app
          </Button>
        </div>
      </Panel>
    );
  return (
    <Panel
      title="Twitch application"
      actions={
        custom ? (
          <Button size="sm" onClick={() => save('')}>
            Use built-in app
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
            Cancel
          </Button>
        )
      }
    >
      <p className="muted" style={{ marginTop: 0 }}>
        Advanced. Steez works with its built-in Twitch app; only switch if you want logins to show your own app name.
      </p>
      <ol className="steps">
        <li>
          Open <a onClick={() => window.steez.open('https://dev.twitch.tv/console/apps/create')}>dev.twitch.tv/console/apps/create</a> and sign in.
        </li>
        <li>
          Name it anything. Add the OAuth Redirect URL <code>{REDIRECT}</code>{' '}
          <Button size="sm" icon="copy" onClick={() => copyText(REDIRECT)}>
            Copy
          </Button>
        </li>
        <li>Category: Chat Bot. Client Type: Public. Create, then copy the Client ID below.</li>
      </ol>
      <div className="row" style={{ marginTop: 12 }}>
        <input value={clientId} onChange={(e) => setClientId(e.target.value.trim())} placeholder="Twitch Client ID" />
        <Button variant="primary" disabled={!clientId} onClick={() => save(clientId)}>
          Save
        </Button>
      </div>
    </Panel>
  );
}

function Accounts({ twitch }) {
  const [state, setState] = useState(null);
  const load = () => api.get('/api/state').then(setState).catch(() => {});
  useEffect(() => {
    load();
  }, [twitch]);
  const login = async (role) => {
    toast('Finish the login in your browser');
    try {
      await api.post(`/api/auth/login/${role}`);
      toast('Twitch connected');
    } catch {
      /* toasted */
    }
    load();
  };
  const logout = async (role) => {
    await api.post(`/api/auth/disconnect/${role}`);
    load();
  };
  if (!state) return null;
  const row = (role, title, desc) => {
    const a = state.auth[role];
    return (
      <div className="acct-row">
        <div className="grow">
          <b>{title}</b>
          <div className="faint small">
            {a ? (a.expired ? `Login expired (${a.login})` : `Connected as ${a.login}`) : desc}
            {a && !a.expired && a.missingScopes?.length > 0 && ' · reconnect to grant the newest permissions'}
          </div>
        </div>
        {a && !a.expired && <Pill tone="good">Connected</Pill>}
        {a?.expired && <Pill tone="bad">Expired</Pill>}
        <Button size="sm" variant={a && !a.expired ? undefined : 'primary'} disabled={!state.config.clientIdSet} onClick={() => login(role)}>
          {a ? 'Reconnect' : 'Connect'}
        </Button>
        {a && (
          <Button size="sm" variant="danger" onClick={() => logout(role)}>
            Disconnect
          </Button>
        )}
      </div>
    );
  };
  return (
    <Panel title="Twitch accounts">
      {row('broadcaster', 'Your channel', 'Required. Chat, song requests, the queue and the bot all use this login.')}
      {row('bot', 'Custom bot account (optional)', 'Only if you want your own bot name instead of the shared one. Type /mod <name> in your chat after connecting.')}
      {!state.config.clientIdSet && <div className="help">Save a Twitch Client ID above first.</div>}
    </Panel>
  );
}

function BotIdentity({ twitch }) {
  const [state, setState] = useState(null);
  const load = () => api.get('/api/state').then(setState).catch(() => {});
  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [twitch]);
  if (!state) return null;
  const relay = state.status.relay || {};
  const custom = state.auth.bot && !state.auth.bot.expired;
  const mode = custom ? 'custom' : state.settings.general.botIdentity || 'steezbot';
  const setMode = async (botIdentity) => {
    await api.put('/api/settings', { general: { ...state.settings.general, botIdentity } });
    load();
  };
  const reconnect = async () => {
    toast('Finish the login in your browser');
    try {
      await api.post('/api/auth/login/broadcaster');
      toast('Twitch reconnected');
    } catch {
      /* toasted */
    }
    load();
  };
  const name = relay.bot?.display || 'SteezBot';
  let line;
  if (custom) line = `Talking as your bot account ${state.auth.bot.login}. Disconnect it below to use ${name} instead.`;
  else if (mode === 'self') line = `Bot replies come from your own account (${state.auth.broadcaster?.login || 'not connected'}).`;
  else if (!relay.configured) line = 'The shared bot is not available in this build — replies come from your account.';
  else if (!state.auth.broadcaster || state.auth.broadcaster.expired) line = `Connect your channel above — the bot's replies will come from ${name}.`;
  else if (relay.missingScope) line = `Reconnect Twitch once to let ${name} chat in your channel.`;
  else if (relay.active) line = `Replies come from ${name} with Twitch's Chat Bot badge. Nothing else to set up.`;
  else line = relay.error || `Connecting to ${name}…`;
  return (
    <Panel title="Bot identity" actions={relay.active && mode === 'steezbot' && !custom ? <Pill tone="good">{name} active</Pill> : null}>
      <div className="row" style={{ marginBottom: 10 }}>
        <div className="seg">
          <button className={mode === 'steezbot' ? 'active' : ''} disabled={custom} onClick={() => setMode('steezbot')}>
            {name}
          </button>
          <button className={mode === 'self' ? 'active' : ''} disabled={custom} onClick={() => setMode('self')}>
            My account
          </button>
          <button className={mode === 'custom' ? 'active' : ''} disabled>
            Custom bot
          </button>
        </div>
        {relay.missingScope && mode === 'steezbot' && !custom && (
          <Button size="sm" variant="primary" onClick={reconnect}>
            Reconnect Twitch
          </Button>
        )}
      </div>
      <div className="faint small">{line}</div>
      <div className="help">Moderation (timeouts, deleting messages, shield mode) always uses your own login, so the bot doesn't need to be a mod.</div>
    </Panel>
  );
}

function ApiKeys() {
  const [has, setHas] = useState({});
  const [keys, setKeys] = useState({ anthropicKey: '', youtubeKey: '' });
  const run = useAction();
  useEffect(() => {
    api.get('/api/secrets').then(setHas).catch(() => {});
  }, []);
  const save = (k) =>
    run(async () => {
      setHas(await api.put('/api/secrets', { [k]: keys[k] }));
      setKeys((s) => ({ ...s, [k]: '' }));
    }, 'Saved');
  return (
    <Panel title="Optional services">
      <Field label={`Anthropic API key ${has.anthropicKey ? '(set)' : ''}`} help="Turns on the AI features of the chat bot: @mentions, !ask, !catchup, !translate, ${ai} in commands, AI trivia and stream recaps. Usage is billed to your Anthropic account.">
        <div className="row">
          <input type="password" value={keys.anthropicKey} placeholder={has.anthropicKey ? '••••••••  (leave empty to keep)' : 'sk-ant-…'} onChange={(e) => setKeys({ ...keys, anthropicKey: e.target.value })} />
          <Button onClick={() => save('anthropicKey')}>Save</Button>
        </div>
      </Field>
      <Field label={`YouTube Data API key ${has.youtubeKey ? '(set)' : ''}`} help="Optional. Lets the chat bot look up YouTube videos by name.">
        <div className="row">
          <input type="password" value={keys.youtubeKey} placeholder={has.youtubeKey ? '••••••••  (leave empty to keep)' : 'AIza…'} onChange={(e) => setKeys({ ...keys, youtubeKey: e.target.value })} />
          <Button onClick={() => save('youtubeKey')}>Save</Button>
        </div>
      </Field>
    </Panel>
  );
}

function Updates({ update, settings, setSettings }) {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    window.steez.info().then(setInfo);
  }, []);
  const status = {
    unsupported: 'Updates only run in the installed app.',
    idle: 'Waiting to check',
    checking: 'Checking…',
    current: 'You are on the latest version.',
    downloading: `Downloading ${update?.newVersion || ''} — ${update?.percent || 0}%`,
    ready: `Version ${update?.newVersion} is ready to install.`,
    error: `Update check failed: ${update?.error || ''}`,
  }[update?.status || 'idle'];
  return (
    <Panel title="Updates">
      <div className="row" style={{ marginBottom: 12 }}>
        <div className="grow">
          <b>Steez {info?.version}</b>
          <div className="faint small">{status}</div>
        </div>
        {update?.status === 'ready' ? (
          <Button variant="primary" onClick={() => window.steez.update.install()}>
            Restart and install
          </Button>
        ) : (
          <Button icon="refresh" disabled={!update?.supported} onClick={() => window.steez.update.check()}>
            Check now
          </Button>
        )}
      </div>
      <Toggle
        label="Check for updates every time Steez starts"
        help="New versions download and install during the start-up screen, before the app opens."
        value={settings.checkUpdatesOnLaunch !== false}
        onChange={async (v) => setSettings(await window.steez.settings.set({ checkUpdatesOnLaunch: v }))}
      />
    </Panel>
  );
}

function Imports() {
  const [imp, setImp] = useState(null);
  useEffect(() => {
    window.steez.imports().then(setImp);
  }, []);
  if (!imp) return null;
  const ss = imp.songseek;
  const qu = imp.queueup;
  return (
    <Panel title="Imported from other apps">
      <div className="acct-row">
        <div className="grow">
          <b>SongSeek</b>
          <div className="faint small">
            {ss.found
              ? [ss.spotify && `Spotify login${ss.spotifyUser ? ` (${ss.spotifyUser})` : ''}`, ss.ownSpotifyApp && 'your Spotify app', ss.twitch && `Twitch (${ss.twitchUser})`, ss.twitchClientId && 'Twitch app', 'settings and queue']
                  .filter(Boolean)
                  .join(', ')
              : 'Not installed on this PC'}
          </div>
        </div>
        <Pill tone={ss.found ? 'good' : undefined}>{ss.found ? 'Found' : 'None'}</Pill>
      </div>
      <div className="acct-row">
        <div className="grow">
          <b>QueueUp</b>
          <div className="faint small">
            {qu.found ? `${qu.queued} queued, ${qu.party} in party, overlay style${qu.tiktok ? `, TikTok @${qu.tiktok}` : ''}` : 'Not installed on this PC'}
          </div>
        </div>
        <Pill tone={qu.found ? 'good' : undefined}>{qu.found ? 'Found' : 'None'}</Pill>
      </div>
      <div className="help">Steez reads these once on first launch. The original apps are never changed and can be uninstalled.</div>
    </Panel>
  );
}

export default function Settings({ twitch, update }) {
  const [tab, setTab] = useState('general');
  const [settings, setSettings] = useState(null);
  useEffect(() => {
    window.steez.settings.get().then(setSettings);
  }, []);
  if (!settings) return null;
  return (
    <>
      <PageHeader title="Settings" />
      <Tabs
        tabs={[
          { id: 'general', label: 'General' },
          { id: 'bot', label: 'Chat bot' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'general' ? (
        <div className="grid2">
          <div>
            <TwitchApp settings={settings} setSettings={setSettings} />
            <Accounts twitch={twitch} />
            <BotIdentity twitch={twitch} />
            <ApiKeys />
          </div>
          <div>
            <Updates update={update} settings={settings} setSettings={setSettings} />
            <Imports />
            <Panel title="Data">
              <div className="row">
                <div className="grow faint small">Settings, viewers, logs and backups are stored on this PC only.</div>
                <Button onClick={() => window.steez.openDataFolder()}>Open data folder</Button>
              </div>
            </Panel>
          </div>
        </div>
      ) : (
        <BotPage id="settings" />
      )}
      <style>{`
        .steps { margin: 0; padding-left: 18px; color: var(--text-2); line-height: 2; }
        .steps a { cursor: pointer; }
        .acct-row { display: flex; align-items: center; gap: 10px; padding: 10px 0; border-bottom: 1px solid var(--line); }
        .acct-row:last-of-type { border-bottom: 0; }
      `}</style>
    </>
  );
}
