from flask import Blueprint, request, jsonify
from flask_jwt_extended import (
    create_access_token,
    create_refresh_token,
    jwt_required,
    get_jwt_identity,
    get_jwt
)
import bcrypt
from database.models import db, User
from utils.auth import log_audit

auth_bp = Blueprint('auth', __name__)


@auth_bp.route('/api/v1/auth/login', methods=['POST'])
def login():
    """
    Authenticate user and return JWT tokens.

    Request body:
        {
            "username": "string",  # Can be username or email
            "password": "string"
        }

    Returns:
        {
            "access_token": "string",
            "refresh_token": "string",
            "user": { user object }
        }
    """
    data = request.get_json()

    if not data:
        return jsonify({"error": "No data provided"}), 400

    username = data.get('username', '').strip()
    password = data.get('password', '')

    if not username or not password:
        return jsonify({"error": "Username and password are required"}), 400

    # Find user by username or email
    user = User.query.filter(
        (User.username == username) | (User.email == username)
    ).first()

    if not user:
        return jsonify({"error": "Invalid credentials"}), 401

    if not user.is_active:
        return jsonify({"error": "Account is deactivated"}), 403

    # Verify password
    if not bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8')):
        return jsonify({"error": "Invalid credentials"}), 401

    # Create tokens (identity must be a string for flask-jwt-extended)
    access_token = create_access_token(identity=str(user.id))
    refresh_token = create_refresh_token(identity=str(user.id))

    log_audit(user.id, 'login', 'user', user.id)

    return jsonify({
        "access_token": access_token,
        "refresh_token": refresh_token,
        "user": user.to_dict()
    })


@auth_bp.route('/api/v1/auth/refresh', methods=['POST'])
@jwt_required(refresh=True)
def refresh():
    """
    Get a new access token using refresh token.

    Headers:
        Authorization: Bearer <refresh_token>

    Returns:
        {
            "access_token": "string"
        }
    """
    user_id = get_jwt_identity()
    user_id = int(user_id) if user_id is not None else None

    # Verify user still exists and is active
    user = User.query.get(user_id)
    if not user:
        return jsonify({"error": "User not found"}), 401

    if not user.is_active:
        return jsonify({"error": "Account is deactivated"}), 403

    access_token = create_access_token(identity=str(user_id))

    return jsonify({
        "access_token": access_token
    })


@auth_bp.route('/api/v1/auth/me', methods=['GET'])
@jwt_required()
def get_current_user():
    """
    Get the current authenticated user's info.

    Headers:
        Authorization: Bearer <access_token>

    Returns:
        { user object }
    """
    user_id = get_jwt_identity()
    user_id = int(user_id) if user_id is not None else None
    user = User.query.get(user_id)

    if not user:
        return jsonify({"error": "User not found"}), 404

    return jsonify(user.to_dict())


@auth_bp.route('/api/v1/auth/verify-password', methods=['POST'])
@jwt_required()
def verify_password():
    """
    Verify the current user's password (for sensitive actions).

    Request body:
        {
            "password": "string"
        }
    """
    user_id = get_jwt_identity()
    user_id = int(user_id) if user_id is not None else None
    user = User.query.get(user_id)

    if not user:
        return jsonify({"error": "User not found"}), 404

    if not user.is_active:
        return jsonify({"error": "Account is deactivated"}), 403

    data = request.get_json()
    password = data.get('password', '') if data else ''

    if not password:
        return jsonify({"error": "Password is required"}), 400

    if not bcrypt.checkpw(password.encode('utf-8'), user.password_hash.encode('utf-8')):
        return jsonify({"error": "Password is incorrect"}), 401

    return jsonify({"valid": True})


@auth_bp.route('/api/v1/auth/change-password', methods=['POST'])
@jwt_required()
def change_password():
    """
    Change the current user's password.

    Request body:
        {
            "current_password": "string",
            "new_password": "string"
        }
    """
    user_id = get_jwt_identity()
    user_id = int(user_id) if user_id is not None else None
    user = User.query.get(user_id)

    if not user:
        return jsonify({"error": "User not found"}), 404

    data = request.get_json()
    current_password = data.get('current_password', '')
    new_password = data.get('new_password', '')

    if not current_password or not new_password:
        return jsonify({"error": "Current password and new password are required"}), 400

    if len(new_password) < 6:
        return jsonify({"error": "Password must be at least 6 characters"}), 400

    # Verify current password
    if not bcrypt.checkpw(current_password.encode('utf-8'), user.password_hash.encode('utf-8')):
        return jsonify({"error": "Current password is incorrect"}), 401

    # Hash and set new password
    password_hash = bcrypt.hashpw(new_password.encode('utf-8'), bcrypt.gensalt())
    user.password_hash = password_hash.decode('utf-8')
    db.session.commit()

    log_audit(user.id, 'change_password', 'user', user.id)

    return jsonify({"message": "Password changed successfully"})


@auth_bp.route('/api/v1/auth/logout', methods=['POST'])
@jwt_required()
def logout():
    """
    Logout the current user.
    Note: With JWT, logout is primarily client-side (discard tokens).
    This endpoint is for logging purposes and potential token blocklisting.
    """
    user_id = get_jwt_identity()
    user_id = int(user_id) if user_id is not None else None
    log_audit(user_id, 'logout', 'user', user_id)

    return jsonify({"message": "Successfully logged out"})
