# Green Sparkle — VapourSynth + vs-mlrt TensorRT upscale.
# Driven by env vars set by NeuralUpscale (paths must be absolute).
#
# GST_VS_INPUT       source video path
# GST_VS_ENGINE      TensorRT engine path
# GST_VS_TILE        tile size (int)
# GST_VS_OVERLAP     overlap (int, default tile//8 capped at 16)
# GST_VS_NATIVE_SCALE  network scale (usually 4)
# GST_VS_TARGET_SCALE  user scale 2/3/4
# GST_VS_OUTPUT        yuv420p (NVENC) | yuv444p (PNG dump for RIFE, full chroma) | gbrp
# GST_VS_PLUGIN_DIRS   optional ;-separated extra plugin dirs

import os
import sys

import vapoursynth as vs

core = vs.core


def _env(name: str, default: str = "") -> str:
    return os.environ.get(name, default).strip()


def _env_int(name: str, default: int) -> int:
    raw = _env(name)
    if not raw:
        return default
    return int(raw)


# Extra plugin folders (BestSource / VSTRT / vsmlrt scripts parent)
for d in _env("GST_VS_PLUGIN_DIRS").split(os.pathsep):
    d = d.strip()
    if d and os.path.isdir(d):
        sys.path.insert(0, d)
        try:
            core.std.LoadPlugin(os.path.join(d, "vstrt.dll"))
        except Exception:
            pass
        for name in ("bestsource.dll", "BestSource.dll", "ffms2.dll", "ffms2"):
            p = os.path.join(d, name)
            if os.path.isfile(p):
                try:
                    core.std.LoadPlugin(p)
                except Exception:
                    pass

input_path = _env("GST_VS_INPUT")
engine_path = _env("GST_VS_ENGINE")
tile = _env_int("GST_VS_TILE", 128)
overlap = _env_int("GST_VS_OVERLAP", min(16, max(0, tile // 8)))
native_scale = _env_int("GST_VS_NATIVE_SCALE", 4)
target_scale = _env_int("GST_VS_TARGET_SCALE", native_scale)

if not input_path or not os.path.isfile(input_path):
    raise RuntimeError(f"GST_VS_INPUT missing or not a file: {input_path!r}")
if not engine_path or not os.path.isfile(engine_path):
    raise RuntimeError(f"GST_VS_ENGINE missing or not a file: {engine_path!r}")

# Prefer BestSource, then FFMS2
clip = None
last_err = None
if hasattr(core, "bs"):
    try:
        clip = core.bs.VideoSource(source=input_path)
    except Exception as exc:
        last_err = exc
if clip is None and hasattr(core, "ffms2"):
    try:
        clip = core.ffms2.Source(source=input_path)
    except Exception as exc:
        last_err = exc
if clip is None and hasattr(core, "lsmas"):
    try:
        clip = core.lsmas.LWLibavSource(source=input_path)
    except Exception as exc:
        last_err = exc
if clip is None:
    raise RuntimeError(
        "No usable VapourSynth source plugin (BestSource/FFMS2/L-SMASH). "
        f"Last error: {last_err}"
    )

# RGBS float [0,1] for TensorRT Real-ESRGAN-style engines
if clip.format.color_family != vs.RGB:
    clip = clip.resize.Bicubic(format=vs.RGBS, matrix_in_s="709")
else:
    clip = clip.resize.Bicubic(format=vs.RGBS)

if not hasattr(core, "trt"):
    raise RuntimeError(
        "vs-mlrt TensorRT plugin (vstrt) is not loaded. Re-enable Green Sparkle to finish setup."
    )

def _run_trt(use_graph: bool):
    return core.trt.Model(
        clip,
        engine_path=engine_path,
        overlap=[overlap, overlap],
        tilesize=[tile, tile],
        device_id=0,
        use_cuda_graph=use_graph,
        num_streams=2,
        verbosity=2,
    )


try:
    flt = _run_trt(True)
except Exception:
    flt = _run_trt(False)

if target_scale != native_scale:
    out_w = clip.width * target_scale
    out_h = clip.height * target_scale
    flt = flt.resize.Lanczos(width=out_w, height=out_h)

output_fmt = _env("GST_VS_OUTPUT", "yuv420p").lower()
if output_fmt in ("gbrp", "rgb_planar"):
    # Optional planar RGB dump (plane order must match ffmpeg gbrp: G,B,R).
    rgb = flt.resize.Bicubic(format=vs.RGB24)
    out = core.std.ShufflePlanes(clips=[rgb], planes=[1, 2, 0], colorfamily=vs.RGB)
elif output_fmt in ("yuv444p", "yuv444"):
    # Full-chroma YUV for PNG → RIFE (avoids 4:2:0 smear before interpolation)
    matrix = "709" if flt.width >= 1280 else "170m"
    out = flt.resize.Bicubic(format=vs.YUV444P8, matrix_s=matrix)
    even_w = out.width - (out.width % 2)
    even_h = out.height - (out.height % 2)
    if even_w != out.width or even_h != out.height:
        out = out.resize.Bicubic(width=even_w, height=even_h)
else:
    # Limited-range YUV for ffmpeg / NVENC (raw yuv420p requires even dims)
    matrix = "709" if flt.width >= 1280 else "170m"
    out = flt.resize.Bicubic(format=vs.YUV420P8, matrix_s=matrix)
    even_w = out.width - (out.width % 2)
    even_h = out.height - (out.height % 2)
    if even_w != out.width or even_h != out.height:
        out = out.resize.Bicubic(width=even_w, height=even_h)

# Drop bulky frame props that bloat y4m headers if someone switches back to -c y4m
try:
    out = core.std.RemoveFrameProps(out)
except Exception:
    pass

out.set_output()
