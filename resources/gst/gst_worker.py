#!/usr/bin/env python3
"""Green Sparkle Technology — TensorRT engine build + tiled Real-ESRGAN inference."""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from pathlib import Path


def log(msg: str) -> None:
    """Progress / stage logs. Prefer stderr so stdout can carry raw video."""
    print(msg, file=sys.stderr, flush=True)


def log_stdout(msg: str) -> None:
    print(msg, flush=True)


def _cuda():
    try:
        from cuda.bindings import runtime as cudart  # type: ignore

        return cudart, "bindings"
    except Exception:
        pass
    try:
        import cuda.cudart as cudart  # type: ignore

        return cudart, "cudart"
    except Exception as exc:
        raise RuntimeError(
            "cuda-python is required. Install with: pip install cuda-python"
        ) from exc


def _check(err) -> None:
    if err is None:
        return
    if isinstance(err, tuple):
        err = err[0]
    if int(err) != 0:
        raise RuntimeError(f"CUDA error: {err}")


def cuda_malloc(nbytes: int):
    cudart, _ = _cuda()
    result = cudart.cudaMalloc(nbytes)
    if isinstance(result, tuple):
        _check(result[0])
        return result[1]
    return result


def cuda_free(ptr) -> None:
    cudart, _ = _cuda()
    err = cudart.cudaFree(ptr)
    if isinstance(err, tuple):
        _check(err[0])
    else:
        _check(err)


def cuda_memcpy(dst, src, nbytes: int, kind: str) -> None:
    cudart, _ = _cuda()
    kind_map = {
        "htod": cudart.cudaMemcpyKind.cudaMemcpyHostToDevice,
        "dtoh": cudart.cudaMemcpyKind.cudaMemcpyDeviceToHost,
    }
    err = cudart.cudaMemcpy(dst, src, nbytes, kind_map[kind])
    if isinstance(err, tuple):
        _check(err[0])
    else:
        _check(err)


def cuda_sync() -> None:
    cudart, _ = _cuda()
    err = cudart.cudaDeviceSynchronize()
    if isinstance(err, tuple):
        _check(err[0])
    else:
        _check(err)


def cuda_stream_create():
    cudart, _ = _cuda()
    result = cudart.cudaStreamCreate()
    if isinstance(result, tuple):
        _check(result[0])
        return result[1]
    return result


def cuda_stream_sync(stream) -> None:
    cudart, _ = _cuda()
    err = cudart.cudaStreamSynchronize(stream)
    if isinstance(err, tuple):
        _check(err[0])
    else:
        _check(err)


def cuda_stream_destroy(stream) -> None:
    cudart, _ = _cuda()
    err = cudart.cudaStreamDestroy(stream)
    if isinstance(err, tuple):
        _check(err[0])
    else:
        _check(err)


def as_cuda_ptr(ptr) -> int:
    """Return a CUDA handle value suitable for TensorRT / cudart APIs.

    cuda-python wrappers expose getPtr(), but that is a *pointer to* the handle,
    not the CUstream/CUdeviceptr value itself. TensorRT enqueueV3 needs int(handle).
    Using getPtr() here caused Cuda Runtime failures inside TRT reformatting.
    """
    if ptr is None:
        raise RuntimeError("null CUDA pointer")
    if isinstance(ptr, int):
        return ptr
    try:
        return int(ptr)
    except (TypeError, ValueError):
        pass
    value = getattr(ptr, "value", None)
    if value is not None:
        return int(value)
    if hasattr(ptr, "getPtr"):
        return int(ptr.getPtr())
    raise TypeError(f"Cannot convert CUDA pointer of type {type(ptr)}")


def cmd_version(_: argparse.Namespace) -> int:
    import tensorrt as trt  # type: ignore

    log_stdout(f"tensorrt={trt.__version__}")
    return 0


def _set_stdio_binary() -> None:
    if hasattr(sys.stdin, "buffer"):
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.setmode(sys.stdin.fileno(), os.O_BINARY)
                msvcrt.setmode(sys.stdout.fileno(), os.O_BINARY)
        except Exception:
            pass


def _read_exact(stream, nbytes: int):
    """Read exactly nbytes, or return None on clean EOF before any bytes."""
    chunks = bytearray()
    while len(chunks) < nbytes:
        piece = stream.read(nbytes - len(chunks))
        if not piece:
            if not chunks:
                return None
            raise RuntimeError(f"Unexpected EOF ({len(chunks)}/{nbytes} bytes)")
        chunks.extend(piece)
    return memoryview(chunks)


