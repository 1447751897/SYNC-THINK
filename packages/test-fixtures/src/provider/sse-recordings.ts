// Recorded SSE for provider quirks (TD-010 § Gateway quirks row).
export const SSED_QUARK_PATH_FIXTURE = {
  raw: `data: {"choices":[{"delta":{"content":"ok"}}]}\n`,
  baseUrlHint: 'https://gateway.example.com/v2',
};

export const SSED_MISSING_MODEL_LIST = {
  // Some gateways return no models array.
  body: JSON.stringify({ object: 'list', data: [] }),
  httpStatus: 200,
};
