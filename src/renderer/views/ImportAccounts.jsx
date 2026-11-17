// Import accounts: bring points, watch time, commands, timers, quotes and counters over from
// StreamElements or Streamlabs (or a points CSV). See src/main/accounts/.
import { useEffect, useState } from 'react';
import { Panel, Button, Toggle, Field, Seg, Stat, Pill, toast } from '../ui.jsx';

const A = () => window.steez.accounts;
const fmt = (n) => Number(n || 0).toLocaleString();

const SOURCES = [
  { id: 'streamelements', label: 'StreamElements' },
  { id: 'streamlabs', label: 'Streamlabs' },
  { id: 'csv', label: 'CSV file' },
];

export default function ImportAccounts({ go }) {
  const [tab, setTab] = useState('streamelements');
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState('');
  const [progress, setProgress] = useState('');
  const [result, setResult] = useState(null);

  useEffect(() => {
    A().state().then(setSt);
    const offP = A().onProgress((p) => setProgress(p?.text || ''));
    const offS = A().onState((s) => setSt(s));
    return () => {
      offP();
      offS();
    };
  }, []);

  const run = async (label, fn, ok) => {
    setBusy(label);
    setResult(null);
    try {
      const s = await fn();
      if (s) setSt(s);
      if (ok) toast(ok);
      return s;
    } catch (e) {
      toast(String(e?.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), { error: true });
      return null;
    } finally {
      setBusy('');
      setProgress('');
    }
  };

  const scanned = st?.scanned?.[tab];

  return (
    <>
      <div className="banner">
        <div className="grow">
          Moving over from another bot? Log in below and Steez brings your viewers’ points and watch time, custom commands, timers, quotes and counters.
          Nothing changes in your old account, and Steez saves a backup of its own data before anything is imported.
        </div>
      </div>
      <div className="row" style={{ marginBottom: 14 }}>
        <Seg options={SOURCES} value={tab} onChange={(t) => (setTab(t), setResult(null))} />
        {busy && (
          <span className="faint small">
            {busy}
            {progress ? ` — ${progress}` : '…'}
          </span>
        )}
      </div>

      {tab === 'streamelements' && <SePanel st={st?.streamelements} busy={busy} run={run} />}
      {tab === 'streamlabs' && <SlPanel st={st?.streamlabs} busy={busy} run={run} />}
      {tab === 'csv' && (
        <Panel title="Points from a spreadsheet">
          <p className="faint" style={{ marginTop: 0 }}>
            Exported your points from another bot (Streamlabs Chatbot, Fossabot, StreamElements CSV)? Pick the file. It needs a username column and a points column; a watch-time column in minutes or hours is used too.
          </p>
          <Button variant="primary" disabled={!!busy} onClick={() => run('Reading file', () => A().csv())}>
            Pick CSV file
          </Button>
        </Panel>
      )}

      {scanned && <Preview key={tab} provider={tab} s={scanned} busy={busy} run={run} onDone={setResult} />}
      {result && <Result r={result} go={go} />}
      <style>{CSS}</style>
    </>
  );
}

