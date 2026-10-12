from pxster.config import settings


def test_signup_username_login_and_session(client):
    registration = client.post('/auth/register', json={'username': 'NeonCreator', 'email': 'neon@example.com', 'password': 'Neon-creator-test-123'})
    assert registration.status_code == 201
    assert registration.json()['username'] == 'neoncreator'
    assert client.get('/auth/me').json()['username'] == 'neoncreator'
    client.post('/auth/logout')
    assert client.get('/accounts').status_code == 401
    assert client.get('/posts').status_code == 401
    result = client.post('/auth/login', json={'identifier': 'NEONCREATOR', 'password': 'Neon-creator-test-123'})
    assert result.status_code == 200
    client.post('/auth/logout')
    assert client.post('/auth/login', json={'identifier': 'neon@example.com', 'password': 'Neon-creator-test-123'}).status_code == 200


def test_unique_username_and_email(client):
    first = {'username': 'NeonCreator', 'email': 'one@example.com', 'password': 'Neon-creator-test-123'}
    assert client.post('/auth/register', json=first).status_code == 201
    assert client.post('/auth/register', json={**first, 'username': 'neoncreator', 'email': 'two@example.com'}).status_code == 409
    assert client.post('/auth/register', json={**first, 'username': 'another'}).status_code == 409


def test_existing_email_login_and_bad_credentials(client):
    client.post('/auth/register', json={'email': 'old@example.com', 'password': 'existing-user-test-123'})
    client.post('/auth/logout')
    assert client.post('/auth/login', json={'email': 'old@example.com', 'password': 'existing-user-test-123'}).status_code == 200
    client.post('/auth/logout')
    assert client.post('/auth/login', json={'identifier': 'missing-user', 'password': 'bad-password-test-123'}).status_code == 401
    assert client.get('/auth/me').status_code == 401
    assert client.post('/auth/login', json={'password': 'bad-password-test-123'}).status_code == 422


def test_signup_invalid_username_and_registration_switch(client, monkeypatch):
    body = {'username': 'bad@name', 'email': 'one@example.com', 'password': 'Neon-creator-test-123'}
    assert client.post('/auth/register', json=body).status_code == 422
    monkeypatch.setattr(settings, 'registration', False)
    assert client.post('/auth/register', json={**body, 'username': 'valid-name'}).status_code == 403
