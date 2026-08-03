using System.IO;
using System.Windows;

namespace SyncThinkDesktopFixture;

public partial class App : Application
{
    protected override void OnStartup(StartupEventArgs e)
    {
        base.OnStartup(e);
        var options = FixtureOptions.Parse(e.Args);
        var window = new MainWindow(options);
        MainWindow = window;
        window.Show();
    }
}

internal sealed record FixtureOptions(string ScenarioId, string StateFile, int DelayMs)
{
    public static FixtureOptions Parse(string[] args)
    {
        string? scenarioId = null;
        string? stateFile = null;
        var delayMs = 4_000;

        for (var index = 0; index < args.Length; index++)
        {
            var value = args[index];
            if (value == "--scenario" && index + 1 < args.Length)
            {
                scenarioId = args[++index];
            }
            else if (value == "--state-file" && index + 1 < args.Length)
            {
                stateFile = args[++index];
            }
            else if (value == "--delay-ms" && index + 1 < args.Length &&
                     int.TryParse(args[++index], out var parsedDelay))
            {
                delayMs = Math.Clamp(parsedDelay, 250, 20_000);
            }
        }

        scenarioId = string.IsNullOrWhiteSpace(scenarioId) ? "default" : scenarioId.Trim();
        stateFile = string.IsNullOrWhiteSpace(stateFile)
            ? Path.Combine(Path.GetTempPath(), $"sync-think-desktop-fixture-{scenarioId}.json")
            : Path.GetFullPath(stateFile);
        return new FixtureOptions(scenarioId, stateFile, delayMs);
    }
}