// ─── StreamElements ────────────────────────────────────────────────
function SePanel({ st, busy, run }) {
  const [name, setName] = useState('');
  const [token, setToken] = useState('');
  const [showToken, setShowToken] = useState(false);
  return (
    <Panel
      title="StreamElements"
      actions={st?.connected && <Pill tone={st.loggedIn ? 'good' : 'warn'}>{st.loggedIn ? `Logged in: ${st.channel}` : `Public data: ${st.channel}`}</Pill>}
    >
      {!st?.loggedIn ? (
        <>
          <div className="row">
            <Button variant="primary" disabled={!!busy} onClick={() => run('Waiting for StreamElements login', () => A().seLogin(), 'StreamElements connected')}>
              Log in with StreamElements
            </Button>
            <span className="faint small">A StreamElements window opens. Log in like normal; it closes by itself when you’re in.</span>
          </div>
          <div className="divider" />
          <div className="faint small" style={{ marginBottom: 6 }}>
            Or skip the login: points, watch time, commands and points settings are public, so your channel name is enough. Timers, quotes and counters need the login.
          </div>
          <div className="row">
            <input placeholder="Your Twitch channel name" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name && run('Finding channel', () => A().seChannel(name))} />
            <Button disabled={!!busy || !name.trim()} onClick={() => run('Finding channel', () => A().seChannel(name))}>
              Find channel
            </Button>
          </div>
          <div style={{ marginTop: 10 }}>
            <a className="small faint link" onClick={() => setShowToken(!showToken)}>
              {showToken ? 'Hide' : 'Login window not working? Paste your JWT token instead'}
            </a>
            {showToken && (
              <div className="row" style={{ marginTop: 8 }}>
                <input type="password" placeholder="StreamElements → Account → Channels → Show secrets → JWT Token" value={token} onChange={(e) => setToken(e.target.value)} />
                <Button disabled={!!busy || token.trim().length < 20} onClick={() => run('Checking token', () => A().seToken(token), 'StreamElements connected').then((s) => s && setToken(''))}>
                  Use token
                </Button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="faint">Connected. Steez keeps this login in memory only and forgets it when you close Steez.</div>
      )}
      {st?.connected && (
        <div className="row" style={{ marginTop: 14 }}>
          <Button variant="primary" icon="search" disabled={!!busy} onClick={() => run('Reading StreamElements', () => A().scan('streamelements'))}>
            Scan {st.channel}
          </Button>
          <Button size="sm" disabled={!!busy} onClick={() => run('Logging out', () => A().logout('streamelements'))}>
            Disconnect
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ─── Streamlabs ────────────────────────────────────────────────────
function SlPanel({ st, busy, run }) {
  return (
    <Panel title="Streamlabs Cloudbot" actions={st?.connected && <Pill tone="good">Logged in{st.account ? `: ${st.account}` : ''}</Pill>}>
      {!st?.connected ? (
        <div className="row">
          <Button variant="primary" disabled={!!busy} onClick={() => run('Waiting for Streamlabs login', () => A().slLogin(), 'Streamlabs connected')}>
            Log in with Streamlabs
          </Button>
          <span className="faint small">A Streamlabs window opens. Log in like normal; Steez notices when you’re in.</span>
        </div>
      ) : (
        <>
          <p className="faint" style={{ marginTop: 0 }}>
            Streamlabs has no public export, so Steez opens your Cloudbot pages in the background and keeps what they show: loyalty points and watch time, custom commands, timers and quotes. This takes about a minute (longer with lots of viewers).
          </p>
          <div className="row">
            <Button variant="primary" icon="search" disabled={!!busy} onClick={() => run('Reading Streamlabs', () => A().scan('streamlabs'))}>
              Scan Cloudbot
            </Button>
            <Button disabled={!!busy} onClick={() => run('Streamlabs window open — close it when done', () => A().slBrowse())}>
              Open Streamlabs
            </Button>
            <Button size="sm" disabled={!!busy} onClick={() => run('Logging out', () => A().logout('streamlabs'))}>
              Log out
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

// ─── Preview + options ─────────────────────────────────────────────
function Preview({ provider, s, busy, run, onDone }) {
  const [points, setPoints] = useState('max');
  const [commands, setCommands] = useState('keep');
  const [timers, setTimers] = useState(true);
  const [quotes, setQuotes] = useState(true);
  const [counters, setCounters] = useState(true);
  const [loyaltySettings, setLoyaltySettings] = useState(true);
  const L = s.loyalty;
  const nothing = !s.users && !s.commands && !s.timers && !s.quotes && !s.counters;

  const apply = () =>
    run('Importing', async () => {
      const r = await A().apply(provider, { points, commands, timers, quotes, counters, loyaltySettings: !!L && loyaltySettings });
      onDone(r);
      toast('Imported into Steez');
      return null;
    });

  return (
    <Panel title={`Found in ${s.channel || provider}`}>
      <div className="row imp-stats">
        <Stat value={fmt(s.users)} label="Viewers" />
        <Stat value={fmt(s.points)} label="Points total" />
        <Stat value={fmt(Math.round(s.minutes / 60))} label="Hours watched" />
        <Stat value={fmt(s.commands)} label="Commands" />
        <Stat value={fmt(s.timers)} label="Timers" />
        <Stat value={fmt(s.quotes)} label="Quotes" />
        <Stat value={fmt(s.counters)} label="Counters" />
      </div>
      {s.notes?.map((n) => (
        <div key={n} className="banner warn" style={{ marginTop: 12 }}>
          <div className="grow">{n}</div>
        </div>
      ))}
      {nothing ? (
        <div className="empty" style={{ marginTop: 12 }}>
          Nothing to import was found.
        </div>
      ) : (
        <>
          <div className="grid2" style={{ marginTop: 14 }}>
            {s.top?.length > 0 && (
              <div className="inset imp-list">
                <div className="faint small imp-h">Top viewers</div>
                {s.top.map((u) => (
                  <div key={u.login} className="row nowrap">
                    <span className="grow">{u.display}</span>
                    <span className="mono">{fmt(u.points)}</span>
                    <span className="faint small mono" style={{ width: 70, textAlign: 'right' }}>
                      {fmt(Math.round(u.minutes / 60))}h
                    </span>
                  </div>
                ))}
              </div>
            )}
            {s.commandSamples?.length > 0 && (
              <div className="inset imp-list">
                <div className="faint small imp-h">Commands</div>
                {s.commandSamples.map((c) => (
                  <div key={c.name} className="row nowrap">
                    <span className="mono" style={{ minWidth: 90 }}>!{c.name}</span>
                    <span className="faint grow ellipsis">{c.response}</span>
                  </div>
                ))}
                {s.commands > s.commandSamples.length && <div className="faint small">and {fmt(s.commands - s.commandSamples.length)} more</div>}
              </div>
            )}
          </div>

          <div className="divider" />
          <div className="grid2">
            <div>
              {s.users > 0 && (
                <Field label="Points and watch time" help={points === 'max' ? 'Each viewer ends up with whichever is higher. Safe to run more than once.' : points === 'add' ? 'Adds on top of what viewers already have in Steez. Running it twice counts twice.' : points === 'replace' ? 'Viewers in the import get exactly the imported numbers.' : 'Points are left alone.'}>
                  <Seg
                    options={[
                      { id: 'max', label: 'Keep the higher' },
                      { id: 'add', label: 'Add together' },
                      { id: 'replace', label: 'Replace' },
                      { id: 'skip', label: 'Skip' },
                    ]}
                    value={points}
                    onChange={setPoints}
                  />
                </Field>
              )}
              {s.commands > 0 && (
                <Field label="Commands with the same name as one in Steez" help="Commands that share a name with a Steez built-in (like !points) come in switched off, so Steez’s own keeps working.">
                  <Seg
                    options={[
                      { id: 'keep', label: 'Keep Steez’s' },
                      { id: 'overwrite', label: 'Use imported' },
                      { id: 'skip', label: 'Import no commands' },
                    ]}
                    value={commands}
                    onChange={setCommands}
                  />
                </Field>
              )}
            </div>
            <div>
              {s.timers > 0 && <Toggle value={timers} onChange={setTimers} label={`Import ${fmt(s.timers)} timers`} />}
              {s.quotes > 0 && <Toggle value={quotes} onChange={setQuotes} label={`Import ${fmt(s.quotes)} quotes`} help="Quotes already in Steez aren’t added twice." />}
              {s.counters > 0 && <Toggle value={counters} onChange={setCounters} label={`Import ${fmt(s.counters)} counters`} />}
              {L && (
                <Toggle
                  value={loyaltySettings}
                  onChange={setLoyaltySettings}
                  label={`Use their points settings${L.currencyName ? ` (“${L.currencyName}”` : ''}${L.pointsPerInterval ? `, ${L.pointsPerInterval} every ${L.intervalMinutes || '?'} min` : ''}${L.currencyName ? ')' : ''}`}
                  help="Points name, how many viewers earn and how often, sub multiplier and bonuses."
                />
              )}
            </div>
          </div>
          <div className="row" style={{ marginTop: 6 }}>
            <Button variant="primary" icon="check" disabled={!!busy} onClick={apply}>
              Import into Steez
            </Button>
          </div>
        </>
      )}
    </Panel>
  );
}

function Result({ r, go }) {
  const lines = [
    r.users.added || r.users.updated ? `${fmt(r.users.added)} new viewers, ${fmt(r.users.updated)} existing viewers updated` : null,
    r.commands.added || r.commands.replaced || r.commands.kept ? `${fmt(r.commands.added)} commands added${r.commands.replaced ? `, ${fmt(r.commands.replaced)} replaced` : ''}${r.commands.kept ? `, ${fmt(r.commands.kept)} kept as they were in Steez` : ''}` : null,
    r.commands.off.length ? `Switched off because Steez has a built-in with the same name: ${r.commands.off.map((n) => '!' + n).join(', ')}` : null,
    r.timers ? `${fmt(r.timers)} timers added` : null,
    r.quotes ? `${fmt(r.quotes)} quotes added` : null,
    r.counters ? `${fmt(r.counters)} counters set` : null,
    r.loyaltySettings ? 'Points settings updated' : null,
  ].filter(Boolean);
  return (
    <Panel title="Imported">
      {lines.length ? lines.map((l) => <div key={l}>✓ {l}</div>) : <div className="faint">Nothing new to bring in — it was all already here.</div>}
      {r.backup && <div className="faint small" style={{ marginTop: 8 }}>Backup of your data from before the import: {r.backup}</div>}
      <div className="row" style={{ marginTop: 12 }}>
        <Button size="sm" onClick={() => go('loyalty')}>Points & Viewers</Button>
        <Button size="sm" onClick={() => go('commands')}>Commands</Button>
        <Button size="sm" onClick={() => go('timers')}>Timers</Button>
        <Button size="sm" onClick={() => go('quotes')}>Quotes</Button>
      </div>
      <div className="faint small" style={{ marginTop: 8 }}>
        Imported commands and timers only run while the Chat bot is switched on (Dashboard → Features).
      </div>
    </Panel>
  );
}

const CSS = `
  .imp-stats .stat { min-width: 96px; }
  .imp-list { padding: 10px 12px; display: flex; flex-direction: column; gap: 5px; }
  .imp-h { text-transform: uppercase; letter-spacing: .1em; margin-bottom: 2px; }
  .ellipsis { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  a.link { cursor: pointer; text-decoration: underline; }
`;
