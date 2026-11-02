import asyncio
from io import BytesIO

from PIL import Image
from starlette.datastructures import Headers, UploadFile

from app.services.storage import cloudinary as storage


def test_jpeg_normalization_does_not_mutate_upload_content_type(monkeypatch, tmp_path):
    source = BytesIO()
    Image.new("RGB", (12, 12), "gray").save(source, format="JPEG")
    upload = UploadFile(
        BytesIO(source.getvalue()),
        filename="evidence.jpg",
        headers=Headers({"content-type": "image/jpeg"}),
    )
    monkeypatch.setattr(storage.settings, "environment", "development")
    monkeypatch.setattr(storage.settings, "cloudinary_url", "")
    monkeypatch.setattr(storage.settings, "cloudinary_cloud_name", "")
    monkeypatch.setattr(storage.settings, "cloudinary_api_key", "")
    monkeypatch.setattr(storage.settings, "cloudinary_api_secret", "")
    monkeypatch.setattr(storage, "upload_directory", lambda: tmp_path)

    url = asyncio.run(storage.store_upload(upload))

    assert url.endswith(".jpg")
    assert upload.content_type == "image/jpeg"
    assert len(list(tmp_path.glob("*.jpg"))) == 1
