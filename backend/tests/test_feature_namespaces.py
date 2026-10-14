import re
from sqlalchemy import select, func
from pxster.features.router import MANIFEST, install_reserved_routes
from pxster.models import Base, Session, Post, PublishAttempt
from pxster.api import app, current_user


def test_reservations_are_authenticated_and_inert(client):
    for feature in MANIFEST['features'].values():
        for route in feature['routes']:
            path = re.sub(r'\{\w+\}', 'example', route['path'])
            assert client.request(route['method'], path).status_code == 401


def test_reserved_actions_never_claim_success(creator):
    for name, feature in MANIFEST['features'].items():
        for route in feature['routes']:
            path = re.sub(r'\{\w+\}', 'example', route['path'])
            response = creator.request(route['method'], path)
            assert response.status_code == 501
            assert response.json()['detail']['feature'] == name
            assert response.json()['detail']['code'] == 'feature_not_implemented'
    assert all(not feature['enabled'] for feature in creator.get('/config').json()['features'].values())
    with Session() as db:
        assert db.scalar(select(func.count()).select_from(Post)) == 0
        assert db.scalar(select(func.count()).select_from(PublishAttempt)) == 0


def test_namespace_collisions_and_unmounted_ingress():
    import pytest
    routes, tables, ui, operations = [], [], [], []
    for feature in MANIFEST['features'].values():
        tables += feature['tables']
        if feature['ui']: ui.append(feature['ui'])
        for route in feature['routes']:
            routes.append((route['method'], re.sub(r'\{\w+\}', '{}', route['path'])))
            operations.append(route['operation_id'])
        for path in feature.get('unmounted_routes', []):
            assert path not in {r.path for r in app.routes}
    for values in [routes, tables, ui, operations]:
        assert len(values) == len(set(values))
    assert not set(tables).intersection(Base.metadata.tables)
    with pytest.raises(RuntimeError, match='collision'):
        install_reserved_routes(app, current_user)
    schema = app.openapi()
    for feature in MANIFEST['features'].values():
        for route in feature['routes']:
            operation = schema['paths'][route['path']][route['method'].lower()]
            assert operation['x-pxster-status'] == 'reserved'
            assert '200' not in operation['responses']
            assert '501' in operation['responses']
