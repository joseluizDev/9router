# ZRO (Moonmath)

ZRO exposes an OpenAI-compatible API at `https://zro.moonmath.ai/v1`.
9Router uses its existing chat executor and translation pipeline; no additional dependency is required.

## Setup

1. Create an API key at <https://zro.moonmath.ai/api-keys>.
2. In the 9Router dashboard, open **Providers**, select **ZRO (Moonmath)** and add the key.
3. Use a ZRO model through the normal 9Router endpoint, for example:

```json
{
  "model": "zro/deepseek-v4.1-flash",
  "messages": [{ "role": "user", "content": "Hello" }],
  "stream": true
}
```

Available catalog IDs:

- `zro/deepseek-v4.1-flash`
- `zro/glm-5.3`
- `zro/glm-5.3-flash`
- `zro/dolly1-security`
- `zro/dolly2-security`
- `zro/auto` — ZRO selects the upstream model; this is not a 9Router combo.

The upstream documents streaming and function tools. Access depends on the key's balance, model permissions and allowed inference regions. Keys are checked with `GET /v1/models` rather than a paid completion.

## Security and verification

Treat the ZRO key as a secret. Enter it through the existing provider credential flow, not in source code or client-side configuration. Requests selected for this provider are sent to Moonmath's external service and are subject to its policies and charges. Dolly security models are intended for authorized security work.

Automated integration tests use synthetic credentials and do not verify upstream availability, actual tool execution, billing or account-specific model access. Confirm those with your own key before relying on the provider.

## References

- [API](https://zro.moonmath.ai/docs/api)
- [Model catalog](https://zro.moonmath.ai/docs/models)
- [Quickstart](https://zro.moonmath.ai/docs/quickstart)

Documentation consulted on 2026-10-30. Model availability and prices may change.
