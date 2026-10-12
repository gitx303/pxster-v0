"""Run a local demo with isolated demo accounts; no live publishing credentials."""
import os
from pathlib import Path
import signal
import subprocess
import sys
import time

ROOT = Path(__file__).resolve().parents[1]
os.chdir(ROOT)
(ROOT / "data").mkdir(exist_ok=True)
env = os.environ.copy()
env.update(ENVIRONMENT="development", DEMO_MODE="true", ALLOW_REGISTRATION="true", STORAGE_DRIVER="local", DATABASE_URL="sqlite:///./data/pxster.db", APP_ORIGIN="http://localhost:5173", API_URL="http://localhost:8017", MEDIA_URL="", PYTHONPATH=str(ROOT / "backend"))
for prefix in ["FACEBOOK", "TIKTOK", "GOOGLE"]:
    env.pop(f"{prefix}_CLIENT_ID", None)
    env.pop(f"{prefix}_CLIENT_SECRET", None)
subprocess.run([sys.executable, "-m", "alembic", "-c", "backend/alembic.ini", "upgrade", "head"], env=env, check=True)
commands = [
    [sys.executable, "-m", "uvicorn", "pxster.api:app", "--host", "127.0.0.1", "--port", "8017", "--no-access-log"],
    [sys.executable, "-m", "pxster.worker"],
    [sys.executable, "-m", "http.server", "5173", "--bind", "127.0.0.1", "--directory", "app/public"],
    [sys.executable, "-m", "http.server", "5174", "--bind", "127.0.0.1", "--directory", "landing/public"],
]
processes = []


def stop(*_):
    raise KeyboardInterrupt


signal.signal(signal.SIGTERM, stop)
signal.signal(signal.SIGINT, stop)
try:
    for command in commands:
        processes.append(subprocess.Popen(command, env=env))
    print("\nPxster app: http://localhost:5173\nLanding: http://localhost:5174\nAPI docs: http://localhost:8017/docs\nDemo only. Create an account in the sign-in dialog, then add demo channels.\n", flush=True)
    while all(p.poll() is None for p in processes):
        time.sleep(1)
except KeyboardInterrupt:
    pass
finally:
    for process in processes:
        if process.poll() is None:
            process.terminate()
    for process in processes:
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
