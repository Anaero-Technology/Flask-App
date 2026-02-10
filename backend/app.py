from flask import Flask
from flask_cors import CORS
from flask_sse import sse
from flask_jwt_extended import JWTManager
from sqlalchemy import text
from database.models import db, Device
from device_manager import DeviceManager
from config import Config
import serial.tools.list_ports
import atexit
import threading
import os


app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = Config.SQLALCHEMY_DATABASE_URI
app.config['REDIS_URL'] = Config.REDIS_URL
app.config['JWT_SECRET_KEY'] = Config.JWT_SECRET_KEY
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = Config.JWT_ACCESS_TOKEN_EXPIRES
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = Config.JWT_REFRESH_TOKEN_EXPIRES
app.config['CHIMERA_DEVICE_MODEL'] = Config.CHIMERA_DEVICE_MODEL

CORS(app, supports_credentials=True)
db.init_app(app)
jwt = JWTManager(app)

device_manager = DeviceManager()
DeviceManager.set_app(app)
app.extensions['device_manager'] = device_manager

UPLOADS_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'uploads')
os.makedirs(UPLOADS_DIR, exist_ok=True)
app.config['UPLOADS_DIR'] = UPLOADS_DIR


# Register CLI commands
from utils.cli import register_cli
register_cli(app)


with app.app_context():
    db.create_all()

def auto_connect_devices():
    """Auto-scan and connect to devices on startup until a Chimera is found."""
    import time
    import concurrent.futures

    time.sleep(2)
    chimera_found = False

    def check_port(port_info):
        nonlocal chimera_found

        if 'Bluetooth' in port_info.device or 'Bluetooth' in port_info.description:
            return False

        try:
            connected = device_manager.connect(port_info.device)
            if not connected:
                return False

            device = device_manager.get_device_by_port(port_info.device)
            if device and hasattr(device, 'device_type'):
                if device.device_type in ['chimera', 'chimera-max']:
                    print(f'[AUTO-CONNECT] ✓ Connected to Chimera on {port_info.device}')
                    chimera_found = True
                    return True
                if device.device_type in ['black-box', 'black_box']:
                    print(f'[AUTO-CONNECT] ✓ Connected to BlackBox on {port_info.device}')
                else:
                    print(f'[AUTO-CONNECT] ✓ Connected to {device.device_type} on {port_info.device}')
        except Exception:
            pass

        return False

    while not chimera_found:
        print('[AUTO-CONNECT] Scanning for Chimera device...')

        with app.app_context():
            try:
                ports = list(serial.tools.list_ports.comports())
                max_workers = min(8, len(ports) or 1)
                with concurrent.futures.ThreadPoolExecutor(max_workers=max_workers) as executor:
                    executor.map(check_port, ports)

                if chimera_found:
                    print('[AUTO-CONNECT] Chimera found, stopping scan')
                else:
                    print('[AUTO-CONNECT] No Chimera found, retrying in 5 seconds...')
            except Exception as exc:
                print(f'[AUTO-CONNECT] Error during auto-connect: {exc}')

        if not chimera_found:
            time.sleep(5)

    print('[AUTO-CONNECT] Device scan complete')


auto_connect_thread = threading.Thread(target=auto_connect_devices, daemon=True)
auto_connect_thread.start()


@atexit.register
def on_exit():
    with app.app_context():
        devices = db.session.query(Device).all()
        for device in devices:
            device.connected = False
        db.session.commit()
        db.session.close()


from routes.auth import auth_bp
from routes.users import users_bp
from routes.black_box import black_box_bp
from routes.chimera import chimera_bp
from routes.wifi import wifi_bp
from routes.data import data_bp
from routes.devices_tests import devices_tests_bp
from routes.system import system_bp
from routes.app_settings import app_settings_bp

app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(black_box_bp)
app.register_blueprint(chimera_bp)
app.register_blueprint(wifi_bp)
app.register_blueprint(data_bp)
app.register_blueprint(devices_tests_bp)
app.register_blueprint(system_bp)
app.register_blueprint(app_settings_bp)
app.register_blueprint(sse, url_prefix='/stream')


if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=6000)
