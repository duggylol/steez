// First-run guide, shown on the Song Requests page until setup is complete (or skipped).
import { useState } from 'react';
import { PageHeader, Panel, Field } from '../../ui.jsx';
import { useMusic } from './store.js';
import { disconnectSpotify } from './engine.js';
import { OwnAppSteps, SpotifyButtons, SpotifyStatusLine, TextSetting, TwitchStatus, SPOTIFY_REDIRECT } from './parts.jsx';
import { notify } from './util.js';

/** Static picture of the form being described, so it's obvious what to fill in. */
function Mock({ url, rows }) {
  return (
    <div className="mu-mock">
      <div className="mu-mock-bar">{url}</div>
      {rows.map(([label, value, hi]) => (
        <div className="mu-mock-row" key={label}>
          <span>{label}</span>
          <b className={hi ? 'hi' : ''}>{value}</b>
        </div>
      ))}
    </div>
  );
}

export default function Setup() {
  const settings = useMusic((s) => s.settings) || {};
  const patchSettings = useMusic((s) => s.patchSettings);
  const spotify = useMusic((s) => s.spotify);
  const twitch = useMusic((s) => s.twitch);
  const [i, setI] = useState(0);
  const spotifyOk = spotify.connected && !spotify.needsReconnect;
  const builtIn = !!settings._bundled?.spotifyApp;

  const finish = async () => {
    await patchSettings({ setupComplete: true });
    notify('Song requests are ready');
  };
  const saveClientId = async (v) => {
    // A login belongs to the app that issued it — switching apps means logging in again.
    if (spotify.connected) await disconnectSpotify();
    await patchSettings({ spotifyUserClientId: v });
  };

  const steps = [
    {
      title: 'Song requests',
      lede: 'Viewers request songs with channel points or !sr. Requests resolve on Spotify, then YouTube, then SoundCloud.',
      body: (
        <ul className="mu-steps plain">
          <li>
            <b>Spotify Premium</b> — required by Spotify for playback control. Your own Spotify app keeps playing; requests are slotted into its queue.
          </li>
          <li>
            <b>A free Spotify developer app</b> — yours, so nothing is shared or rate limited. Takes about two minutes.
          </li>
          <li>
            <b>Twitch</b> — the same login Steez uses for the chat bot. Channel points need Affiliate or Partner; !sr works everywhere.
          </li>
          <li>
            <b>YouTube and SoundCloud</b> requests play inside Steez and pause Spotify while they run.
          </li>
        </ul>
      ),
      canNext: true,
    },
    {
      title: 'Create your Spotify app',
      lede: 'Spotify requires every app that controls playback to be registered. Yours is free.',
      visual: (
        <Mock
          url="developer.spotify.com/dashboard → Create app"
          rows={[
            ['App name', 'Steez'],
            ['Redirect URI', SPOTIFY_REDIRECT, true],
            ['APIs used', 'Web API ✓'],
          ]}
        />
      ),
      body: <OwnAppSteps />,
      canNext: true,
    },
    {
      title: 'Connect Spotify',
      lede: 'Paste your app’s Client ID, then log in. Keep the Spotify app open while you stream.',
      visual: <Mock url="your app → Settings" rows={[['Client ID', '5359109893384ef2…', true], ['Client secret', 'not needed']]} />,
      body: (
        <>
          <Field label="Spotify Client ID" help={builtIn ? 'Leave empty to use the built-in Spotify app.' : undefined}>
            <TextSetting value={settings.spotifyUserClientId} placeholder="paste it here" mono onSave={saveClientId} />
          </Field>
          <div className="row">
            <SpotifyButtons allowDisconnect={false} />
            <SpotifyStatusLine />
          </div>
        </>
      ),
      canNext: spotifyOk,
      blocked: 'Connect Spotify to continue',
    },
    {
      title: 'Twitch',
      lede: 'Song requests use Steez’s Twitch connection — the same one as the chat bot.',
      body: (
        <>
          <TwitchStatus />
          <p className="help">!sr, !song and the mod commands (!skip, !pause, !play, !clearqueue) appear on the Commands page, where you can change permissions, cooldowns and aliases.</p>
        </>
      ),
      canNext: true,
    },
    {
      title: 'Channel point reward',
      lede: 'Optional — skip this if you’re not an Affiliate. The !sr command works for everyone.',
      visual: (
        <Mock
          url="dashboard.twitch.tv → Viewer Rewards → Channel Points"
          rows={[
            ['Reward name', settings.rewardName || 'Song Request', true],
            ['Require viewer to enter text', 'On'],
          ]}
        />
      ),
      body: (
        <>
          <ol className="mu-steps">
            <li>
              On your Twitch dashboard open <b>Viewer Rewards → Channel Points → Manage Rewards</b>.
            </li>
            <li>
              Add a custom reward and turn on <b>Require viewer to enter text</b>.
            </li>
            <li>Give it exactly this name:</li>
          </ol>
          <Field label="Reward name">
            <TextSetting value={settings.rewardName} placeholder="Song Request" onSave={(v) => patchSettings({ rewardName: v })} />
          </Field>
        </>
      ),
      canNext: true,
    },
    {
      title: 'You’re set',
      lede: 'Open Spotify, press play, and let chat take over.',
      body: (
        <ul className="mu-steps plain">
          <li>Requests go into Spotify’s own queue — your playlist keeps going afterwards.</li>
          <li>
            Mods can use <code>!skip</code> <code>!pause</code> <code>!play</code> <code>!clearqueue</code>; everyone can use <code>!song</code>.
          </li>
          <li>The now-playing overlay for OBS, sources and chat options are under Song Requests → Settings.</li>
          {!twitch.connected && <li className="faint">Twitch isn’t connected yet — requests start once it is.</li>}
        </ul>
      ),
      canNext: true,
    },
  ];
  const step = steps[i];
  const last = i === steps.length - 1;

  return (
    <>
      <PageHeader title="Song Requests" sub="First-time setup">
        <button className="ghost" onClick={finish}>
          Skip setup
        </button>
      </PageHeader>
      <div className="mu-setup">
        <div className="mu-stepper">
          {steps.map((s, n) => (
            <button key={s.title} className={`${n === i ? 'on' : ''} ${n < i ? 'done' : ''}`} onClick={() => n < i && setI(n)} disabled={n > i}>
              <span>{n + 1}</span>
              {s.title}
            </button>
          ))}
        </div>
        <Panel className="mu-setup-card">
          <div className="mu-setup-inner" key={i}>
            <div className="mu-setup-text">
              <div className="faint small">
                Step {i + 1} of {steps.length}
              </div>
              <h2>{step.title}</h2>
              <p className="muted">{step.lede}</p>
              <div>{step.body}</div>
            </div>
            {step.visual && <div className="mu-setup-visual">{step.visual}</div>}
          </div>
          <div className="mu-setup-nav">
            {i > 0 && <button onClick={() => setI(i - 1)}>Back</button>}
            <div className="grow" />
            {last ? (
              <button className="primary" onClick={finish}>
                Finish
              </button>
            ) : (
              <button className="primary" disabled={!step.canNext} onClick={() => setI(i + 1)}>
                {step.canNext ? 'Next' : step.blocked}
              </button>
            )}
          </div>
        </Panel>
      </div>
    </>
  );
}
