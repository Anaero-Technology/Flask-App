from functools import wraps
from flask import jsonify
from flask_jwt_extended import verify_jwt_in_request, get_jwt_identity

ROLE_HIERARCHY = {
    'admin': 4,
    'operator': 3,
    'technician': 2,
    'viewer': 1
}

VALID_ROLES = list(ROLE_HIERARCHY.keys())


def require_role(allowed_roles):
    """
    Decorator to require specific roles for an endpoint.

    Usage:
        @app.route('/api/v1/admin-only')
        @jwt_required()
        @require_role(['admin'])
        def admin_only():
            ...

    Args:
        allowed_roles: List of role names that can access this endpoint
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user_id = get_jwt_identity()

            # Import here to avoid circular imports
            from database.models import User

            # Ensure user_id is an integer (flask-jwt-extended may return string)
            try:
                user_id = int(user_id) if user_id is not None else None
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid user identity"}), 401

            user = User.query.get(user_id)
            if not user:
                return jsonify({"error": "User not found"}), 401

            if not user.is_active:
                return jsonify({"error": "User account is deactivated"}), 403

            if user.role not in allowed_roles:
                return jsonify({"error": "Insufficient permissions"}), 403

            return fn(*args, **kwargs)
        return wrapper
    return decorator


def require_minimum_role(minimum_role):
    """
    Decorator to require a minimum role level.
    Uses role hierarchy: admin > operator > technician > viewer

    Usage:
        @app.route('/api/v1/operator-or-above')
        @jwt_required()
        @require_minimum_role('operator')
        def operator_or_above():
            ...
    """
    def decorator(fn):
        @wraps(fn)
        def wrapper(*args, **kwargs):
            verify_jwt_in_request()
            user_id = get_jwt_identity()

            from database.models import User

            # Ensure user_id is an integer
            try:
                user_id = int(user_id) if user_id is not None else None
            except (ValueError, TypeError):
                return jsonify({"error": "Invalid user identity"}), 401

            user = User.query.get(user_id)
            if not user:
                return jsonify({"error": "User not found"}), 401

            if not user.is_active:
                return jsonify({"error": "User account is deactivated"}), 403

            user_level = ROLE_HIERARCHY.get(user.role, 0)
            required_level = ROLE_HIERARCHY.get(minimum_role, 0)

            if user_level < required_level:
                return jsonify({"error": "Insufficient permissions"}), 403

            return fn(*args, **kwargs)
        return wrapper
    return decorator


def get_current_user():
    """
    Get the current authenticated user from the JWT token.
    Must be called within a request context after JWT verification.

    Returns:
        User object or None
    """
    from database.models import User

    try:
        user_id = get_jwt_identity()
        if user_id:
            # Ensure user_id is an integer
            user_id = int(user_id)
            return User.query.get(user_id)
    except:
        pass
    return None


def log_audit(user_id, action, target_type=None, target_id=None, details=None):
    """
    Log an audit event.

    Args:
        user_id: ID of the user performing the action
        action: Action name (e.g., 'start_test', 'delete_sample')
        target_type: Type of target (e.g., 'test', 'sample', 'device')
        target_id: ID of the target
        details: Additional details string
    """
    from database.models import db, AuditLog

    try:
        log = AuditLog(
            user_id=user_id,
            action=action,
            target_type=target_type,
            target_id=target_id,
            details=details
        )
        db.session.add(log)
        db.session.commit()
    except Exception as e:
        # Don't let audit logging failures break the main operation
        db.session.rollback()
        print(f"[AUDIT] Failed to log: {e}")
