using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Automation;
using System.Windows.Controls;

namespace SyncThinkDesktopFixture;

public partial class MainWindow : Window
{
    private readonly FixtureOptions _options;
    private readonly object _stateGate = new();
    private bool _ready;
    private int _invocationCount;
    private int _completedCount;
    private string _lastAction = "none";

    internal MainWindow(FixtureOptions options)
    {
        _options = options;
        InitializeComponent();
        Title = $"SYNC THINK Desktop Handoff Fixture [{options.ScenarioId}]";
        Loaded += (_, _) =>
        {
            _ready = true;
            WriteState("ready");
        };
    }

    private void InputText_OnTextChanged(object sender, TextChangedEventArgs e)
    {
        if (!_ready) return;
        RunSlowMutation("set-value");
    }

    private void ApplyButton_OnClick(object sender, RoutedEventArgs e)
    {
        RunSlowMutation("invoke");
    }

    private void RunSlowMutation(string action)
    {
        _lastAction = action;
        _invocationCount += 1;
        ResultText.Text = $"started:{action}:{_invocationCount}";
        AutomationProperties.SetName(ResultText, ResultText.Text);
        WriteState("started");

        Thread.Sleep(_options.DelayMs);

        _completedCount += 1;
        ResultText.Text = $"applied:{InputText.Text}:count={_invocationCount}";
        AutomationProperties.SetName(ResultText, ResultText.Text);
        WriteState("completed");
    }

    private void WriteState(string status)
    {
        lock (_stateGate)
        {
            var directory = Path.GetDirectoryName(_options.StateFile);
            if (!string.IsNullOrWhiteSpace(directory)) Directory.CreateDirectory(directory);
            var temporary = $"{_options.StateFile}.{Environment.ProcessId}.tmp";
            var payload = new
            {
                scenarioId = _options.ScenarioId,
                processId = Environment.ProcessId,
                windowTitle = Title,
                status,
                lastAction = _lastAction,
                invocationCount = _invocationCount,
                completedCount = _completedCount,
                inputValue = InputText.Text,
                resultText = ResultText.Text,
                updatedAt = DateTimeOffset.UtcNow.ToString("O"),
            };
            File.WriteAllText(temporary, JsonSerializer.Serialize(payload));
            File.Move(temporary, _options.StateFile, true);
        }
    }
}
