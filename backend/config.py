import os
import fcntl
import secrets
from dotenv import load_dotenv
from datetime import timedelta

# Load environment variables from .env file
load_dotenv()

_INSECURE_JWT_DEFAULTS = ('', 'dev-jwt-secret-change-in-production')


def _resolve_jwt_secret():
    """Never run with a known/forgeable JWT signing key.

    If JWT_SECRET_KEY is missing (or still the old insecure default),
    generate one and persist it to backend/.env so sessions survive restarts.
    Deployments that launch gunicorn directly (systemd) never run start.sh,
    so the backend must be able to self-provision the key. Only if .env
    cannot be written do we fall back to a per-process key.
    """
    secret = os.getenv('JWT_SECRET_KEY', '').strip()
    if secret not in _INSECURE_JWT_DEFAULTS:
        return secret

    env_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env')
    try:
        return _persist_jwt_secret(env_path)
    except OSError:
        print(
            "[SECURITY WARNING] JWT_SECRET_KEY is not set and backend/.env "
            "is not writable. Using a temporary random key: all users will "
            "be logged out on every restart. Add a persistent JWT_SECRET_KEY "
            "to backend/.env."
        )
        return secrets.token_hex(32)


def _persist_jwt_secret(env_path):
    """Generate a JWT secret and write it to .env under an exclusive file
    lock, so concurrent workers all end up using the same value."""
    with open(env_path, 'a+') as f:
        fcntl.flock(f, fcntl.LOCK_EX)
        f.seek(0)
        lines = f.read().splitlines()

        # Another worker may have written a key between our env load and
        # taking the lock — reuse it instead of generating a second one.
        for line in lines:
            key, _, value = line.partition('=')
            if key.strip() == 'JWT_SECRET_KEY' and value.strip() not in _INSECURE_JWT_DEFAULTS:
                return value.strip()

        secret = secrets.token_hex(32)
        lines = [l for l in lines if l.partition('=')[0].strip() != 'JWT_SECRET_KEY']
        lines.append(f'JWT_SECRET_KEY={secret}')
        f.seek(0)
        f.truncate()
        f.write('\n'.join(lines) + '\n')
        print("Generated persistent JWT_SECRET_KEY in backend/.env")
        return secret

class Config:
    # Database configuration
    DB_NAME = os.getenv('DB_NAME')
    DB_HOST = os.getenv('DB_HOST')
    DB_PORT = os.getenv('DB_PORT')
    DB_USER = os.getenv('DB_USER')
    DB_PASSWORD = os.getenv('DB_PASSWORD')

    # Format the database URI
    SQLALCHEMY_DATABASE_URI = os.getenv("SQLALCHEMY_DATABASE_URI")

    # Redis configuration for Flask-SSE
    REDIS_HOST = os.getenv('REDIS_HOST', 'localhost')
    REDIS_PORT = os.getenv('REDIS_PORT', '6379')
    REDIS_URL = f"redis://{REDIS_HOST}:{REDIS_PORT}"

    # Other Flask-SQLAlchemy settings
    SQLALCHEMY_TRACK_MODIFICATIONS = False

    # JWT Configuration
    JWT_SECRET_KEY = _resolve_jwt_secret()
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # Device Configuration
    # Device model: 'chimera' or 'chimera-max'
    # Only set for chimera devices
    CHIMERA_DEVICE_MODEL = os.getenv('CHIMERA_DEVICE_MODEL', 'chimera')  # 'chimera' or 'chimera-max'

    # App Branding
    COMPANY_NAME = os.getenv('COMPANY_NAME', 'Anaero Technology')
    LOGO_FILENAME = os.getenv('LOGO_FILENAME', '')  # empty = no custom logo
