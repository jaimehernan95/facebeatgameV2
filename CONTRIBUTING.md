# Contributing to FaceBeat Arcade

Thank you for helping improve FaceBeat Arcade! Every contribution should keep the project **zero-key ready**, **privacy-first**, and smooth at **60 FPS**.

## Local Development

```bash
make setup
make dev
```

## Before Opening a Pull Request

Run the full verification suite:

```bash
make check
```

This runs:
1. `npm run lint` — TypeScript typecheck (`tsc --noEmit`)
2. `npm test` — Unit tests for beatmap generation, latency offset math, scoring, and secret safety
3. `npm run build` — Production Vite bundle check

## Guidelines

- **Privacy First:** Never send webcam frames, landmarks, or user video off-device.
- **Zero-Key Default:** New gameplay features must work out of the box without requiring API keys; any optional server-side integrations must fall back gracefully.
- **No Secrets:** Never commit `.env` files, API keys, or OAuth client secrets.
