# OpenAI-family adapters

## Model discovery (M1)

OpenAI-compatible gateways (Chat Completions, Responses, Images) share
`discoverOpenAICompatibleModels`:

- `GET {baseUrl}/models`
- `Authorization: Bearer <apiKey>`
- Response shapes: `{ data: [{ id }] }` or `{ models: [{ id|model }] }`
- Errors are classified (`auth`, `rate-limit`, `timeout`, `protocol`, `transient`)
- Secrets are scrubbed from error messages before they leave the adapter

## Streaming call

FakeProvider remains the demo stream path. Live `call()` for Chat/Responses
is the next M1 binding step after Agents / run model resolution.

Contract fixtures for SSE parsing live in
`packages/test-fixtures/src/provider/battery.ts` (TD-010).
