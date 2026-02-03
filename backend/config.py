import os
from dotenv import load_dotenv
from datetime import timedelta

# Load environment variables from .env file
load_dotenv()

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
    JWT_SECRET_KEY = os.getenv('JWT_SECRET_KEY', 'dev-jwt-secret-change-in-production')
    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=1)
    JWT_REFRESH_TOKEN_EXPIRES = timedelta(days=30)

    # Device Configuration
    # Device model: 'chimera' or 'chimera-max'
    # Only set for chimera devices
    CHIMERA_DEVICE_MODEL = os.getenv('CHIMERA_DEVICE_MODEL', 'chimera')  # 'chimera' or 'chimera-max'

    # App Branding
    COMPANY_NAME = os.getenv('COMPANY_NAME', 'Anaero Technology')
    LOGO_FILENAME = os.getenv('LOGO_FILENAME', '')  # empty = no custom logo
