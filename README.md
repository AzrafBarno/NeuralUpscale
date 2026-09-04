# NeuralUpscale

**GPU-accelerated AI upscaling and frame interpolation for images and video.**

Cross-platform Electron desktop app powered by [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) (ncnn + Vulkan), [RIFE](https://github.com/nihui/rife-ncnn-vulkan), and optional **Green Sparkle Technology** (TensorRT + VapourSynth) for high-throughput NVIDIA video upscaling on Windows.

<p align="center">
  <img src="build/icon.png" alt="NeuralUpscale" width="96" height="96" />
</p>

<p align="center">
  <a href="#license"><img src="https://img.shields.io/badge/license-GPL--3.0--or--later-blue.svg" alt="License" /></a>
  <a href="#prerequisites"><img src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg" alt="Node.js" /></a>
  <a href="#platforms"><img src="https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-lightgrey.svg" alt="Platforms" /></a>
</p>

---

## Features

### Image upscale
- Single image or **batch folder** processing (JPG / PNG)
- **2× / 3× / 4×** scale (native model scale where available; otherwise 4× then high-quality downscale)
- Built-in Real-ESRGAN models + custom `.bin` / `.param` pairs
- Before / after comparison slider with zoom
- Batch views: list, compact, and tiles
- Pause, resume, and cancel mid-batch

### Video upscale
- Single video or **batch** MP4 workflows
- Frame extract → AI upscale → encode (prefers `h264_nvenc`, falls back to `libx264`)
- Optional **upscale + interpolation** in one pass
- Before / after video preview with resolution / FPS overlays
- Auto-organized batch output folders

### Frame interpolation
- Dedicated Interpolation workspace powered by **RIFE** (`rife-ncnn-vulkan`)
- Modes:
  - **Multiplier** — 2× or 4× source FPS
  - **Target FPS** — presets 48 / 60 / 90 / 120, or custom 1–240
- Single-file or batch folder mode
- Defaults configurable in Settings

### Green Sparkle Technology (GST)
Optional **NVIDIA TensorRT** video path for much faster upscaling on Windows:

- Embedded Python + CUDA 12 + TensorRT
- **VapourSynth** + **vs-mlrt** pipeline (`vspipe`)
- ONNX → TensorRT engine compile (first run / model change)
- Automatic fallback to the Vulkan ncnn path when GST is unavailable

> GST is **not** GStreamer. It is NeuralUpscale’s TensorRT video acceleration stack and currently targets **Windows + NVIDIA** GPUs.

### App experience
- Frameless modern UI with dark / light themes
- Persistent settings (GPU, tile size, threads, formats, naming, sounds)
- Per-format default models (JPG / PNG / MP4)
- Device info panel
- Windows NSIS installer with license, directory picker, desktop shortcut, and VC++ redistributable setup

---

## How it works

| Path | Engine | Best for |
|------|--------|----------|
| Images | Real-ESRGAN via `realesrgan-ncnn-vulkan` | Photos, art, screenshots |
| Video (default) | Real-ESRGAN frame loop + FFmpeg | Cross-platform, any Vulkan GPU |
| Video (GST) | TensorRT + VapourSynth | NVIDIA / Windows, high throughput |
| Interpolation | RIFE `rife-v4.6` via `rife-ncnn-vulkan` | Smooth FPS boost |

Bundled tooling includes **FFmpeg / FFprobe** for demux, encode, and media probing.

---

## Built-in models

| Model ID | Description |
|----------|-------------|
| `realesrgan-x4plus` | General-purpose Real-ESRGAN |
| `realesrgan-x4plus-anime` | Anime / illustration tuned |
| `realesr-animevideov3` | Anime video (native x2 / x3 / x4 weights) |
| `realesrnet-x4plus` | RealESRNet general (optional download) |

Custom Real-ESRGAN `.bin` + `.param` models can be added from the model manager. GST maps supported Real-ESRGAN-family names to ONNX graphs for TensorRT.

---

## Prerequisites

- **Node.js 18+**
- A GPU with **Vulkan** support is strongly recommended (CPU fallback exists for Real-ESRGAN / RIFE)
- For **Green Sparkle Technology**: **Windows**, **NVIDIA GPU**, internet on first enable (CUDA / TensorRT / VapourSynth bootstrap, ~1 GB+)
- Windows users: **Microsoft Visual C++ 2015–2022 Redistributable (x64)** — the installer can detect and install it

---

## Setup

```bash
# Install dependencies (runs resource download automatically)
npm install

# Skip auto-download during install, then fetch resources manually:
# SKIP_SETUP=1 npm install
npm run setup
```

`npm run setup` downloads and places:

| Resource | Location |
|----------|----------|
| Real-ESRGAN binary | `resources/bin/{win32\|darwin\|linux}/realesrgan-ncnn-vulkan[.exe]` |
| FFmpeg / FFprobe | `resources/bin/{platform}/` |
| RIFE binary + model | `resources/bin/…`, `resources/rife-models/` |
| Real-ESRGAN weights | `resources/models/*.bin` + `*.param` |
| GST scripts | `resources/gst/` |

If automatic setup fails, grab binaries / models from:

- [Real-ESRGAN Releases](https://github.com/xinntao/Real-ESRGAN/releases)
- [rife-ncnn-vulkan Releases](https://github.com/nihui/rife-ncnn-vulkan/releases)
- [Upscayl Models](https://github.com/upscayl/custom-models) (alternate models)

---

## Development

```bash
npm run dev
```

Other scripts:

| Command | Description |
|---------|-------------|
| `npm run preview` | Preview the production renderer build |
| `npm run icons` | Regenerate app icons |
| `npm run setup` | Re-download binaries and models |

---

## Build

```bash
# Current platform installer
npm run build

# Windows + macOS + Linux (needs matching tooling / machines)
npm run build:all
```

Artifacts are written to `release/`.

### Platforms

| Platform | Package |
|----------|---------|
| Windows x64 | Assisted **NSIS** installer (`NeuralUpscale-Setup-<version>.exe`) |
| macOS | DMG |
| Linux | AppImage |

### Windows NSIS installer

Classic **Next → Next → Finish** wizard with:

- GNU GPLv3 license agreement
- Install directory selection
- Optional desktop shortcut
- Detect / download / install **MSVC++ 2015–2022 (x64)** when needed

---

## Output conventions

Defaults (custom paths are always allowed):

| Mode | Default output |
|------|----------------|
| Image (single) | Same folder as source (`{filename}_upscaled_{scale}x`) |
| Image (batch) | `<input>/neuralupscale_<model>_<scale>x_upscaled` |
| Video (single) | Same folder as source |
| Video (batch + interpolation) | `<input>/neuralupscale_<model>_<scale>_<fps>_processed` |
| Interpolation (single) | Same folder as source (`…_interp_Nx` or `…_interp_Nfps`) |
| Interpolation (batch) | `<input>/interpolated` |

---

## Tech stack

- **App**: Electron · React · TypeScript · Vite (electron-vite) · Tailwind · Zustand
- **Upscale**: Real-ESRGAN / ncnn-vulkan · sharp (post-scale)
- **Video**: FFmpeg · optional Green Sparkle (TensorRT · VapourSynth · vs-mlrt)
- **Interpolation**: RIFE ncnn-vulkan
- **Packaging**: electron-builder (NSIS / DMG / AppImage)

---

## Project layout

```text
NeuralUpscale/
├── src/                 # React UI (pages, components, store)
├── electron/            # Main process + services (video, GST, RIFE, …)
├── resources/           # Binaries, models, GST scripts (from setup)
├── build/               # Icons, NSIS script, installer license
├── scripts/             # setup-resources, icon generation
└── release/             # Built installers
```

---

## Author

**Azraf Barno**

Also by the same developer: [CSV Meta](https://csvmeta.com) · [PromptGen](https://chromewebstore.google.com/detail/promptgen-ai-image-to-pro/foliaahbfnegnbmclfomfeamfkmnncjm)

---

## License

This project is licensed under the [GNU General Public License v3.0 or later](LICENSE).

```
NeuralUpscale
Copyright (C) 2026 Azraf Barno

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU General Public License as published by
the Free Software Foundation, either version 3 of the License, or
(at your option) any later version.
```

Third-party engines (Real-ESRGAN, RIFE, FFmpeg, TensorRT, etc.) remain under their respective licenses.
