// SteezChestBridge.exe — runs on the game PC, lives in the system tray (no window).
//
// It finds Steez on the home network (UDP broadcast to port 43120; Steez answers with its WebSocket
// port), connects, and waits until the streamer allows this PC in Steez. From then on it counts
// chests here (the "+XP CHEST" popup while a match is on, and the replays after) and Steez drives it
// with the same commands as the same-PC helper (../shared/Tracker.cs). It remembers Steez and its
// pairing in %APPDATA%\SteezChestBridge\bridge.json and reconnects by itself.
//
// Kept light for a gaming PC: below-normal priority, the screen is only read while a Fortnite match
// is on, and frames without popup text never reach the OCR.
using System.Drawing;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Threading.Channels;
using Steez.ChestTracker;
using Microsoft.Win32;

namespace Steez.ChestBridge;

internal static class Program
{
    public const int DiscoveryPort = 43120;
    public const string Version = "1";

    [STAThread]
    private static void Main(string[] args)
    {
        using var single = new Mutex(true, "SteezChestBridge.SingleInstance", out bool first);
        if (!first) return; // already running in the tray
        try { System.Diagnostics.Process.GetCurrentProcess().PriorityClass = System.Diagnostics.ProcessPriorityClass.BelowNormal; } catch { }
        Application.SetHighDpiMode(HighDpiMode.PerMonitorV2);
        Application.EnableVisualStyles();
        Application.Run(new TrayApp(args.Contains("--startup")));
    }
}

/// What the bridge remembers between runs.
internal sealed class BridgeConfig
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string? Token { get; set; }
    public string? Host { get; set; }
    public int Port { get; set; }
    public string? SteezName { get; set; }
    public bool Paused { get; set; }
    public bool AskedStartup { get; set; }

    // STEEZ_BRIDGE_HOME: a different settings folder (for testing).
    private static string Dir => Environment.GetEnvironmentVariable("STEEZ_BRIDGE_HOME") is { Length: > 0 } home ? home
        : Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "SteezChestBridge");
    private static string FilePath => Path.Combine(Dir, "bridge.json");

    public static BridgeConfig Load()
    {
        try { return JsonSerializer.Deserialize<BridgeConfig>(File.ReadAllText(FilePath)) ?? new(); }
        catch { return new(); }
    }

    public void Save()
    {
        try
        {
            Directory.CreateDirectory(Dir);
            File.WriteAllText(FilePath, JsonSerializer.Serialize(this, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch { /* not fatal */ }
    }
}

internal static class Startup
{
    private const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string Name = "SteezChestBridge";

    public static bool Enabled
    {
        get
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey);
            return k?.GetValue(Name) is string;
        }
        set
        {
            using var k = Registry.CurrentUser.OpenSubKey(RunKey, writable: true) ?? Registry.CurrentUser.CreateSubKey(RunKey);
            if (value) k.SetValue(Name, $"\"{Environment.ProcessPath}\" --startup");
            else k.DeleteValue(Name, throwOnMissingValue: false);
        }
    }
}

internal sealed class TrayApp : ApplicationContext
{
    private readonly NotifyIcon _icon;
    private readonly ToolStripMenuItem _statusItem = new("Starting…") { Enabled = false };
    private readonly ToolStripMenuItem _countItem = new("Not in a match") { Enabled = false };
    private readonly ToolStripMenuItem _pauseItem = new("Pause counting");
    private readonly ToolStripMenuItem _startupItem = new("Start with Windows");
    private readonly SynchronizationContext _ui;
    private readonly BridgeConfig _cfg = BridgeConfig.Load();
    private readonly Tracker _tracker;
    private readonly Channel<string> _outbox = Channel.CreateBounded<string>(new BoundedChannelOptions(200) { FullMode = BoundedChannelFullMode.DropOldest });
    private readonly CancellationTokenSource _quit = new();
    private ClientWebSocket? _ws;
    private string _status = "Looking for Steez on your network…";
    private int? _live;
    private bool _wantLive; // what Steez asked for; pausing overrides it
    private bool _toldPending;

