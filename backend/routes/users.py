from flask import Blueprint, request, jsonify
from flask_jwt_extended import jwt_required, get_jwt_identity
import bcrypt
from database.models import db, User
from utils.auth import require_role, log_audit, VALID_ROLES

users_bp = Blueprint('users', __name__)


@users_bp.route('/api/v1/users', methods=['GET'])
@jwt_required()
@require_role(['admin'])
def list_users():
    """
    List all users (admin only).

    Returns:
        [{ user object }, ...]
    """
    users = User.query.order_by(User.created_at.desc()).all()
    return jsonify([user.to_dict() for user in users])


@users_bp.route('/api/v1/users/<int:user_id>', methods=['GET'])
@jwt_required()
@require_role(['admin'])
def get_user(user_id):
    """
    Get a specific user by ID (admin only).
    """
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify(user.to_dict())


@users_bp.route('/api/v1/users', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def create_user():
    """
    Create a new user (admin only).

    Request body:
        {
            "username": "string",
            "email": "string",
            "password": "string",
            "role": "string"  // admin, operator, technician, viewer
        }
    """
    current_user_id = get_jwt_identity()
    current_user_id = int(current_user_id) if current_user_id is not None else None
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    username = data.get('username', '').strip()
    email = data.get('email', '').strip().lower()
    password = data.get('password', '')
    role = data.get('role', 'viewer')

    # Validation
    if not username or not email or not password:
        return jsonify({"error": "Username, email, and password are required"}), 400

    if len(username) < 3:
        return jsonify({"error": "Username must be at least 3 characters"}), 400

    if len(password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    if '@' not in email:
        return jsonify({"error": "Invalid email format"}), 400

    if role not in VALID_ROLES:
        return jsonify({"error": f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}"}), 400

    # Check for existing user
    existing = User.query.filter(
        (User.username == username) | (User.email == email)
    ).first()
    if existing:
        if existing.username == username:
            return jsonify({"error": "Username already exists"}), 409
        else:
            return jsonify({"error": "Email already exists"}), 409

    # Hash password
    password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

    # Create user
    user = User(
        username=username,
        email=email,
        password_hash=password_hash.decode('utf-8'),
        role=role,
        created_by=current_user_id
    )
    db.session.add(user)
    db.session.commit()

    log_audit(current_user_id, 'create_user', 'user', user.id, f"Created user: {username}")

    return jsonify(user.to_dict()), 201


@users_bp.route('/api/v1/users/<int:user_id>', methods=['PUT'])
@jwt_required()
@require_role(['admin'])
def update_user(user_id):
    """
    Update a user (admin only).
    Can update: username, email, role, is_active

    Request body:
        {
            "username": "string",
            "email": "string",
            "role": "string",
            "is_active": boolean
        }
    """
    current_user_id = get_jwt_identity()
    current_user_id = int(current_user_id) if current_user_id is not None else None
    user = User.query.get(user_id)

    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    if not data:
        return jsonify({"error": "No data provided"}), 400

    # Prevent admin from deactivating themselves
    if user_id == current_user_id and data.get('is_active') is False:
        return jsonify({"error": "Cannot deactivate your own account"}), 400

    # Prevent admin from demoting themselves
    if user_id == current_user_id and data.get('role') and data.get('role') != 'admin':
        return jsonify({"error": "Cannot change your own role"}), 400

    # Update fields
    if 'username' in data:
        username = data['username'].strip()
        if len(username) < 3:
            return jsonify({"error": "Username must be at least 3 characters"}), 400
        # Check uniqueness
        existing = User.query.filter(User.username == username, User.id != user_id).first()
        if existing:
            return jsonify({"error": "Username already exists"}), 409
        user.username = username

    if 'email' in data:
        email = data['email'].strip().lower()
        if '@' not in email:
            return jsonify({"error": "Invalid email format"}), 400
        existing = User.query.filter(User.email == email, User.id != user_id).first()
        if existing:
            return jsonify({"error": "Email already exists"}), 409
        user.email = email

    if 'role' in data:
        role = data['role']
        if role not in VALID_ROLES:
            return jsonify({"error": f"Invalid role. Must be one of: {', '.join(VALID_ROLES)}"}), 400
        user.role = role

    if 'is_active' in data:
        user.is_active = bool(data['is_active'])

    db.session.commit()

    log_audit(current_user_id, 'update_user', 'user', user_id, f"Updated user: {user.username}")

    return jsonify(user.to_dict())


@users_bp.route('/api/v1/users/<int:user_id>/reset-password', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def reset_user_password(user_id):
    """
    Reset a user's password (admin only).

    Request body:
        {
            "new_password": "string"
        }
    """
    current_user_id = get_jwt_identity()
    current_user_id = int(current_user_id) if current_user_id is not None else None
    user = User.query.get(user_id)

    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    new_password = data.get('new_password', '')

    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt())
    user.password_hash = password_hash.decode('utf-8')
    db.session.commit()

    log_audit(current_user_id, 'reset_password', 'user', user_id, f"Reset password for: {user.username}")

    return jsonify({"message": f"Password reset for user {user.username}"})


@users_bp.route('/api/v1/users/<int:user_id>', methods=['DELETE'])
@jwt_required()
@require_role(['admin'])
def delete_user(user_id):
    """
    Deactivate a user (admin only).
    Users are soft-deleted (deactivated) rather than removed.
    """
    current_user_id = get_jwt_identity()
    current_user_id = int(current_user_id) if current_user_id is not None else None

    if user_id == current_user_id:
        return jsonify({"error": "Cannot delete your own account"}), 400

    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 404

    user.is_active = False
    db.session.commit()

    log_audit(current_user_id, 'deactivate_user', 'user', user_id, f"Deactivated user: {user.username}")

    return jsonify({"message": f"User {user.username} has been deactivated"})


@users_bp.route('/api/v1/roles', methods=['GET'])
@jwt_required()
@require_role(['admin'])
def list_roles():
    """
    List available roles (admin only).
    """
    roles = [
        {"id": "admin", "name": "Admin", "description": "Full access to all features including user management"},
        {"id": "operator", "name": "Operator", "description": "Can start/stop tests, create samples, manage devices"},
        {"id": "technician", "name": "Technician", "description": "Can start/stop tests and view data"},
        {"id": "viewer", "name": "Viewer", "description": "Read-only access to tests and data"}
    ]
    return jsonify(roles)
