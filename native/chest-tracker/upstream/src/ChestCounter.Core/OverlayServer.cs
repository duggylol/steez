using System.Net;
using System.Text;

namespace ChestCounter;

// Tiny local web server that serves a transparent stream overlay (add as a Browser Source in
// OBS / Streamlabs) plus a /stats.json the overlay polls. No dependencies — uses HttpListener.
public sealed class OverlayServer
{
    private readonly HttpListener _listener = new();
    public volatile string StatsJson = "{}";
    public Func<int?, string>? StatsBuilder; // builds stats JSON given the live count (preferred)
    public Func<string>? ConfigProvider;     // returns branding JSON, read fresh per request
    public volatile int LiveCountRaw = -1;   // -1 = null (no live match count)
    public int Port { get; }

    public int? LiveCount
    {
        get => LiveCountRaw < 0 ? null : LiveCountRaw;
        set => LiveCountRaw = value ?? -1;
    }

    public OverlayServer(int port = 7777)
    {
        Port = port;
        _listener.Prefixes.Add($"http://localhost:{port}/");
    }

    public void Start()
    {
        _listener.Start();
        _ = Task.Run(async () =>
        {
            while (_listener.IsListening)
            {
                HttpListenerContext ctx;
                try { ctx = await _listener.GetContextAsync(); }
                catch { break; }
                _ = Task.Run(() => Handle(ctx));
            }
        });
    }

    private void Handle(HttpListenerContext ctx)
    {
        try
        {
            string path = ctx.Request.Url?.AbsolutePath ?? "/";

            // POST /live?n=N  — a live OCR sensor (e.g. the Live tool) pushes this match's count here.
            if (path.StartsWith("/live"))
            {
                var q = ctx.Request.QueryString["n"];
                LiveCount = (q == null) ? null : (int.TryParse(q, out var nv) ? nv : (int?)null);
                WriteBody(ctx, "{\"ok\":true}", true);
                return;
            }

            bool json = true;
            string payload;
            if (path.StartsWith("/stats")) payload = StatsBuilder?.Invoke(LiveCount) ?? StatsJson;
            else if (path.StartsWith("/config")) payload = ConfigProvider?.Invoke() ?? "{}";
            else { payload = Html; json = false; }

            WriteBody(ctx, payload, json);
        }
        catch { /* client went away */ }
        finally { try { ctx.Response.Close(); } catch { } }
    }

    private static void WriteBody(HttpListenerContext ctx, string payload, bool json)
    {
        byte[] body = Encoding.UTF8.GetBytes(payload);
        ctx.Response.ContentType = json ? "application/json" : "text/html; charset=utf-8";
        ctx.Response.Headers["Access-Control-Allow-Origin"] = "*";
        ctx.Response.Headers["Cache-Control"] = "no-cache, no-store";
        ctx.Response.ContentLength64 = body.Length;
        ctx.Response.OutputStream.Write(body, 0, body.Length);
    }

    private const string Html = """
<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8">
<title>Chest Tracker Overlay</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..900&display=swap" rel="stylesheet">
<style>
  :root{ --accent:#F3F1EC; --text:#F3F1EC; --muted:#8A8A90; --gem:#FF3D6B; }
  html,body{margin:0;background:transparent;overflow:hidden;font-family:'Archivo',system-ui,sans-serif;}
  .card{
    width:290px; padding:18px 22px 14px; box-sizing:border-box;
    background:rgba(5,5,5,.93); border:1px solid rgba(255,255,255,.16); border-radius:10px;
    box-shadow:0 18px 48px rgba(0,0,0,.6); color:var(--text);
  }
  .hdr{display:flex;align-items:center;gap:9px;font-weight:600;font-size:13px;}
  .hdr .dot{width:8px;height:8px;border-radius:50%;background:var(--gem);margin-left:auto;
    animation:pulse 2.2s ease-out infinite;}
  @keyframes pulse{0%{box-shadow:0 0 0 0 rgba(255,61,107,.55)}70%{box-shadow:0 0 0 10px rgba(255,61,107,0)}100%{box-shadow:0 0 0 0 rgba(255,61,107,0)}}
  .label{margin-top:14px;font-size:12px;color:var(--muted);}
  .live{font-stretch:75%;font-weight:800;font-size:76px;line-height:.9;letter-spacing:-.01em;
        color:var(--accent);font-variant-numeric:tabular-nums;transform-origin:left center;transition:transform .14s ease;}
  .live.pulse-n{transform:scale(1.08)}
  .sub{display:flex;gap:28px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(255,255,255,.14)}
  .stat .k{font-size:11.5px;color:var(--muted);}
  .stat .v{font-stretch:75%;font-weight:700;font-size:24px;margin-top:1px;font-variant-numeric:tabular-nums;}
  .wm{margin-top:10px;font-size:10.5px;color:rgba(255,255,255,.42);text-align:right;}
</style></head>
<body>
  <div class="card">
    <div class="hdr"><span id="title">Chest Tracker</span><span class="dot"></span></div>
    <div class="label">Chests searched this match</div>
    <div class="live" id="live">0</div>
    <div class="sub">
      <div class="stat"><div class="k">Average</div><div class="v" id="avg">0.0</div></div>
      <div class="stat"><div class="k">Last game</div><div class="v" id="last">&#8212;</div></div>
    </div>
    <div class="wm" id="wm"></div>
  </div>
<script>
  let prev = null;
  async function tick(){
    try{
      const d = await (await fetch('/stats.json?'+Date.now())).json();
      const live = (d.live==null) ? 0 : d.live;
      const el = document.getElementById('live');
      if(prev!==null && live>prev){ el.classList.add('pulse-n'); setTimeout(()=>el.classList.remove('pulse-n'),170); }
      prev = live; el.textContent = live;
      document.getElementById('avg').textContent  = (d.avg||0).toFixed(1);
      document.getElementById('last').textContent = (d.last!=null) ? d.last : '—';
    }catch(e){}
  }
  async function cfg(){
    try{
      const c = await (await fetch('/config.json?'+Date.now())).json();
      if(c.accent) document.documentElement.style.setProperty('--accent', c.accent);
      if(c.title)  document.getElementById('title').textContent = c.title;
      document.getElementById('wm').textContent = c.domain || '';
    }catch(e){}
  }
  tick(); setInterval(tick, 1000);
  cfg();  setInterval(cfg, 2500);
</script>
</body></html>
""";
}
