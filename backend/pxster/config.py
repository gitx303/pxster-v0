import os
from dataclasses import dataclass
from cryptography.fernet import Fernet


@dataclass
class Settings:
    environment: str = os.getenv("ENVIRONMENT", "development")
    database_url: str = os.getenv("DATABASE_URL", "sqlite:///./data/pxster.db")
    app_origin: str = os.getenv("APP_ORIGIN", "http://localhost:5173")
    demo: bool = os.getenv("DEMO_MODE", "false").lower() == "true"
    registration: bool = os.getenv("ALLOW_REGISTRATION", "false").lower() == "true"
    token_key: str = os.getenv("TOKEN_ENCRYPTION_KEY", "")
    storage: str = os.getenv("STORAGE_DRIVER", "local")
    r2_endpoint: str = os.getenv("R2_ENDPOINT_URL", "")
    r2_bucket: str = os.getenv("R2_BUCKET", "pxster-media")
    r2_access_key: str = os.getenv("R2_ACCESS_KEY_ID", "")
    r2_secret_key: str = os.getenv("R2_SECRET_ACCESS_KEY", "")
    max_upload: int = 64 * 1024 * 1024
    api_url: str = os.getenv("API_URL", "http://localhost:8017")
    media_url: str = os.getenv("MEDIA_URL", "")
    facebook_version: str = os.getenv("FACEBOOK_GRAPH_VERSION", "v23.0")

    def validate(self):
        if self.environment == "production":
            if self.demo or self.storage != "r2" or not self.database_url.startswith("postgresql"):
                raise RuntimeError("Production requires PostgreSQL, R2, and DEMO_MODE=false")
            if not self.app_origin.startswith("https://") or not self.api_url.startswith("https://"):
                raise RuntimeError("Production APP_ORIGIN and API_URL must use HTTPS")
            if self.media_url and not self.media_url.startswith("https://"):
                raise RuntimeError("Production MEDIA_URL must use HTTPS")
            if not all([self.token_key, self.r2_endpoint, self.r2_access_key, self.r2_secret_key]):
                raise RuntimeError("Production encryption and R2 secrets are required")
        if self.token_key:
            Fernet(self.token_key.encode())


settings = Settings()
