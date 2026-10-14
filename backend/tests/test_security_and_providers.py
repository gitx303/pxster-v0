from datetime import timedelta
import time
from cryptography.fernet import Fernet
from sqlalchemy import select
from pxster.config import settings
from pxster.models import ConnectedAccount, OAuthState, Session, User, now
from pxster.security import digest, encrypt_tokens, decrypt_tokens
from pxster import providers
from test_workflow import setup_post


def test_encryption_and_no_tokens_in_account_api(creator, monkeypatch):
    monkeypatch.setattr(settings, 'token_key', Fernet.generate_key().decode())
    tokens = {'access_token': 'secret-value', 'refresh_token': 'refresh-value'}
    encrypted = encrypt_tokens(tokens)
    assert 'secret-value' not in encrypted
    assert decrypt_tokens(encrypted) == tokens
    setup_post(creator)
    with Session() as db:
        account = db.scalar(select(ConnectedAccount)); account.encrypted_tokens = encrypted; db.commit()
    response = creator.get('/accounts').text
    assert 'secret-value' not in response
    assert 'encrypted_tokens' not in response


def test_oauth_state_single_use_and_bound_to_user(creator, monkeypatch):
    monkeypatch.setattr(providers, 'exchange', lambda *args: [('page123', 'Page name', {'access_token': 'private'})])
    monkeypatch.setattr(settings, 'token_key', Fernet.generate_key().decode())
    with Session() as db:
        user = db.scalar(select(User))
        db.add(OAuthState(state_hash=digest('good-state'), owner_id=user.id, platform='facebook', expires_at=now() + timedelta(minutes=5)))
        db.commit()
    assert creator.get('/oauth/facebook/callback?state=bad&code=code', follow_redirects=False).status_code == 400
    response = creator.get('/oauth/facebook/callback?state=good-state&code=code', follow_redirects=False)
    assert response.status_code == 307
    assert 'success' in response.headers['location']
    assert creator.get('/oauth/facebook/callback?state=good-state&code=code', follow_redirects=False).status_code == 400


def test_signed_delivery_and_range(creator, monkeypatch):
    monkeypatch.setattr(settings, 'token_key', Fernet.generate_key().decode())
    media_id = setup_post(creator)['media_id']
    expires = int(time.time()) + 300
    signature = providers.media_signature(media_id, expires)
    creator.post('/auth/logout')
    url = f'/media-delivery/{media_id}?expires={expires}&signature={signature}'
    assert creator.get(url).status_code == 200
    partial = creator.get(url, headers={'Range': 'bytes=0-9'})
    assert partial.status_code == 206
    assert len(partial.content) == 10
    assert creator.get(url + 'wrong').status_code == 403
    assert creator.get(f'/media-delivery/{media_id}?expires=1&signature={signature}').status_code == 403


def test_live_tokens_not_configured_by_default(creator):
    assert creator.post('/oauth/facebook/start').status_code == 503


def test_production_rejects_demo(monkeypatch):
    import pytest
    monkeypatch.setattr(settings, 'environment', 'production')
    with pytest.raises(RuntimeError, match='Production requires'):
        settings.validate()


def test_delivery_domain_preserves_oauth_domain(monkeypatch):
    monkeypatch.setattr(settings, 'media_url', 'https://media.pxster.xyz/')
    monkeypatch.setattr(settings, 'api_url', 'https://api.pxster.xyz')
    monkeypatch.setattr(settings, 'token_key', Fernet.generate_key().decode())
    assert providers.delivery_url('asset').startswith('https://media.pxster.xyz/media-delivery/asset?')
    for platform in ['facebook', 'tiktok', 'youtube']:
        assert providers.callback(platform) == f'https://api.pxster.xyz/oauth/{platform}/callback'
    monkeypatch.setattr(settings, 'media_url', '')
    assert providers.delivery_url('asset').startswith('https://api.pxster.xyz/media-delivery/asset?')
