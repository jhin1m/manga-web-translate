# Model weights

Weights **không commit** (`.gitignore`). Nguồn, revision và sha256 nằm ở [`../models.lock.json`](../models.lock.json);
`mtl_pipeline/models.py` kiểm sha256 khi khởi động và từ chối mọi file không phải `.onnx`/`.safetensors`.

Tải (chạy từ thư mục `worker/`):

```sh
uv run python scripts/fetch_models.py   # tải theo lock + kiểm sha256
```

| name | file | dùng cho |
|---|---|---|
| `rtdetr_v2_comic` | `rtdetr-v2-comic.onnx` | box bóng / chữ trong bóng / chữ ngoài bóng (ogkalu RT-DETRv2, input 640) |
| `comic_text_detector` | `comictextdetector.pt.onnx` | mask chữ mức pixel (input 1024, release manga-image-translator) |
| `big_lama` | `lama_fp32.onnx` | inpaint LaMa (input cố định 512) |

Khi chạy bench/production đặt `HF_HUB_OFFLINE=1`; đổi thư mục model bằng `MTL_MODELS_DIR`.