    public TrayApp(bool fromStartup)
    {
        _ui = SynchronizationContext.Current ?? new WindowsFormsSynchronizationContext();
        _tracker = new Tracker(line => _outbox.Writer.TryWrite(line));
        _tracker.Counter.LowPower = true; // a game PC: only read the screen while a Fortnite match is on
        _tracker.LiveChanged += n => { _live = n; Ui(Refresh); };

        _pauseItem.Click += (_, _) =>
        {
            _cfg.Paused = !_cfg.Paused;
            _cfg.Save();
            _tracker.SetLive(_wantLive && !_cfg.Paused);
            Refresh();
        };
        _startupItem.Click += (_, _) =>
        {
            try { Startup.Enabled = !Startup.Enabled; } catch { }
            Refresh();
        };
        var addressItem = new ToolStripMenuItem("Connect to Steez by address…");
        addressItem.Click += (_, _) => AskAddress();
        var forgetItem = new ToolStripMenuItem("Forget this Steez");
        forgetItem.Click += (_, _) =>
        {
            if (MessageBox.Show("Forget the Steez this PC is paired with? You'll need to allow this PC in Steez again.", "Steez Chest Bridge", MessageBoxButtons.OKCancel, MessageBoxIcon.Question) != DialogResult.OK) return;
            _cfg.Token = null;
            _cfg.Host = null;
            _cfg.SteezName = null;
            _cfg.Save();
            try { _ws?.Abort(); } catch { }
        };
        var quitItem = new ToolStripMenuItem("Quit");
        quitItem.Click += (_, _) => Quit();

        var menu = new ContextMenuStrip();
        menu.Items.Add(new ToolStripMenuItem("Steez Chest Bridge") { Enabled = false, Font = new Font(SystemFonts.MenuFont ?? Control.DefaultFont, FontStyle.Bold) });
        menu.Items.Add(_statusItem);
        menu.Items.Add(_countItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(_pauseItem);
        menu.Items.Add(_startupItem);
        menu.Items.Add(addressItem);
        menu.Items.Add(forgetItem);
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add(quitItem);
        menu.Opening += (_, _) => Refresh();

        _icon = new NotifyIcon { Icon = LoadIcon(), Visible = true, ContextMenuStrip = menu, Text = "Steez Chest Bridge" };
        _icon.MouseClick += (_, e) =>
        {
            if (e.Button == MouseButtons.Left) typeof(NotifyIcon).GetMethod("ShowContextMenu", System.Reflection.BindingFlags.Instance | System.Reflection.BindingFlags.NonPublic)?.Invoke(_icon, null);
        };

        // The first time: start with Windows, so it's always there for Steez (one click to undo).
        if (!_cfg.AskedStartup)
        {
            _cfg.AskedStartup = true;
            _cfg.Save();
            // STEEZ_BRIDGE_NO_STARTUP: leave Windows startup alone (for testing).
            if (Environment.GetEnvironmentVariable("STEEZ_BRIDGE_NO_STARTUP") != "1")
                try { Startup.Enabled = true; } catch { }
            Balloon("Steez Chest Bridge is running", "It sits here in the tray and starts with Windows. Open Steez on your stream PC to allow this PC.");
        }

        Refresh();
        _ = Task.Run(() => ConnectLoop(_quit.Token));
        _ = Task.Run(() => SendLoop(_quit.Token));
    }

    private static Icon LoadIcon()
    {
        try
        {
            using var s = typeof(TrayApp).Assembly.GetManifestResourceStream("chest.ico");
            if (s != null) return new Icon(s, SystemInformation.SmallIconSize);
        }
        catch { }
        return SystemIcons.Application;
    }

    private void Ui(Action a) => _ui.Post(_ => a(), null);

    private void SetStatus(string s)
    {
        _status = s;
        Ui(Refresh);
    }

    private void Refresh()
    {
        _statusItem.Text = _status;
        _countItem.Text = _cfg.Paused ? "Counting is paused" : _live is int n ? $"This match: {n} chest{(n == 1 ? "" : "s")}" : "Not in a match";
        _pauseItem.Checked = _cfg.Paused;
        try { _startupItem.Checked = Startup.Enabled; } catch { }
        var tip = $"Steez Chest Bridge — {_status}";
        _icon.Text = tip.Length > 120 ? tip[..120] : tip;
    }

    private void Balloon(string title, string text)
    {
        Ui(() =>
        {
            _icon.BalloonTipTitle = title;
            _icon.BalloonTipText = text;
            _icon.ShowBalloonTip(6000);
        });
    }

    private void AskAddress()
    {
        using var f = new Form { Text = "Connect to Steez", FormBorderStyle = FormBorderStyle.FixedDialog, MaximizeBox = false, MinimizeBox = false, StartPosition = FormStartPosition.CenterScreen, ClientSize = new Size(380, 130), TopMost = true };
        var label = new Label { Text = "Your stream PC's address (shown on Steez's Fortnite Chests page):", Left = 12, Top = 12, Width = 356, Height = 34 };
        var box = new TextBox { Left = 12, Top = 50, Width = 356, Text = _cfg.Host ?? "" };
        var ok = new Button { Text = "Connect", Left = 212, Top = 88, Width = 75, DialogResult = DialogResult.OK };
        var cancel = new Button { Text = "Cancel", Left = 293, Top = 88, Width = 75, DialogResult = DialogResult.Cancel };
        f.Controls.AddRange([label, box, ok, cancel]);
        f.AcceptButton = ok;
        f.CancelButton = cancel;
        if (f.ShowDialog() != DialogResult.OK) return;
        var text = box.Text.Trim();
        if (text.Length == 0) return;
        var parts = text.Replace("ws://", "").Replace("http://", "").TrimEnd('/').Split(':');
        _cfg.Host = parts[0];
        _cfg.Port = parts.Length > 1 && int.TryParse(parts[1], out var p) ? p : 43121;
        _cfg.Save();
        try { _ws?.Abort(); } catch { }
    }

    private void Quit()
    {
        _quit.Cancel();
        try { _ws?.Abort(); } catch { }
        _tracker.SetLive(false);
        _icon.Visible = false;
        _icon.Dispose();
        ExitThread();
    }

    // ─── Finding Steez ─────────────────────────────────────────────
    private static IEnumerable<IPAddress> BroadcastAddresses()
    {
        var list = new List<IPAddress> { IPAddress.Broadcast, IPAddress.Loopback };
        foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
        {
            if (nic.OperationalStatus != OperationalStatus.Up || nic.NetworkInterfaceType == NetworkInterfaceType.Loopback) continue;
            foreach (var ua in nic.GetIPProperties().UnicastAddresses)
            {
                if (ua.Address.AddressFamily != AddressFamily.InterNetwork || ua.IPv4Mask == null) continue;
                var ip = ua.Address.GetAddressBytes();
                var mask = ua.IPv4Mask.GetAddressBytes();
                var b = new byte[4];
                for (int i = 0; i < 4; i++) b[i] = (byte)(ip[i] | ~mask[i]);
                list.Add(new IPAddress(b));
            }
        }
        return list.Distinct();
    }

    /// Ask the network where Steez is. Answers: {"steez":"chests","name":"STREAM-PC","port":43121}
    private static async Task<(string host, int port, string name)?> Discover(CancellationToken ct)
    {
        using var udp = new UdpClient(AddressFamily.InterNetwork) { EnableBroadcast = true };
        var ask = Encoding.UTF8.GetBytes("{\"steez\":\"chests?\",\"v\":" + Program.Version + "}");
        foreach (var addr in BroadcastAddresses())
        {
            try { await udp.SendAsync(ask, new IPEndPoint(addr, Program.DiscoveryPort), ct); } catch { }
        }
        var deadline = DateTime.UtcNow.AddSeconds(2.5);
        while (DateTime.UtcNow < deadline && !ct.IsCancellationRequested)
        {
            var wait = deadline - DateTime.UtcNow;
            using var t = CancellationTokenSource.CreateLinkedTokenSource(ct);
            t.CancelAfter(wait);
            try
            {
                var r = await udp.ReceiveAsync(t.Token);
                var j = JsonNode.Parse(Encoding.UTF8.GetString(r.Buffer))?.AsObject();
                if ((string?)j?["steez"] != "chests") continue;
                return (r.RemoteEndPoint.Address.ToString(), (int?)j!["port"] ?? 43121, (string?)j["name"] ?? r.RemoteEndPoint.Address.ToString());
            }
            catch (OperationCanceledException) { break; }
            catch { }
        }
        return null;
    }

    // ─── The connection ───────────────────────────────────────────
    private async Task ConnectLoop(CancellationToken ct)
    {
        int backoff = 2;
        while (!ct.IsCancellationRequested)
        {
            string? host = _cfg.Host;
            int port = _cfg.Port > 0 ? _cfg.Port : 43121;
            bool connected = false;
            if (host != null) connected = await TryConnect(host, port, ct);
            if (!connected && !ct.IsCancellationRequested)
            {
                if (_cfg.Host == null) SetStatus("Looking for Steez on your network…");
                var found = await Discover(ct);
                if (found is { } f)
                {
                    connected = await TryConnect(f.host, f.port, ct, f.name);
                }
                else if (_cfg.Host == null) SetStatus("Looking for Steez… (open Steez on your stream PC and choose “Another PC” on the Fortnite Chests page)");
            }
            if (connected) backoff = 2;
            try { await Task.Delay(TimeSpan.FromSeconds(backoff), ct); } catch { }
            backoff = Math.Min(30, backoff * 2);
        }
    }

    private async Task<bool> TryConnect(string host, int port, CancellationToken ct, string? name = null)
    {
        using var ws = new ClientWebSocket();
        ws.Options.KeepAliveInterval = TimeSpan.FromSeconds(20);
        try
        {
            using var t = CancellationTokenSource.CreateLinkedTokenSource(ct);
            t.CancelAfter(TimeSpan.FromSeconds(4));
            await ws.ConnectAsync(new Uri($"ws://{host}:{port}/chests/bridge"), t.Token);
        }
        catch { return false; }

        _ws = ws;
        SetStatus($"Connected to {name ?? _cfg.SteezName ?? host}, waiting for Steez…");
        await SendNow(ws, JsonSerializer.Serialize(new { type = "hello", id = _cfg.Id, name = Environment.MachineName, token = _cfg.Token, version = Program.Version }), ct);

        var buf = new byte[64 * 1024];
        var sb = new StringBuilder();
        bool welcomed = false;
        try
        {
            while (ws.State == WebSocketState.Open && !ct.IsCancellationRequested)
            {
                var r = await ws.ReceiveAsync(buf, ct);
                if (r.MessageType == WebSocketMessageType.Close) break;
                sb.Append(Encoding.UTF8.GetString(buf, 0, r.Count));
                if (!r.EndOfMessage) continue;
                var text = sb.ToString();
                sb.Clear();
                var msg = JsonNode.Parse(text)?.AsObject();
                if (msg == null) continue;
                if (msg["cmd"] != null)
                {
                    if ((string?)msg["cmd"] == "live")
                    {
                        _wantLive = (bool?)msg["on"] == true;
                        if (_cfg.Paused) continue; // paused here wins
                    }
                    _tracker.Handle(text);
                    continue;
                }
                switch ((string?)msg["type"])
                {
                    case "pending":
                        SetStatus($"Waiting for you to allow this PC in Steez on {(string?)msg["name"] ?? host}");
                        if (!_toldPending)
                        {
                            _toldPending = true;
                            Balloon("Allow this PC in Steez", $"On your stream PC, open Steez → Fortnite Chests and click Allow next to {Environment.MachineName}.");
                        }
                        break;
                    case "paired":
                        _cfg.Token = (string?)msg["token"];
                        _cfg.Host = host;
                        _cfg.Port = port;
                        _cfg.SteezName = (string?)msg["name"] ?? name;
                        _cfg.Save();
                        Balloon("Connected to Steez", $"Chests counted on this PC now show up in Steez on {_cfg.SteezName}.");
                        break;
                    case "welcome":
                        welcomed = true;
                        _toldPending = false;
                        _cfg.Host = host;
                        _cfg.Port = port;
                        _cfg.SteezName = (string?)msg["name"] ?? _cfg.SteezName ?? name;
                        _cfg.Save();
                        SetStatus($"Connected to Steez on {_cfg.SteezName}");
                        _tracker.Hello(new { paused = _cfg.Paused });
                        break;
                    case "denied":
                        _cfg.Token = null;
                        _cfg.Save();
                        SetStatus("Steez didn’t allow this PC. Open the tray menu to try again.");
                        try { await Task.Delay(TimeSpan.FromMinutes(2), ct); } catch { }
                        return true;
                }
            }
        }
        catch { /* dropped */ }
        finally
        {
            _ws = null;
            if (!ct.IsCancellationRequested) SetStatus(welcomed ? $"Lost Steez on {_cfg.SteezName ?? host}, reconnecting…" : _status);
        }
        return welcomed;
    }

    private static async Task SendNow(ClientWebSocket ws, string text, CancellationToken ct)
    {
        try { await ws.SendAsync(Encoding.UTF8.GetBytes(text), WebSocketMessageType.Text, true, ct); } catch { }
    }

    /// Events from the tracker go out one at a time (a WebSocket allows one send at a time).
    private async Task SendLoop(CancellationToken ct)
    {
        try
        {
            await foreach (var line in _outbox.Reader.ReadAllAsync(ct))
            {
                var ws = _ws;
                if (ws == null || ws.State != WebSocketState.Open) continue; // Steez gets a full refresh on reconnect
                await SendNow(ws, line, ct);
            }
        }
        catch (OperationCanceledException) { }
    }
}
