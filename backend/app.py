from flask import Flask
from flask_cors import CORS
from flask_sse import sse
from flask_jwt_extended import JWTManager
from sqlalchemy import text, inspect
from database.models import db, Device
from device_manager import DeviceManager
from config import Config
import serial.tools.list_ports
import atexit
import threading
import os
import sys


app = Flask(__name__)
app.config['SQLALCHEMY_DATABASE_URI'] = Config.SQLALCHEMY_DATABASE_URI
app.config['REDIS_URL'] = Config.REDIS_URL
app.config['JWT_SECRET_KEY'] = Config.JWT_SECRET_KEY
app.config['JWT_ACCESS_TOKEN_EXPIRES'] = Config.JWT_ACCESS_TOKEN_EXPIRES
app.config['JWT_REFRESH_TOKEN_EXPIRES'] = Config.JWT_REFRESH_TOKEN_EXPIRES
app.config['CHIMERA_DEVICE_MODEL'] = Config.CHIMERA_DEVICE_MODEL

# No supports_credentials: auth is a bearer token in the Authorization
# header, never cookies, so credentialed cross-origin requests must not be
# allowed (any-origin + credentials lets other sites ride a user's session).
CORS(app)

# Requests arrive via the local nginx front door (see scripts/setup_https.sh),
# so trust exactly one X-Forwarded-For/-Proto hop — otherwise the login rate
# limiter keys every client as 127.0.0.1.
from werkzeug.middleware.proxy_fix import ProxyFix
app.wsgi_app = ProxyFix(app.wsgi_app, x_for=1, x_proto=1)
db.init_app(app)
jwt = JWTManager(app)

from utils.errors import init_error_handling
init_error_handling(app)

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

    # Lightweight schema patching for deployments without alembic migrations.
    try:
        inspector = inspect(db.engine)
        migration_statements = []

        if inspector.has_table('samples'):
            existing_columns = {column['name'] for column in inspector.get_columns('samples')}
            dialect_name = db.engine.dialect.name
            binary_type = 'BYTEA' if dialect_name == 'postgresql' else 'BLOB'

            if 'sample_image_data' not in existing_columns:
                migration_statements.append(f"ALTER TABLE samples ADD COLUMN sample_image_data {binary_type}")
            if 'sample_image_mime_type' not in existing_columns:
                migration_statements.append("ALTER TABLE samples ADD COLUMN sample_image_mime_type VARCHAR(100)")
            if 'sample_image_filename' not in existing_columns:
                migration_statements.append("ALTER TABLE samples ADD COLUMN sample_image_filename VARCHAR(255)")

        if inspector.has_table('users'):
            user_columns = {column['name'] for column in inspector.get_columns('users')}
            if 'time_display' not in user_columns:
                migration_statements.append("ALTER TABLE users ADD COLUMN time_display VARCHAR(5) NOT NULL DEFAULT 'local'")
            if 'export_header_language' not in user_columns:
                migration_statements.append("ALTER TABLE users ADD COLUMN export_header_language VARCHAR(5) NOT NULL DEFAULT 'en'")

        if inspector.has_table('chimera_configurations'):
            chimera_config_columns = {column['name'] for column in inspector.get_columns('chimera_configurations')}
            if 'recirculation_duration_seconds' not in chimera_config_columns:
                migration_statements.append("ALTER TABLE chimera_configurations ADD COLUMN recirculation_duration_seconds INTEGER")

        # The first cut of automation rules held a single condition inline on
        # the rule. Conditions now live in their own table so a rule can
        # combine several with AND/OR, which no ALTER can express. The feature
        # has never shipped, so the old-shape tables are rebuilt rather than
        # migrated - detected by the source_type column that moved away.
        if inspector.has_table('automation_rules'):
            rule_columns = {column['name'] for column in inspector.get_columns('automation_rules')}
            if 'source_type' in rule_columns:
                with db.engine.begin() as connection:
                    connection.execute(text("DROP TABLE IF EXISTS automation_events"))
                    connection.execute(text("DROP TABLE IF EXISTS automation_conditions"))
                    connection.execute(text("DROP TABLE IF EXISTS automation_rules"))
                db.create_all()
                print("[DB MIGRATION] Rebuilt automation tables for multi-condition rules")

        if migration_statements:
            with db.engine.begin() as connection:
                for statement in migration_statements:
                    connection.execute(text(statement))
    except Exception as exc:
        print(f"[DB MIGRATION] Failed to patch schema: {exc}")

