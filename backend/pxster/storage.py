import io
import json
import subprocess
import tempfile
from fractions import Fraction
from pathlib import Path
import boto3
from PIL import Image, UnidentifiedImageError
from .config import settings

Image.MAX_IMAGE_PIXELS = 25_000_000


def validate_media(data: bytes, content_type: str):
    if not data or len(data) > settings.max_upload:
        raise ValueError("Choose a non-empty file smaller than 64 MiB.")
    if content_type in {"image/jpeg", "image/png", "image/webp"}:
        try:
            with Image.open(io.BytesIO(data)) as image:
                actual = Image.MIME.get(image.format)
                width, height = image.size
                image.verify()
            if actual != content_type or width < 100 or height < 100:
                raise ValueError("Image format must match its type, with both dimensions at least 100 pixels.")
            return {"valid": True, "width": width, "height": height, "kind": "image"}
        except (UnidentifiedImageError, OSError, Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise ValueError("This image is damaged or too large to decode safely.") from None
    if content_type == "video/mp4":
        with tempfile.NamedTemporaryFile(suffix=".mp4") as file:
            file.write(data)
            file.flush()
            try:
                result = subprocess.run(
                    ["ffprobe", "-v", "error", "-protocol_whitelist", "file,pipe", "-show_streams", "-show_format", "-of", "json", file.name],
                    capture_output=True, timeout=30, check=True,
                )
                info = json.loads(result.stdout)
                video = next(s for s in info["streams"] if s["codec_type"] == "video")
                duration = float(info["format"]["duration"])
                if video["codec_name"] != "h264" or not 3 <= duration <= 600:
                    raise ValueError("Use H.264 MP4 video between 3 seconds and 10 minutes.")
                if "mp4" not in info["format"]["format_name"]:
                    raise ValueError("Use an MP4 container.")
                fps = float(Fraction(video["avg_frame_rate"]))
                return {"valid": True, "kind": "video", "width": video["width"], "height": video["height"], "duration": duration, "fps": fps}
            except FileNotFoundError:
                raise ValueError("Video validation is unavailable: install FFmpeg on the API host.") from None
            except (subprocess.SubprocessError, KeyError, StopIteration, json.JSONDecodeError, ZeroDivisionError):
                raise ValueError("This MP4 could not be validated.") from None
    raise ValueError("Supported media: JPEG, PNG, WebP, and H.264 MP4.")


def r2():
    return boto3.client("s3", endpoint_url=settings.r2_endpoint, region_name="auto",
                        aws_access_key_id=settings.r2_access_key, aws_secret_access_key=settings.r2_secret_key)


def save(key, data, content_type):
    if settings.storage == "r2":
        r2().put_object(Bucket=settings.r2_bucket, Key=key, Body=data, ContentType=content_type)
    else:
        path = Path("data/media") / key
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)


def read(key):
    if settings.storage == "r2":
        return r2().get_object(Bucket=settings.r2_bucket, Key=key)["Body"].read()
    return (Path("data/media") / key).read_bytes()
