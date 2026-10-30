"""SAM 3.1 on Modal: backend for countLoad() in src/lib/ai/vision.ts.

Contract (same as the app expects):
  POST  {model, image: "data:<mime>;base64,...", prompts: ["cardboard box", "pallet"]}
  ->    {detections: [{label, box: [x, y, w, h], score}], ms, image: {width, height}, model}
  box = 0..1, x/y = top-left corner.

Deploy (Guillermo, see modal/README.md):  modal deploy modal/sam_service.py
Secrets: dockclerk-sam (SAM_TOKEN) and dockclerk-hf (HF_TOKEN). No values live in this repo.
"""

import base64
import binascii
import hmac
import io
import os
import time

import modal

APP_NAME = "dockclerk-sam"
MODELS_DIR = "/models"
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # decoded image
MAX_PROMPTS = 5
MAX_PROMPT_CHARS = 40
MAX_SIDE = 1536  # bigger photos are shrunk first: faster, and boxes are normalized anyway

SAM3_COMMIT = "f1647e8d0c1d280991f4d1b7d974c2704537fe66"  # facebookresearch/sam3, tested 30/10

# facebook/sam3.1 ships "sam3.1_multiplex.pt" (video/multiplex checkpoint); the image builder expects facebook/sam3.
# Measured 30/10: the 3.1 detector fills every weight of the image model except the 4 of one neck scale
# (vision_backbone.convs.3), and on a test photo both found the same 12 boxes (mean IoU 0.89 with the truth).
# So 3.1 is used when only those are missing; anything else missing -> facebook/sam3. /health says which and why.
CHECKPOINTS = [("sam3.1", "facebook/sam3.1", "sam3.1_multiplex.pt"), ("sam3", "facebook/sam3", "sam3.pt")]
KNOWN_GAP = "backbone.vision_backbone.convs.3."

image = (
    modal.Image.debian_slim(python_version="3.12")
    .apt_install("git")
    .pip_install("torch==2.10.0", "torchvision", index_url="https://download.pytorch.org/whl/cu128")
    # sam3 imports pycocotools, cv2, scipy and psutil at import time without declaring them (checked 30/10).
    .pip_install("fastapi[standard]", "pillow", "numpy", "huggingface_hub", "einops", "pycocotools", "opencv-python-headless", "scipy", "psutil")
    .run_commands(f"pip install git+https://github.com/facebookresearch/sam3.git@{SAM3_COMMIT}")
    .env({"HF_HOME": MODELS_DIR, "TOKENIZERS_PARALLELISM": "false"})
)

app = modal.App(APP_NAME, image=image)
weights = modal.Volume.from_name("dockclerk-sam-weights", create_if_missing=True)


