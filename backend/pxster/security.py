import hashlib
import json
from cryptography.fernet import Fernet
from pwdlib import PasswordHash
from .config import settings

passwords = PasswordHash.recommended()


def digest(token):
    return hashlib.sha256(token.encode()).hexdigest()


def encrypt_tokens(tokens: dict):
    if not settings.token_key:
        raise RuntimeError("Configure TOKEN_ENCRYPTION_KEY before connecting live accounts")
    return Fernet(settings.token_key.encode()).encrypt(json.dumps(tokens).encode()).decode()


def decrypt_tokens(value: str):
    return json.loads(Fernet(settings.token_key.encode()).decrypt(value.encode()))
