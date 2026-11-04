from functools import lru_cache
from pathlib import Path
from typing import List
from pydantic import field_validator, model_validator

try:
    from pydantic_settings import BaseSettings, SettingsConfigDict
except ImportError:  # Keeps static analysis friendly before dependencies are installed.
    from pydantic import BaseModel as BaseSettings
    SettingsConfigDict = dict


class Settings(BaseSettings):
    app_name: str = "UrbanFix AI"
    environment: str = "development"
    public_base_url: str = ""
    admin_username: str = "admin"
    admin_password: str = "admin"
    allow_demo_admin: bool = False
    allow_demo_officer_login: bool = False
    demo_officer_default_password: str = "OfficerDemo123!"
    reporter_token_secret: str = "development-reporter-secret"
    evidence_signing_secret: str = ""
    api_prefix: str = "/api"
    mongo_uri: str = "mongodb://localhost:27017"
    mongo_db_name: str = "civicpulse"
    gemini_api_key: str = ""
    gemini_model: str = "gemini-3.5-flash-lite"
    gemini_timeout_seconds: int = 60
    ai_min_confidence: float = 0.70
    duplicate_auto_merge_confidence: float = 0.82
    duplicate_review_confidence: float = 0.58
    cloudinary_cloud_name: str = ""
    cloudinary_api_key: str = ""
    cloudinary_api_secret: str = ""
    cloudinary_url: str = ""
    payment_provider: str = "demo"
    stripe_secret_key: str = ""
    upload_dir: str = ""
    max_upload_mb: int = 10
    max_image_megapixels: int = 30
    default_page_size: int = 100
    max_page_size: int = 250
    whatsapp_webhook_secret: str = ""
    whatsapp_verify_token: str = ""
    allow_memory_fallback: bool = True
    seed_demo_data: bool = True
    mongo_cleanup_threshold_mb: int = 450
    mongo_cleanup_target_mb: int = 425
    cors_origins: List[str] = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:5500",
        "null",
    ]

    @field_validator("cors_origins", mode="before")
    @classmethod
    def assemble_cors_origins(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("[") and v.endswith("]"):
                import json
                try:
                    return json.loads(v)
                except Exception:
                    pass
            return [i.strip() for i in v.split(",") if i.strip()]
        return v

    model_config = SettingsConfigDict(
        env_file=(".env", "backend/.env", str(Path(__file__).resolve().parents[2] / ".env")),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    @model_validator(mode="after")
    def validate_production_safety(self):
        if self.environment == "production":
            unsafe = []
            demo_admin = self.admin_username.lower() == "admin" and self.admin_password == "admin"
            if demo_admin and not self.allow_demo_admin:
                unsafe.append("ADMIN_USERNAME/ADMIN_PASSWORD")
            if len(self.admin_password) < 12 and not (demo_admin and self.allow_demo_admin):
                unsafe.append("ADMIN_PASSWORD (minimum 12 characters)")
            if self.reporter_token_secret == "development-reporter-secret" or len(self.reporter_token_secret) < 32:
                unsafe.append("REPORTER_TOKEN_SECRET (minimum 32 characters)")
            if not self.evidence_signing_secret or len(self.evidence_signing_secret) < 32:
                unsafe.append("EVIDENCE_SIGNING_SECRET (minimum 32 characters)")
            if self.mongo_uri in {"", "mongodb://localhost:27017"}:
                unsafe.append("MONGO_URI")
            cloudinary_parts = all((self.cloudinary_cloud_name, self.cloudinary_api_key, self.cloudinary_api_secret))
            if not self.cloudinary_url and not cloudinary_parts:
                unsafe.append("CLOUDINARY_URL or separate Cloudinary credentials")
            if self.payment_provider == "stripe" and not self.stripe_secret_key:
                unsafe.append("STRIPE_SECRET_KEY required when PAYMENT_PROVIDER=stripe")
            elif self.payment_provider not in {"stripe", "demo"}:
                unsafe.append("PAYMENT_PROVIDER must be 'stripe' or 'demo'")
            if unsafe:
                raise ValueError("Unsafe production configuration: " + ", ".join(unsafe))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings()


settings = get_settings()


def project_root() -> Path:
    return Path(__file__).resolve().parents[3]


def upload_directory() -> Path:
    return Path(settings.upload_dir).expanduser().resolve() if settings.upload_dir else project_root() / "data" / "uploads"
