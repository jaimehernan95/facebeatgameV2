# Changelog

All notable changes to FaceBeat Arcade will be documented in this file.

## [v1.0.0] - 2026-11-19

### Added
- **4-Lane Facial Expression Rhythm Engine:** Real-time local MediaPipe `FaceLandmarker` tracking for Tilt Left (`A`), Open Mouth (`S`), Big Smile (`D`), and Tilt Right (`F`).
- **Keyboard Arcade Fallback Mode:** Automatic zero-error fallback to `A`, `S`, `D`, `F` controls whenever a webcam is unavailable, denied, or blocked in an iframe.
- **Audio-Visual Latency Calibration:** `-200ms` to `+200ms` `"Calibrate Offset (ms)"` setting powered by `AudioContext.currentTime` with live sync click testing.
- **60 FPS Arcade Visuals:** `PERFECT` / `GREAT` / `GOOD` / `MISS` judgments, `1x`–`4x` combo multiplier, neon particle bursts, subtle high-combo screen shake, and 4 live expression confidence bars.
- **Three Music Modes:** Built-in procedural Web Audio synth tracks, local audio upload (`.mp3`/`.wav`/`.m4a`) with beat peak detection, and optional Spotify OAuth / link embed.
- **Optional Server-Side Gemini Beatmap API:** Graceful fallback to procedural beatmaps when `GEMINI_API_KEY` is unset.
- **Open-Source GitHub Scaffolding:** CI workflow, issue/PR templates, Makefile, MIT License, and unit test suite.
