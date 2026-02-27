from flask import Blueprint, request, jsonify, send_file, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from sqlalchemy.engine import make_url
from database.models import *
from utils.auth import require_role
import os


system_bp = Blueprint('system', __name__)

@system_bp.route("/api/v1/system/serial-log", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def download_serial_log():
    """Download the serial communication log file"""
    from flask import send_file
    from utils.serial_logger import serial_logger
    import io

    try:
        if not serial_logger.log_exists():
            return jsonify({"error": "No serial log data available"}), 404

        return send_file(
            serial_logger.log_file_path,
            mimetype='text/plain',
            as_attachment=True,
            download_name='serial_messages.log'
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@system_bp.route("/api/v1/system/serial-log", methods=['DELETE'])
@jwt_required()
@require_role(['admin'])
def clear_serial_log():
    """Clear the serial communication log file"""
    from utils.serial_logger import serial_logger

    try:
        success = serial_logger.clear_log()
        if success:
            return jsonify({"success": True, "message": "Serial log cleared"}), 200
        else:
            return jsonify({"error": "Failed to clear serial log"}), 500
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@system_bp.route("/api/v1/system/serial-log/info", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def serial_log_info():
    """Get information about the serial log file"""
    from utils.serial_logger import serial_logger

    try:
        size_bytes = serial_logger.get_log_size()
        # Convert to human-readable format
        if size_bytes < 1024:
            size_str = f"{size_bytes} B"
        elif size_bytes < 1024 * 1024:
            size_str = f"{size_bytes / 1024:.1f} KB"
        else:
            size_str = f"{size_bytes / (1024 * 1024):.1f} MB"

        return jsonify({
            "exists": serial_logger.log_exists(),
            "size_bytes": size_bytes,
            "size_formatted": size_str,
            "enabled": serial_logger.enabled
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


def get_sqlite_db_path():
    uri = current_app.config.get("SQLALCHEMY_DATABASE_URI")

    try:
        url = make_url(uri) if uri else db.engine.url
    except Exception:
        return None, "Invalid database URI"

    if url.get_backend_name() != "sqlite":
        return None, "Database download/transfer is only supported for SQLite"

    db_path = url.database
    if not db_path or db_path == ":memory:":
        return None, "SQLite database file is not available"

    if not os.path.isabs(db_path):
        # Flask resolves relative SQLite paths against the instance folder
        db_path = os.path.abspath(os.path.join(current_app.instance_path, db_path))

    return db_path, None


@system_bp.route("/api/v1/system/database/download", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def download_database():
    """Download the SQLite database file (admin only)."""
    try:
        db_path, error = get_sqlite_db_path()
        if error:
            return jsonify({"error": error}), 400
        if not os.path.exists(db_path):
            return jsonify({"error": "Database file not found"}), 404

        return send_file(
            db_path,
            mimetype='application/octet-stream',
            as_attachment=True,
            download_name=os.path.basename(db_path)
        )
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@system_bp.route("/api/v1/system/database/transfer", methods=['POST'])
@jwt_required()
@require_role(['admin'])
def transfer_database():
    """Replace the SQLite database file with an uploaded one (admin only)."""
    from datetime import datetime
    import tempfile

    try:
        confirm = request.form.get('confirm')
        if confirm != 'TRANSFER':
            return jsonify({"error": "Confirmation required"}), 400

        upload = request.files.get('database')
        if not upload or not upload.filename:
            return jsonify({"error": "No database file provided"}), 400

        db_path, error = get_sqlite_db_path()
        if error:
            return jsonify({"error": error}), 400

        os.makedirs(os.path.dirname(db_path), exist_ok=True)

        temp_fd, temp_path = tempfile.mkstemp(suffix='.sqlite', dir=os.path.dirname(db_path))
        with os.fdopen(temp_fd, 'wb') as temp_file:
            upload.save(temp_file)

        with open(temp_path, 'rb') as temp_file:
            header = temp_file.read(16)
            if header != b'SQLite format 3\x00':
                os.remove(temp_path)
                return jsonify({"error": "Uploaded file is not a valid SQLite database"}), 400

        db.session.remove()
        db.engine.dispose()

        backup_path = None
        if os.path.exists(db_path):
            timestamp = datetime.utcnow().strftime('%Y%m%d%H%M%S')
            backup_path = f"{db_path}.bak-{timestamp}"
            os.replace(db_path, backup_path)

        os.replace(temp_path, db_path)

        return jsonify({
            "success": True,
            "message": "Database transferred successfully",
            "backup_path": backup_path
        }), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


@system_bp.route("/api/v1/system/database", methods=['DELETE'])
@jwt_required()
@require_role(['admin'])
def delete_database():
    """Delete all database data but preserve admin users (admin only)."""
    try:
        data = request.get_json(silent=True) or {}
        if data.get('confirm') != 'DELETE':
            return jsonify({"error": "Confirmation required"}), 400

        admin_users = User.query.filter_by(role='admin').all()
        admin_ids = {admin.id for admin in admin_users}
        preserved_admins = []

        for admin in admin_users:
            preserved_admins.append({
                "id": admin.id,
                "username": admin.username,
                "email": admin.email,
                "password_hash": admin.password_hash,
                "role": admin.role,
                "is_active": admin.is_active,
                "created_at": admin.created_at,
                "created_by": admin.created_by if admin.created_by in admin_ids else None,
                "csv_delimiter": admin.csv_delimiter,
                "language": admin.language,
                "profile_picture_filename": admin.profile_picture_filename,
            })

        db.session.remove()
        db.drop_all()
        db.create_all()

        for admin_data in preserved_admins:
            admin = User(
                username=admin_data["username"],
                email=admin_data["email"],
                password_hash=admin_data["password_hash"],
                role=admin_data["role"],
                is_active=admin_data["is_active"],
                created_at=admin_data["created_at"],
                created_by=admin_data["created_by"],
                csv_delimiter=admin_data["csv_delimiter"],
                language=admin_data["language"],
                profile_picture_filename=admin_data["profile_picture_filename"],
            )
            admin.id = admin_data["id"]
            db.session.add(admin)

        db.session.commit()

        return jsonify({
            "success": True,
            "message": f"Database cleared. Preserved {len(preserved_admins)} admin user(s)."
        }), 200
    except Exception as e:
        db.session.rollback()
        return jsonify({"error": str(e)}), 500


@system_bp.route("/api/v1/system/git-pull", methods=['POST'])
@jwt_required()
@require_role(['admin'])
def git_pull():
    """Safely update software from GitHub with dependency sync and rollback."""
    import subprocess
    import os

    def tail_text(value, max_lines=40):
        lines = [line for line in (value or '').splitlines() if line.strip()]
        if not lines:
            return ""
        return "\n".join(lines[-max_lines:])

    try:
        running_tests = Test.query.filter_by(status='running').count()
        if running_tests > 0:
            return jsonify({
                "success": False,
                "error": "Cannot update while tests are running. Stop all running tests first."
            }), 409

        # Parent of backend/
        project_root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        updater_script = os.path.join(project_root, 'backend', 'scripts', 'safe_git_update.sh')

        if not os.path.isfile(updater_script):
            return jsonify({
                "success": False,
                "error": "Updater script not found"
            }), 500

        if not os.access(updater_script, os.X_OK):
            return jsonify({
                "success": False,
                "error": "Updater script is not executable"
            }), 500

        result = subprocess.run(
            [updater_script],
            cwd=project_root,
            capture_output=True,
            text=True,
            timeout=1800
        )

        if result.returncode == 0:
            output = tail_text(result.stdout)
            return jsonify({
                "success": True,
                "message": output or "Update completed. Please reboot after update for a stable run."
            }), 200

        output = tail_text(result.stdout)
        error = tail_text(result.stderr)
        details = error or output or "Software update failed"

        if result.returncode == 42:
            return jsonify({
                "success": False,
                "error": "Another update is already running."
            }), 409

        if result.returncode == 3:
            return jsonify({
                "success": False,
                "error": "Cannot update because local tracked changes exist in this installation."
            }), 409

        return jsonify({
                "success": False,
                "error": details
            }), 500

    except subprocess.TimeoutExpired:
        return jsonify({
            "success": False,
            "error": "Software update timed out"
        }), 500
    except Exception as e:
        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@system_bp.route("/api/v1/audit-logs", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def get_audit_logs():
    """
    Get audit logs (admin only).

    Query parameters:
        - limit: Max number of logs to return (default: 100)
        - offset: Number of logs to skip (default: 0)

    Returns:
        {
            "total": int,
            "logs": [
                {
                    "id": int,
                    "user_id": int,
                    "username": string,
                    "action": string,
                    "target_type": string,
                    "target_id": int,
                    "details": string,
                    "timestamp": ISO datetime string
                },
                ...
            ]
        }
    """
    try:
        limit = request.args.get('limit', 100, type=int)
        offset = request.args.get('offset', 0, type=int)

        # Validate pagination parameters
        limit = max(1, min(limit, 1000))  # Cap at 1000
        offset = max(0, offset)

        # Get total count
        total = AuditLog.query.count()

        # Get paginated logs with user info
        logs = db.session.query(AuditLog, User.username).outerjoin(
            User, AuditLog.user_id == User.id
        ).order_by(AuditLog.timestamp.desc()).limit(limit).offset(offset).all()

        logs_data = []
        for log, username in logs:
            logs_data.append({
                'id': log.id,
                'user_id': log.user_id,
                'username': username,
                'action': log.action,
                'target_type': log.target_type,
                'target_id': log.target_id,
                'details': log.details,
                'timestamp': log.timestamp.isoformat() if log.timestamp else None
            })

        return jsonify({
            'total': total,
            'logs': logs_data
        })

    except Exception as e:
        return jsonify({"error": str(e)}), 500


@system_bp.route("/api/v1/audit-logs/download", methods=['GET'])
@jwt_required()
@require_role(['admin'])
def download_audit_logs():
    """
    Download audit logs as CSV (admin only).

    Query parameters:
        - action: Filter by action type (optional)
        - target_type: Filter by target type (optional)
        - user_id: Filter by user ID (optional)

    Returns: CSV file
    """
    try:
        import io
        import csv
        from datetime import datetime
        from flask import send_file

        # Get filters from query parameters
        action_filter = request.args.get('action', None)
        target_type_filter = request.args.get('target_type', None)
        user_id_filter = request.args.get('user_id', None, type=int)

        # Build query
        query = db.session.query(AuditLog, User.username).outerjoin(
            User, AuditLog.user_id == User.id
        )

        # Apply filters
        if action_filter:
            query = query.filter(AuditLog.action == action_filter)
        if target_type_filter:
            query = query.filter(AuditLog.target_type == target_type_filter)
        if user_id_filter:
            query = query.filter(AuditLog.user_id == user_id_filter)

        # Order by timestamp descending
        logs = query.order_by(AuditLog.timestamp.desc()).all()

        if not logs:
            return jsonify({"error": "No audit logs found"}), 404

        # Get current user's CSV delimiter preference
        current_user_id = get_jwt_identity()
        user = User.query.get(current_user_id)
        csv_delimiter = user.csv_delimiter if user else ','

        # Create CSV
        csv_headers = [
            'Timestamp', 'User ID', 'Username', 'Action', 'Target Type',
            'Target ID', 'Details'
        ]

        output = io.StringIO()
        writer = csv.writer(output, delimiter=csv_delimiter)
        writer.writerow(csv_headers)

        for log, username in logs:
            writer.writerow([
                log.timestamp.isoformat() if log.timestamp else '',
                log.user_id or '',
                username or 'Unknown',
                log.action or '',
                log.target_type or '',
                log.target_id or '',
                log.details or ''
            ])

        # Create filename with timestamp
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
        filename = f"audit_logs_{timestamp}.csv"

        return send_file(
            io.BytesIO(output.getvalue().encode()),
            mimetype='text/csv',
            as_attachment=True,
            download_name=filename
        )

    except Exception as e:
        return jsonify({"error": str(e)}), 500
