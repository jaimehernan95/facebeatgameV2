<div align="center">

# FaceBeat Arcade

**Turn your webcam into a 60 FPS rhythm game controller — zero video uploaded, zero API keys required.**

[![CI](https://img.shields.io/github/actions/workflow/status/jaimehernan95/facebeatgameV2/ci.yml?branch=main&label=CI)](./.github/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](./LICENSE)
[![Version](https://img.shields.io/badge/Version-1.0.0-blue.svg)](./CHANGELOG.md)
[![Live Demo](https://img.shields.io/badge/Live%20Demo-Play%20Now-f59e0b.svg)](https://ais-pre-xdvswj7trntvr5pia33nlw-761484531307.us-east1.run.app)

<br />

<img src="./assets/demo.gif" alt="FaceBeat Arcade Gameplay" width="720" />

</div>

---

## What It Is

**FaceBeat Arcade** is a browser-native rhythm & facial fitness game powered by **MediaPipe FaceLandmarker** and a **Web Audio API groove synthesizer**. Match falling beat blocks across four expressive lanes — **Tilt Left (`A`)**, **Open Mouth (`S`)**, **Big Smile (`D`)**, and **Tilt Right (`F`)** — with crisp score chimes, instant **Keyboard Arcade Mode** fallback when no camera is connected, and **persistent cloud memory** for your calibration, favorite tracks, and 4-expression facial fitness progress.

- **Live Demo:** [https://ais-pre-xdvswj7trntvr5pia33nlw-761484531307.us-east1.run.app](https://ais-pre-xdvswj7trntvr5pia33nlw-761484531307.us-east1.run.app)
- **100% Local Privacy:** Webcam frames never leave your device (`Zero Video Uploaded`). All computer vision runs locally via WebAssembly.
- **Zero-Key Out of the Box:** Built-in procedural Web Audio synth tracks, **YouTube / YouTube Music** links, **TikTok** video links, and local MP3/WAV upload work immediately with no external API keys.
- **Persistent Player Memory & Facial Fitness Coach:** Saves calibration parameters, remembered YouTube/TikTok/Spotify/Synth tracks, per-expression accuracy, and Gemini taste-vector recommendations locally and in Cloud Firestore when signed in with Google.

---

## One-Command Quick Start

```bash
git clone https://github.com/jaimehernan95/facebeatgameV2.git && cd facebeatgameV2 && npm install && npm run dev
```

Open `http://localhost:3000` in your browser. If a webcam isn't available or permission is declined, **Keyboard Arcade Mode (`A`, `S`, `D`, `F`)** activates automatically.

---

## Controls & Latency Calibration

| Lane | Facial Expression | Keyboard Fallback |
| :--- | :--- | :--- |
| Lane 1 | Tilt Head Left | `A` or `←` |
| Lane 2 | Open Mouth Wide | `S` or `Space` |
| Lane 3 | Big Smile | `D` or `↑` |
| Lane 4 | Tilt Head Right | `F` or `→` |

Using Bluetooth headphones or noticing webcam lag? Open **Settings** in the top bar and adjust **Calibrate Offset (ms)** between `-200ms` and `+200ms` using the built-in `AudioContext.currentTime` sync click.

---

## Optional Secrets & Environment Variables

FaceBeat Arcade runs out of the box without any `.env` configuration. If you want to enable optional server-side features:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
2. Configure optional server-only environment variables (never exposed to the client bundle):
   - `GEMINI_API_KEY=` — Optional server-side Gemini beatmap choreographer (falls back seamlessly to built-in procedural beatmaps when unset).
   - `SPOTIFY_CLIENT_ID=` & `SPOTIFY_CLIENT_SECRET=` — Optional Spotify OAuth integration for searching and playing your Spotify library.
   - `APP_URL=` — Public base URL used to construct the Spotify OAuth callback (`<APP_URL>/auth/spotify/callback`).

---

## Development & Verification

```bash
make setup   # Install dependencies
make dev     # Start Express + Vite dev server on port 3000
make check   # Run TypeScript check, unit tests, and production build
make clean   # Remove build artifacts
```

---

## Contributing & License

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

Released under the [MIT License](./LICENSE).