def auto_connect_sweep(manager, ports, port_state, probe_attempts=5):
    """One scan pass. Mutates port_state; returns nothing.

    port_state maps a port path to either 'connected' or the number of probe
    attempts still allowed. The rules keep it from touching live connections or
    hammering unrelated serial ports:

      - an already-connected port is marked and skipped (never re-probed, so a
        working device is never disturbed)
      - a port reserved for flashing is left alone
      - a port that never identifies is probed a few times then dropped until it
        re-enumerates
      - a port that drops from connected is retried
      - a vanished port is forgotten, so re-plugging starts fresh
    """
    def is_bluetooth(p):
        return 'Bluetooth' in p.device or 'Bluetooth' in (p.description or '')

    visible = [p for p in ports if not is_bluetooth(p)]
    current = {p.device for p in visible}

    for gone in set(port_state) - current:
        del port_state[gone]

    for p in visible:
        dev = p.device
        if dev in manager._reserved_ports:
            continue                              # held for flashing - hands off
        if manager.is_port_connected(dev):
            port_state[dev] = 'connected'         # live device - do not disturb
            continue
        if port_state.get(dev) == 'connected':
            port_state[dev] = probe_attempts      # was connected, dropped - re-probe
        attempts = port_state.get(dev, probe_attempts)   # new port -> full attempts
        if attempts <= 0:
            continue                              # gave up until it re-enumerates

        connected = False
        try:
            if manager.connect(dev):
                device = manager.get_device_by_port(dev)
                dtype = getattr(device, 'device_type', 'device') if device else 'device'
                print(f'[AUTO-CONNECT] ✓ Connected to {dtype} on {dev}')
                connected = True
        except Exception:
            pass
        port_state[dev] = 'connected' if connected else attempts - 1


def auto_connect_devices():
    """Continuously scan serial ports and connect Anaero devices as they appear.

    This must never stop: the Pi's Chimera is on the hardware UART and comes up
    first, but a BlackBox or PLC can be hot-plugged on USB seconds or hours
    later, so a loop that exited once the Chimera was found would never see them
    (which is exactly what happened - the USB PLC enumerated after the first
    sweep and was never probed again).

    To keep scanning cheaply without hammering unrelated serial ports, probing is
    edge-triggered: a port is only tried when it first appears, until it either
    connects or a few attempts fail. A device that is already connected is
    skipped, a port that never identifies is left alone until it re-enumerates,
    and a port reserved for flashing is not touched.
    """
    import time

    time.sleep(2)

    # Reset stale connected flags from a previous run (atexit may not have run).
    with app.app_context():
        Device.query.update({Device.connected: False})
        db.session.commit()

    port_state = {}             # port path -> 'connected' or attempts remaining
    delay = 3
    while True:
        with app.app_context():
            try:
                ports = list(serial.tools.list_ports.comports())
                auto_connect_sweep(device_manager, ports, port_state)
            except Exception as exc:
                print(f'[AUTO-CONNECT] Error during scan: {exc}')

        time.sleep(delay)
        delay = min(delay * 2, 10)   # ramp to a steady ~10s sweep, then hold - forever


def _should_start_auto_connect():
    """Skip startup auto-connect for Flask CLI utility commands."""
    if os.environ.get("DISABLE_AUTO_CONNECT") == "1":
        return False

    argv = [arg.lower() for arg in sys.argv]
    executable = os.path.basename(argv[0]) if argv else ""

    # For `flask <command>` usage, only allow `flask run` to auto-connect.
    if executable == "flask" and len(argv) > 1 and argv[1] != "run":
        return False

    return True


if _should_start_auto_connect():
    auto_connect_thread = threading.Thread(target=auto_connect_devices, daemon=True)
    auto_connect_thread.start()

    # Closed-loop experiment automation shares the auto-connect gate: it acts
    # on hardware, so utility commands must never start it, and the single
    # gunicorn worker (-w 1) means exactly one engine runs.
    from automation_engine import AutomationEngine
    AutomationEngine().start(app)

    # Only the real server process may mark devices disconnected on exit.
    # Utility scripts and CLI commands also import this module, and an
    # unconditional atexit hook made every one of them clobber the connected
    # flags of the still-running server's devices when they exited.
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
from routes.plc import plc_bp
from routes.wifi import wifi_bp
from routes.network import network_bp
from routes.data import data_bp
from routes.devices_tests import devices_tests_bp
from routes.system import system_bp
from routes.app_settings import app_settings_bp
from routes.automation import automation_bp

app.register_blueprint(auth_bp)
app.register_blueprint(users_bp)
app.register_blueprint(black_box_bp)
app.register_blueprint(chimera_bp)
app.register_blueprint(plc_bp)
app.register_blueprint(wifi_bp)
app.register_blueprint(network_bp)
app.register_blueprint(data_bp)
app.register_blueprint(devices_tests_bp)
app.register_blueprint(system_bp)
app.register_blueprint(app_settings_bp)
app.register_blueprint(automation_bp)

from utils.auth import check_stream_token


@sse.before_request
def _require_stream_token():
    # EventSource cannot send Authorization headers; streams authenticate
    # with a short-lived ?token= issued by /api/v1/auth/stream-token.
    return check_stream_token()


app.register_blueprint(sse, url_prefix='/stream')


if __name__ == '__main__':
    # Werkzeug's debugger allows remote code execution — never enable it
    # implicitly on a network-reachable interface.
    debug = os.environ.get('FLASK_DEBUG') == '1'
    app.run(debug=debug, host='0.0.0.0', port=6000)