@app.cls(
    gpu="L4",  # 24 GB is plenty for this ~0.85B model in bf16; cheaper than A10G/A100 and a still fast enough photo (~1 s)
    volumes={MODELS_DIR: weights},
    secrets=[modal.Secret.from_name("dockclerk-sam"), modal.Secret.from_name("dockclerk-hf")],
    scaledown_window=60,  # seconds idle before the GPU is released (credits!)
    timeout=120,
    max_containers=1,  # never more than one GPU running at once
)
class Sam:
    @modal.enter()
    def load(self):
        import torch
        from huggingface_hub import hf_hub_download
        from sam3.model.sam3_image_processor import Sam3Processor
        from sam3.model_builder import build_sam3_image_model

        self.torch = torch
        t0 = time.time()
        # The builder's own loader uses strict=False and only prints missing weights, so we load and check ourselves.
        for name, repo, filename in CHECKPOINTS:
            try:
                path = hf_hub_download(repo, filename)  # HF_TOKEN from the secret; cached in the volume
                weights.commit()  # keep the downloaded weights for the next cold start
                model = build_sam3_image_model(load_from_HF=False)
                ckpt = torch.load(path, map_location="cpu", weights_only=True)
                ckpt = ckpt["model"] if isinstance(ckpt.get("model"), dict) else ckpt
                detector = {k.replace("detector.", ""): v for k, v in ckpt.items() if "detector" in k}
                missing, _ = model.load_state_dict(detector, strict=False)
                del ckpt, detector
            except Exception as error:  # no access, download or shape problem
                print(f"{name} failed: {error!r}")
                continue
            unknown = [k for k in missing if not (name == "sam3.1" and k.startswith(KNOWN_GAP))]
            if unknown:
                print(f"{name}: {len(unknown)} weights missing ({unknown[:3]}...), trying the next checkpoint")
                continue
            self.model_name, self.missing = name, len(missing)
            break
        else:
            raise RuntimeError("No SAM checkpoint could be loaded")
        self.processor = Sam3Processor(model.cuda().eval(), device="cuda")
        print(f"loaded {self.model_name} ({self.missing} known-missing weights) in {time.time() - t0:.1f}s")

    @modal.asgi_app()
    def web(self):
        from fastapi import FastAPI, Header, HTTPException
        from PIL import Image, ImageOps
        from pydantic import BaseModel

        api = FastAPI(title="DockClerk SAM")
        token = os.environ.get("SAM_TOKEN", "")

        class Body(BaseModel):
            model: str | None = None
            image: str
            prompts: list[str]

        def check(authorization: str | None):
            sent = (authorization or "").removeprefix("Bearer ").strip()
            if not token or not hmac.compare_digest(sent.encode(), token.encode()):
                raise HTTPException(status_code=401, detail="Bad token")

        @api.get("/health")
        def health(authorization: str | None = Header(default=None)):
            check(authorization)
            return {"ok": True, "model": self.model_name, "missing_weights": self.missing}

        @api.post("/")
        def segment(body: Body, authorization: str | None = Header(default=None)):
            check(authorization)
            prompts = [p.strip() for p in body.prompts if p.strip()]
            if not 1 <= len(prompts) <= MAX_PROMPTS or any(len(p) > MAX_PROMPT_CHARS for p in prompts):
                raise HTTPException(status_code=422, detail=f"1-{MAX_PROMPTS} prompts of at most {MAX_PROMPT_CHARS} characters")
            if len(body.image) > MAX_IMAGE_BYTES * 4 // 3 + 200:
                raise HTTPException(status_code=413, detail="Image over 8 MB")
            b64 = body.image.split(",", 1)[1] if body.image.startswith("data:") else body.image
            try:
                raw = base64.b64decode(b64, validate=False)
                if len(raw) > MAX_IMAGE_BYTES:
                    raise HTTPException(status_code=413, detail="Image over 8 MB")
                img = ImageOps.exif_transpose(Image.open(io.BytesIO(raw))).convert("RGB")
            except HTTPException:
                raise
            except (binascii.Error, OSError, ValueError):
                raise HTTPException(status_code=422, detail="Not a readable image")

            t0 = time.time()
            width, height = img.size
            if max(img.size) > MAX_SIDE:
                img.thumbnail((MAX_SIDE, MAX_SIDE))
            w, h = img.size  # boxes come back in the pixels of this (maybe shrunk) image

            detections = []
            with self.torch.inference_mode(), self.torch.autocast("cuda", dtype=self.torch.bfloat16):
                state = self.processor.set_image(img)
                for prompt in prompts:
                    out = self.processor.set_text_prompt(state=state, prompt=prompt)
                    # README: boxes are xyxy in pixels (sam3_image_processor._forward_grounding) -> xywh in 0..1
                    boxes = out["boxes"].float().cpu().tolist()
                    scores = out["scores"].float().cpu().tolist()
                    for (x0, y0, x1, y1), score in zip(boxes, scores):
                        x, y = max(0.0, x0 / w), max(0.0, y0 / h)
                        detections.append({
                            "label": prompt,
                            "box": [round(x, 4), round(y, 4), round(min(1.0, x1 / w) - x, 4), round(min(1.0, y1 / h) - y, 4)],
                            "score": round(float(score), 4),
                        })
            detections.sort(key=lambda d: -d["score"])
            return {
                "detections": detections,
                "ms": round((time.time() - t0) * 1000),
                "image": {"width": width, "height": height},
                "model": self.model_name,
            }

        return api
