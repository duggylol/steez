// OBS Overlays: every browser source Steez serves, each with a preview (sample content) on a mock
// stream scene, its link and size.
import { useEffect, useRef, useState } from 'react';
import { PageHeader, Button, Empty, copyText } from '../ui.jsx';

const GROUP_TITLE = { Bot: 'Chat bot', songseek: 'Song requests', queueup: 'Viewer queue & TikTok', subathon: 'Subathon', chests: 'Fortnite chests' };
const GROUP_ORDER = ['Bot', 'subathon', 'chests', 'queueup', 'songseek'];

// Previews run each overlay in its sample mode, so there's always something to see.
function previewUrl(o, url) {
  if (!url) return '';
  const add = (q) => url + (url.includes('?') ? '&' : '?') + q;
  if (['gifts', 'tiktok-rank', 'tiktok-gallery'].includes(o.id)) return add('editor=1');
  if (o.id === 'subathon-tv') return add('fxdemo=1');
  return add('demo=1');
}

/** The overlay itself, scaled down onto a small stand-in for your stream. Loads when scrolled into view. */
function Preview({ url, width, height, reloadKey }) {
  const box = useRef(null);
  const [scale, setScale] = useState(0);
  const [visible, setVisible] = useState(false);
  const w = width || 1920;
  const h = height || 1080;
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const fit = () => {
      const bw = el.clientWidth;
      const bh = el.clientHeight;
      // Full-screen overlays fill the scene; small ones sit inside it at a readable size.
      const s = Math.min(bw / w, bh / h) * (w >= 1280 ? 1 : 0.86);
      setScale(Math.min(s, 1));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    const io = new IntersectionObserver((e) => e[0].isIntersecting && setVisible(true), { rootMargin: '200px' });
    io.observe(el);
    return () => {
      ro.disconnect();
      io.disconnect();
    };
  }, [w, h]);
  return (
    <div className="ov-stage" ref={box}>
      {url && visible && scale > 0 ? (
        <iframe
          key={reloadKey}
          title="Overlay preview"
          src={url}
          tabIndex={-1}
          style={{ width: w, height: h, transform: `translate(-50%, -50%) scale(${scale})` }}
          sandbox="allow-scripts allow-same-origin"
        />
      ) : null}
      {!url && <div className="ov-stage-note">Turn on the TV & viewer server in Subathon to preview this.</div>}
    </div>
  );
}

function OverlayCard({ o, url }) {
  const [reloadKey, setReloadKey] = useState(0);
  return (
    <div className="ov-card" data-overlay={o.id}>
      <Preview url={previewUrl(o, url)} width={o.width} height={o.height} reloadKey={reloadKey} />
      <div className="ov-body">
        <div className="row nowrap" style={{ alignItems: 'baseline' }}>
          <b className="grow ov-name">{o.name}</b>
          {o.width && o.height ? <span className="faint small">{`${o.width} × ${o.height}`}</span> : null}
        </div>
        <div className="faint small ov-desc">{o.description}</div>
        {url ? <code className="ov-url" title={url}>{url}</code> : <span className="faint small">No link until the server is on.</span>}
        <div className="row ov-actions">
          <Button size="sm" variant="primary" icon="copy" disabled={!url} onClick={() => copyText(url, 'Link copied — paste it into an OBS Browser Source')}>
            Copy link
          </Button>
          <Button size="sm" icon="external" disabled={!url} onClick={() => window.steez.open(url)} title="Open the live overlay in your browser">
            Open live
          </Button>
          <span className="grow" />
          <Button size="sm" variant="ghost" icon="refresh" title="Restart the preview" onClick={() => setReloadKey((k) => k + 1)} />
        </div>
      </div>
    </div>
  );
}

export default function Overlays() {
  const [data, setData] = useState(null);
  useEffect(() => {
    window.steez.overlays().then(setData);
  }, []);
  if (!data) return null;
  const groups = {};
  for (const o of data.list) (groups[o.module] ||= []).push(o);
  const keys = Object.keys(groups).sort((a, b) => (GROUP_ORDER.indexOf(a) + 1 || 99) - (GROUP_ORDER.indexOf(b) + 1 || 99));
  return (
    <>
      <PageHeader title="OBS Overlays" sub="Previews show sample content. In OBS, add a Browser Source, paste the link, use the size shown, and leave “Shutdown source when not visible” unchecked." />
      {!data.list.length && <Empty>No overlays available.</Empty>}
      {keys.map((mod) => (
        <section key={mod} className="ov-group">
          <h2 className="ov-group-title">{GROUP_TITLE[mod] || mod}</h2>
          <div className="ov-grid">
            {groups[mod].map((o) => (
              <OverlayCard key={o.id + o.path} o={o} url={'url' in o ? o.url : data.baseUrl + o.path} />
            ))}
          </div>
        </section>
      ))}
      <style>{CSS}</style>
    </>
  );
}

const CSS = `
  .ov-group { margin-bottom: 30px; }
  .ov-group-title { font: 600 17px/1.2 var(--display); letter-spacing: -0.015em; margin-bottom: 14px; }
  /* Cards share each row evenly; a short last row stretches instead of leaving a hole. */
  .ov-grid { display: flex; flex-wrap: wrap; gap: 16px; }
  .ov-card { flex: 1 1 340px; max-width: 100%; background: var(--surface); border: 1px solid var(--line); border-radius: var(--r-card); overflow: hidden; display: flex; flex-direction: column; }
  .ov-stage {
    position: relative; height: 210px; overflow: hidden; border-bottom: 1px solid var(--line);
    /* a stand-in for game footage, so the transparent overlay reads as "on stream" */
    background:
      radial-gradient(120% 90% at 85% 110%, #2b2350 0%, transparent 55%),
      radial-gradient(80% 70% at 10% 0%, #16324a 0%, transparent 60%),
      linear-gradient(180deg, #121426, #0b0c16);
  }
  .ov-stage::after { content: ''; position: absolute; inset: 0; pointer-events: none; background-image: linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px); background-size: 24px 24px; }
  .ov-stage iframe { position: absolute; left: 50%; top: 50%; border: 0; background: transparent; transform-origin: 50% 50%; pointer-events: none; color-scheme: normal; }
  .ov-stage-note { position: absolute; inset: 0; display: grid; place-items: center; padding: 20px; text-align: center; color: var(--text-3); font-size: 12.5px; }
  .ov-body { padding: 14px 16px 16px; display: flex; flex-direction: column; gap: 7px; flex: 1; }
  .ov-name { font-size: 14px; }
  .ov-desc { line-height: 1.45; flex: 1; }
  .ov-url { display: block; background: var(--bg-sunk); border: 1px solid var(--line); border-radius: 8px; padding: 6px 9px; color: var(--text-2); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; font-size: 11.5px; }
  .ov-actions { margin-top: 4px; }
  .ov-actions .ghost { padding: 4px 7px; }
`;
