import os
import secrets
from dotenv import load_dotenv
from datetime import timedelta

# Load environment variables from .env file
load_dotenv()

_INSECURE_JWT_DEFAULTS = ('', 'dev-jwt-secret-change-in-production')


def _resolve_jwt_secret():
    """Never run with a known/forgeable JWT signing key.

    If JWT_SECRET_KEY is missing (or still the old insecure default), fall
    back to a random per-process secret so tokens cannot be forged. Existing
    sessions are invalidated on each restart until a persistent key is set
    in .env (start.sh generates one automatically).
    """
    secret = os.getenv('JWT_SECRET_KEY', '').strip()
    if secret in _INSECURE_JWT_DEFAULTS:
        print(
            "[SECURITY WARNING] JWT_SECRET_KEY is not set in .env. "
            "Using a temporary random key: all users will be logged out on every "
            "restart. Add a persistent JWT_SECRET_KEY to backend/.env "
            "(re-run start.sh to generate one)."
        )
        return secrets.token_hex(32)
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
