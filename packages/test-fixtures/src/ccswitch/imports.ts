// CC Switch importer fixtures (TD-009). Versioned adapter; safe failure on
// unknown versions; secrets must move into secure-store (not DB plaintext).
export const CCSWITCH_FIXTURES: {
  id: string;
  importerVersion: string;
  rawConfig: Record<string, unknown>;
  expect: 'ok' | 'safe-fail' | 'partial';
}[] = [
  {
    id: 'ccswitch-v1-compatible',
    importerVersion: '0.20',
    rawConfig: {
      profiles: [
        { name: 'Gateway A', baseUrl: 'https://gw.example.com/v1', apiKey: 'sk-A-XXX', models: ['gpt-4o'] },
      ],
    },
    expect: 'ok',
  },
  {
    id: 'ccswitch-unknown-version',
    importerVersion: '99.99',
    rawConfig: {},
    expect: 'safe-fail',
  },
  {
    id: 'ccswitch-ambiguous-fields',
    importerVersion: '0.20',
    rawConfig: { profiles: [{ name: 'X' }] },
    expect: 'partial',
  },
];
