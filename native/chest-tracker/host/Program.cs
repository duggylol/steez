// ChestTracker.exe: Steez starts this on the same PC as Fortnite and talks to it one JSON object per
// line over stdin/stdout (see ../shared/Tracker.cs). Exits when stdin closes, so it never outlives Steez.
using Steez.ChestTracker;

Console.OutputEncoding = System.Text.Encoding.UTF8;
try { System.Diagnostics.Process.GetCurrentProcess().PriorityClass = System.Diagnostics.ProcessPriorityClass.BelowNormal; } catch { }

var tracker = new Tracker(line =>
{
    Console.Out.WriteLine(line);
    Console.Out.Flush();
});
tracker.Hello();

string? input;
while ((input = Console.In.ReadLine()) != null) tracker.Handle(input);
tracker.SetLive(false);
