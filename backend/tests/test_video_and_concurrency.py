from concurrent.futures import ThreadPoolExecutor
import shutil
import subprocess
import threading
import time
import pytest
from pxster.models import engine
from pxster import providers, worker
from test_workflow import setup_post, submit


@pytest.mark.skipif(not shutil.which('ffmpeg'), reason='FFmpeg is installed in the Docker image')
def test_valid_video_for_three_platforms(creator, tmp_path):
    path = tmp_path / 'test.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-f', 'lavfi', '-i', 'color=c=green:s=720x720:d=4', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', str(path)], check=True)
    result = creator.post('/media', files={'file': ('test.mp4', path.read_bytes(), 'video/mp4')})
    assert result.status_code == 201, result.text
    accounts = [creator.post('/accounts/demo/' + p).json()['id'] for p in ['facebook', 'tiktok', 'youtube']]
    payload = {'caption': 'Video workflow test', 'media_id': result.json()['id'], 'account_ids': accounts, 'youtube': {'title': 'Test video', 'privacy': 'private', 'made_for_kids': False}, 'tiktok': {'privacy_level': 'SELF_ONLY', 'consent': True}}
    assert submit(creator, payload).status_code == 201
    for _ in accounts:
        assert worker.run_once()
    post = creator.get('/posts').json()[0]
    assert post['state'] == 'published'
    assert len(post['destinations']) == 3


@pytest.mark.skipif(engine.dialect.name != 'postgresql', reason='Production locking requires PostgreSQL')
def test_concurrent_workers_claim_once(creator, monkeypatch):
    submit(creator, setup_post(creator))
    calls = []
    gate = threading.Barrier(2)
    real = providers.publish
    def slow_publish(*args):
        calls.append(args[1].id)
        time.sleep(0.15)
        return real(*args)
    monkeypatch.setattr(providers, 'publish', slow_publish)
    def run():
        gate.wait(timeout=5)
        return worker.run_once()
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: run(), range(2)))
    assert sorted(results) == [False, True]
    assert len(calls) == 1
    assert creator.get('/posts').json()[0]['state'] == 'published'
