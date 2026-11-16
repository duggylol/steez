import { useEffect, useState } from 'react';
import { PageHeader, Panel, Button, Empty, copyText } from '../ui.jsx';

export default function Overlays() {
  const [data, setData] = useState(null);
  useEffect(() => {
    window.steez.overlays().then(setData);
  }, []);
  if (!data) return null;
  const groups = {};
  for (const o of data.list) (groups[o.module] ||= []).push(o);
  const title = { Bot: 'Chat bot', songseek: 'Song requests', queueup: 'Viewer queue', subathon: 'Subathon' };
  return (
    <>
      <PageHeader title="OBS Overlays" sub="Add these in OBS as Browser Sources. Backgrounds are transparent; nothing shows until something happens." />
      <div className="banner">
        <div className="grow">
          In OBS: <b>Sources → + → Browser</b>, paste the URL, set the width and height shown, and leave <i>Shutdown source when not visible</i> unchecked.
        </div>
      </div>
      {!data.list.length && <Empty>No overlays available.</Empty>}
      {Object.entries(groups).map(([mod, list]) => (
        <Panel key={mod} title={title[mod] || mod}>
          <table>
            <tbody>
              {list.map((o) => {
                const url = 'url' in o ? o.url : data.baseUrl + o.path;
                return (
                  <tr key={o.id + o.path}>
                    <td style={{ width: '30%' }}>
                      <b>{o.name}</b>
                      <div className="faint small">{o.description}</div>
                    </td>
                    <td>
                      {url ? (
                        <code>{url}</code>
                      ) : (
                        <span className="faint">
                          Turn on the TV &amp; viewer server in <a href="#subathon">Subathon</a> to get this link.
                        </span>
                      )}
                    </td>
                    <td className="faint small nowrap-text" style={{ width: 90 }}>
                      {o.width && o.height ? `${o.width}×${o.height}` : ''}
                    </td>
                    <td style={{ width: 150 }}>
                      <div className="row nowrap" style={url ? undefined : { display: 'none' }}>
                        <Button size="sm" icon="copy" onClick={() => copyText(url)}>
                          Copy
                        </Button>
                        <Button size="sm" icon="external" onClick={() => window.steez.open(url)}>
                          Open
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Panel>
      ))}
    </>
  );
}