def cmd_build(args: argparse.Namespace) -> int:
    import tensorrt as trt  # type: ignore

    onnx_path = Path(args.onnx)
    engine_path = Path(args.engine)
    tile = int(args.tile)
    if not onnx_path.is_file():
        raise FileNotFoundError(f"ONNX not found: {onnx_path}")

    engine_path.parent.mkdir(parents=True, exist_ok=True)
    log(f"GST_STAGE compile Opening ONNX {onnx_path.name}")

    logger = trt.Logger(trt.Logger.WARNING)
    builder = trt.Builder(logger)
    network = builder.create_network(1 << int(trt.NetworkDefinitionCreationFlag.EXPLICIT_BATCH))
    parser = trt.OnnxParser(network, logger)
    onnx_bytes = onnx_path.read_bytes()
    if not parser.parse(onnx_bytes):
        errors = []
        for i in range(parser.num_errors):
            errors.append(str(parser.get_error(i)))
        raise RuntimeError("ONNX parse failed:\n" + "\n".join(errors))

    config = builder.create_builder_config()
    if hasattr(config, "set_memory_pool_limit"):
        config.set_memory_pool_limit(trt.MemoryPoolType.WORKSPACE, 2 * 1024 * 1024 * 1024)
    else:
        config.max_workspace_size = 2 * 1024 * 1024 * 1024

    if builder.platform_has_fast_fp16:
        config.set_flag(trt.BuilderFlag.FP16)
        log("GST_STAGE compile FP16 enabled")
    else:
        log("GST_STAGE compile FP16 not available on this GPU, using FP32")

    inp = network.get_input(0)
    shape = list(inp.shape)
    log(f"GST_STAGE compile input {inp.name} shape={shape}")
    if any(d < 0 for d in shape[1:]):
        c = shape[1] if shape[1] > 0 else 3
        profile = builder.create_optimization_profile()
        dims = (1, c, tile, tile)
        profile.set_shape(inp.name, dims, dims, dims)
        config.add_optimization_profile(profile)
        log(f"GST_STAGE compile dynamic profile {dims}")
    elif len(shape) == 4 and shape[2] > 0 and shape[3] > 0:
        tile = int(shape[2])
        log(f"GST_STAGE compile static tile {tile}")

    log("GST_STAGE compile Building engine (this can take several minutes)…")
    t0 = time.time()
    serialized = builder.build_serialized_network(network, config)
    if serialized is None:
        raise RuntimeError("TensorRT engine build returned None")
    engine_path.write_bytes(bytes(serialized))
    elapsed = time.time() - t0

    out = network.get_output(0)
    out_shape = list(out.shape)
    scale = args.scale
    if len(shape) == 4 and len(out_shape) == 4 and shape[2] > 0 and out_shape[2] > 0:
        scale = max(1, int(round(out_shape[2] / shape[2])))

    meta = {
        "tile": tile,
        "scale": int(scale),
        "input": inp.name,
        "output": out.name,
        "fp16": bool(builder.platform_has_fast_fp16),
        "tensorrt": trt.__version__,
        "onnx": onnx_path.name,
        "elapsedSec": round(elapsed, 1),
    }
    engine_path.with_suffix(".json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    log(f"GST_STAGE compile Engine saved ({elapsed:.0f}s) tile={tile} scale={meta['scale']}")
    log("GST_STAGE ready")
    return 0


def _load_engine(engine_path: Path):
    import tensorrt as trt  # type: ignore

    logger = trt.Logger(trt.Logger.WARNING)
    runtime = trt.Runtime(logger)
    engine = runtime.deserialize_cuda_engine(engine_path.read_bytes())
    if engine is None:
        raise RuntimeError(f"Failed to deserialize engine: {engine_path}")
    context = engine.create_execution_context()
    if hasattr(context, "set_optimization_profile_async"):
        try:
            stream = cuda_stream_create()
            try:
                try:
                    handle = as_cuda_ptr(stream)
                except (TypeError, ValueError):
                    handle = stream
                context.set_optimization_profile_async(0, handle)
                cuda_stream_sync(stream)
            finally:
                try:
                    cuda_stream_destroy(stream)
                except Exception:
                    pass
        except Exception:
            pass
    return engine, context


def _tensor_names(engine):
    import tensorrt as trt  # type: ignore

    if hasattr(engine, "num_io_tensors"):
        names = [engine.get_tensor_name(i) for i in range(engine.num_io_tensors)]
        inputs, outputs = [], []
        input_mode = getattr(trt, "TensorIOMode", None)
        for n in names:
            mode = engine.get_tensor_mode(n)
            is_input = mode == input_mode.INPUT if input_mode is not None else int(mode) == 1
            is_output = mode == input_mode.OUTPUT if input_mode is not None else int(mode) == 2
            if is_input:
                inputs.append(n)
            elif is_output:
                outputs.append(n)
        if not inputs or not outputs:
            detail = ", ".join(f"{n}={engine.get_tensor_mode(n)}" for n in names) or "none"
            raise RuntimeError(
                f"Could not resolve TensorRT I/O tensors (inputs={inputs}, outputs={outputs}): {detail}"
            )
        return inputs, outputs
    inputs, outputs = [], []
    for i in range(engine.num_bindings):
        name = engine.get_binding_name(i)
        if engine.binding_is_input(i):
            inputs.append(name)
        else:
            outputs.append(name)
    if not inputs or not outputs:
        raise RuntimeError(f"Could not resolve TensorRT bindings (inputs={inputs}, outputs={outputs})")
    return inputs, outputs


def _np_dtype(engine, name: str):
    import numpy as np
    import tensorrt as trt  # type: ignore

    if hasattr(engine, "get_tensor_dtype"):
        return np.dtype(trt.nptype(engine.get_tensor_dtype(name)))
    return np.dtype(np.float32)


def _to_hwc(pred, scale: int, tile: int):
    import numpy as np

    arr = np.asarray(pred)
    arr = np.squeeze(arr)
    if arr.ndim == 3 and arr.shape[0] in (1, 3, 4) and arr.shape[-1] not in (1, 3, 4):
        arr = np.transpose(arr, (1, 2, 0))
    if arr.ndim != 3:
        raise RuntimeError(f"Unexpected TensorRT output shape {getattr(pred, 'shape', None)}")
    if arr.shape[2] not in (1, 3, 4):
        if arr.shape[0] in (1, 3, 4):
            arr = np.transpose(arr, (1, 2, 0))
    expected = tile * scale
    if arr.shape[0] != expected or arr.shape[1] != expected:
        log(f"GST_STAGE infer tile out {arr.shape} expected {expected}x{expected}")
    return arr


class TileRunner:
    """Reuse one CUDA stream + device I/O buffers across all tiles/frames."""

    def __init__(self, engine, context, tile: int, scale: int):
        import numpy as np

        self.engine = engine
        self.context = context
        self.tile = tile
        self.scale = scale
        inputs, outputs = _tensor_names(engine)
        self.in_name = inputs[0]
        self.out_name = outputs[0]
        self.in_dtype = _np_dtype(engine, self.in_name)
        self.out_dtype = _np_dtype(engine, self.out_name)

        in_shape = (1, 3, tile, tile)
        if hasattr(context, "set_input_shape"):
            try:
                context.set_input_shape(self.in_name, in_shape)
            except Exception:
                pass

        if hasattr(context, "get_tensor_shape"):
            out_shape = tuple(int(d) for d in context.get_tensor_shape(self.out_name))
        elif hasattr(engine, "get_tensor_shape"):
            out_shape = tuple(int(d) for d in engine.get_tensor_shape(self.out_name))
        else:
            out_shape = (1, 3, tile * scale, tile * scale)
        if any(d <= 0 for d in out_shape):
            out_shape = (1, 3, tile * scale, tile * scale)
        self.out_shape = out_shape

        self.in_nbytes = int(np.prod(in_shape)) * int(np.dtype(self.in_dtype).itemsize)
        self.out_nbytes = int(np.prod(out_shape)) * int(np.dtype(self.out_dtype).itemsize)
        self.host_out = np.empty(int(np.prod(out_shape)), dtype=self.out_dtype)
        self.d_in = cuda_malloc(self.in_nbytes)
        self.d_out = cuda_malloc(self.out_nbytes)
        self.stream = cuda_stream_create()
        self.stream_handle = as_cuda_ptr(self.stream)
        self.in_ptr = as_cuda_ptr(self.d_in)
        self.out_ptr = as_cuda_ptr(self.d_out)

        if hasattr(context, "set_tensor_address"):
            context.set_tensor_address(self.in_name, self.in_ptr)
            context.set_tensor_address(self.out_name, self.out_ptr)

    def infer(self, tile_nchw):
        import numpy as np

        inp = np.ascontiguousarray(tile_nchw.astype(self.in_dtype, copy=False))
        if inp.nbytes != self.in_nbytes:
            raise RuntimeError(f"Tile byte size mismatch {inp.nbytes} vs {self.in_nbytes}")

        if hasattr(self.context, "set_input_shape"):
            try:
                self.context.set_input_shape(self.in_name, tuple(int(d) for d in inp.shape))
            except Exception:
                pass

        cuda_memcpy(self.d_in, inp.ctypes.data, inp.nbytes, "htod")
        if hasattr(self.context, "execute_async_v3"):
            ok = self.context.execute_async_v3(self.stream_handle)
            cuda_stream_sync(self.stream)
        elif hasattr(self.context, "set_tensor_address"):
            ok = self.context.execute_v2([self.in_ptr, self.out_ptr])
        else:
            ok = self.context.execute_v2([self.in_ptr, self.out_ptr])
        if ok is False:
            raise RuntimeError("TensorRT execute failed")
        cuda_memcpy(self.host_out.ctypes.data, self.d_out, self.out_nbytes, "dtoh")
        return self.host_out.reshape(self.out_shape).astype(np.float32, copy=False)

    def close(self) -> None:
        try:
            cuda_stream_destroy(self.stream)
        except Exception:
            pass
        try:
            cuda_free(self.d_in)
        except Exception:
            pass
        try:
            cuda_free(self.d_out)
        except Exception:
            pass


def _upscale_image(img, runner: TileRunner, tile: int, scale: int, overlap: int):
    import numpy as np

    h, w, _ = img.shape
    step = max(1, tile - overlap)
    pad_h = (step - (h - tile) % step) % step if h > tile else max(0, tile - h)
    pad_w = (step - (w - tile) % step) % step if w > tile else max(0, tile - w)
    if h <= tile:
        pad_h = tile - h
    if w <= tile:
        pad_w = tile - w

    padded = np.pad(img, ((0, pad_h), (0, pad_w), (0, 0)), mode="reflect")
    ph, pw = padded.shape[:2]
    out = np.zeros((ph * scale, pw * scale, 3), dtype=np.float32)
    weight = np.zeros((ph * scale, pw * scale, 1), dtype=np.float32)

    ys = list(range(0, max(ph - tile, 0) + 1, step))
    xs = list(range(0, max(pw - tile, 0) + 1, step))
    if not ys:
        ys = [0]
    if not xs:
        xs = [0]

    for y in ys:
        for x in xs:
            patch = padded[y : y + tile, x : x + tile, :]
            if patch.shape[0] != tile or patch.shape[1] != tile:
                continue
            nchw = np.transpose(patch.astype(np.float32) / 255.0, (2, 0, 1))[None, ...]
            pred = _to_hwc(runner.infer(nchw), scale, tile)
            if pred.shape[2] != 3:
                if pred.shape[2] == 1:
                    pred = np.repeat(pred, 3, axis=2)
                else:
                    pred = pred[:, :, :3]
            oh, ow = pred.shape[:2]
            y0, x0 = y * scale, x * scale
            out[y0 : y0 + oh, x0 : x0 + ow, :] += pred
            weight[y0 : y0 + oh, x0 : x0 + ow, :] += 1.0

    weight = np.maximum(weight, 1e-6)
    merged = np.clip(out / weight, 0.0, 1.0)
    cropped = merged[: h * scale, : w * scale, :]
    return (cropped * 255.0 + 0.5).astype(np.uint8)


def _resolve_meta(engine_path: Path, tile: int, native_scale: int):
    meta_path = engine_path.with_suffix(".json")
    if meta_path.is_file():
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
        tile = int(meta.get("tile") or tile)
        native_scale = int(meta.get("scale") or native_scale)
    return tile, native_scale


def cmd_infer(args: argparse.Namespace) -> int:
    from PIL import Image
    import numpy as np

    engine_path = Path(args.engine)
    in_dir = Path(args.input_dir)
    out_dir = Path(args.output_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    tile = int(args.tile)
    native_scale = int(args.scale)
    target_scale = int(args.target_scale) if getattr(args, "target_scale", None) else native_scale
    tile, native_scale = _resolve_meta(engine_path, tile, native_scale)

    files = sorted(
        [p for p in in_dir.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg"}]
    )
    if not files:
        raise RuntimeError(f"No images in {in_dir}")

    log(
        f"GST_STAGE infer Loading engine tile={tile} scale={native_scale} target={target_scale}"
    )
    engine, context = _load_engine(engine_path)
    runner = TileRunner(engine, context, tile, native_scale)
    overlap = min(16, max(0, tile // 8))
    total = len(files)

    try:
        for i, src in enumerate(files, start=1):
            img = Image.open(src).convert("RGB")
            arr = np.array(img)
            up = _upscale_image(arr, runner, tile, native_scale, overlap)
            if target_scale != native_scale:
                out_w = arr.shape[1] * target_scale
                out_h = arr.shape[0] * target_scale
                up = np.array(
                    Image.fromarray(up).resize((out_w, out_h), Image.Resampling.LANCZOS)
                )
            dest = out_dir / src.name
            Image.fromarray(up).save(dest)
            pct = (i / total) * 100
            log(f"GST_FRAME {i}/{total} {pct:.1f}%")
    finally:
        runner.close()

    log("GST_STAGE done")
    return 0


def cmd_stream(args: argparse.Namespace) -> int:
    """Raw rgb24 stdin → TensorRT upscale → raw rgb24 stdout. Progress on stderr."""
    from PIL import Image
    import numpy as np

    _set_stdio_binary()
    engine_path = Path(args.engine)
    width = int(args.width)
    height = int(args.height)
    tile = int(args.tile)
    native_scale = int(args.scale)
    target_scale = int(args.target_scale) if getattr(args, "target_scale", None) else native_scale
    frame_count = int(args.frame_count) if getattr(args, "frame_count", None) else 0
    tile, native_scale = _resolve_meta(engine_path, tile, native_scale)

    if width <= 0 or height <= 0:
        raise RuntimeError(f"Invalid frame size {width}x{height}")

    in_bytes = width * height * 3
    out_w = width * target_scale
    out_h = height * target_scale
    # NVENC/yuv420 need even dims; pad write size is caller's encode size — we emit exact target.
    log(
        f"GST_STAGE stream Loading engine tile={tile} scale={native_scale} "
        f"target={target_scale} in={width}x{height} out={out_w}x{out_h}"
    )

    engine, context = _load_engine(engine_path)
    runner = TileRunner(engine, context, tile, native_scale)
    overlap = min(16, max(0, tile // 8))

    stdin = sys.stdin.buffer
    stdout = sys.stdout.buffer
    i = 0

    try:
        while True:
            raw = _read_exact(stdin, in_bytes)
            if raw is None:
                break
            i += 1
            arr = np.frombuffer(raw, dtype=np.uint8).reshape((height, width, 3)).copy()
            up = _upscale_image(arr, runner, tile, native_scale, overlap)
            if target_scale != native_scale:
                up = np.array(
                    Image.fromarray(up).resize((out_w, out_h), Image.Resampling.LANCZOS)
                )
            if not up.flags["C_CONTIGUOUS"]:
                up = np.ascontiguousarray(up)
            stdout.write(up.tobytes())
            stdout.flush()
            total = frame_count if frame_count > 0 else max(i, 1)
            pct = (i / total) * 100 if frame_count > 0 else 0.0
            log(f"GST_FRAME {i}/{total} {pct:.1f}%")
    finally:
        runner.close()
        try:
            stdout.flush()
        except Exception:
            pass

    log(f"GST_STAGE done frames={i}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Green Sparkle Technology TensorRT worker")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_ver = sub.add_parser("version")
    p_ver.set_defaults(func=cmd_version)

    p_build = sub.add_parser("build")
    p_build.add_argument("--onnx", required=True)
    p_build.add_argument("--engine", required=True)
    p_build.add_argument("--tile", type=int, default=128)
    p_build.add_argument("--scale", type=int, default=4)
    p_build.set_defaults(func=cmd_build)

    p_infer = sub.add_parser("infer")
    p_infer.add_argument("--engine", required=True)
    p_infer.add_argument("--input-dir", required=True)
    p_infer.add_argument("--output-dir", required=True)
    p_infer.add_argument("--tile", type=int, default=128)
    p_infer.add_argument("--scale", type=int, default=4)
    p_infer.add_argument("--target-scale", type=int, default=None)
    p_infer.set_defaults(func=cmd_infer)

    p_stream = sub.add_parser("stream")
    p_stream.add_argument("--engine", required=True)
    p_stream.add_argument("--width", type=int, required=True)
    p_stream.add_argument("--height", type=int, required=True)
    p_stream.add_argument("--tile", type=int, default=128)
    p_stream.add_argument("--scale", type=int, default=4)
    p_stream.add_argument("--target-scale", type=int, default=None)
    p_stream.add_argument("--frame-count", type=int, default=0)
    p_stream.set_defaults(func=cmd_stream)

    args = parser.parse_args()
    try:
        return int(args.func(args) or 0)
    except KeyboardInterrupt:
        return 130
    except Exception as exc:
        log(f"GST_ERROR {exc}")
        return 1


if __name__ == "__main__":
    sys.exit(main())
