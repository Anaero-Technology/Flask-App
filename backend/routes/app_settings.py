from flask import Blueprint, request, jsonify, send_file, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity
from database.models import *
from utils.auth import require_role
from werkzeug.utils import secure_filename
import os
import re


app_settings_bp = Blueprint('app_settings', __name__)


def get_uploads_dir():
    return current_app.config['UPLOADS_DIR']


def get_env_file_path():
    backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(backend_dir, '.env')


@app_settings_bp.route('/api/v1/app-settings', methods=['GET'])
def get_app_settings():
    """Get public app settings (company name and logo URL)."""
    try:
        company_name = os.environ.get('COMPANY_NAME', 'Anaero Technology')
        logo_filename = os.environ.get('LOGO_FILENAME', '')

        logo_url = '/api/v1/app-settings/logo' if logo_filename else None

        return jsonify({
            'company_name': company_name,
            'logo_url': logo_url
        })
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app_settings_bp.route('/api/v1/app-settings', methods=['PUT'])
@jwt_required()
@require_role(['admin'])
def update_app_settings():
    """Update company name (admin only)."""
    try:
        data = request.get_json()

        if not data or 'company_name' not in data:
            return jsonify({'error': 'company_name is required'}), 400

        company_name = data['company_name'].strip()
        if not company_name:
            return jsonify({'error': 'company_name cannot be empty'}), 400

        os.environ['COMPANY_NAME'] = company_name

        env_file = get_env_file_path()
        with open(env_file, 'r', encoding='utf-8') as f:
            contents = f.read()

        pattern = r'^COMPANY_NAME=.*$'
        if re.search(pattern, contents, re.MULTILINE):
            contents = re.sub(pattern, f'COMPANY_NAME={company_name}', contents, flags=re.MULTILINE)
        else:
            contents += f'\nCOMPANY_NAME={company_name}'

        with open(env_file, 'w', encoding='utf-8') as f:
            f.write(contents)

        return jsonify({'success': True, 'company_name': company_name})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app_settings_bp.route('/api/v1/app-settings/logo', methods=['POST'])
@jwt_required()
@require_role(['admin'])
def upload_logo():
    """Upload and save logo file (admin only)."""
    try:
        if 'logo' not in request.files:
            return jsonify({'error': 'No logo file provided'}), 400

        file = request.files['logo']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        if file_ext not in allowed_extensions:
            return jsonify({'error': 'Invalid file type. Allowed: PNG, JPG, JPEG, GIF, WebP'}), 400

        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        if file_size > 2 * 1024 * 1024:
            return jsonify({'error': 'File too large. Max 2 MB'}), 400

        uploads_dir = get_uploads_dir()
        old_logo_filename = os.environ.get('LOGO_FILENAME', '')
        if old_logo_filename:
            old_logo_path = os.path.join(uploads_dir, old_logo_filename)
            if os.path.exists(old_logo_path):
                os.remove(old_logo_path)

        filename = secure_filename(file.filename)
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_')
        filename = timestamp + filename

        file_path = os.path.join(uploads_dir, filename)
        file.save(file_path)

        os.environ['LOGO_FILENAME'] = filename

        env_file = get_env_file_path()
        with open(env_file, 'r', encoding='utf-8') as f:
            contents = f.read()

        pattern = r'^LOGO_FILENAME=.*$'
        if re.search(pattern, contents, re.MULTILINE):
            contents = re.sub(pattern, f'LOGO_FILENAME={filename}', contents, flags=re.MULTILINE)
        else:
            contents += f'\nLOGO_FILENAME={filename}'

        with open(env_file, 'w', encoding='utf-8') as f:
            f.write(contents)

        return jsonify({'success': True, 'logo_url': '/api/v1/app-settings/logo'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app_settings_bp.route('/api/v1/app-settings/logo', methods=['GET'])
def get_logo():
    """Serve the uploaded logo file."""
    try:
        logo_filename = os.environ.get('LOGO_FILENAME', '')

        if not logo_filename:
            return jsonify({'error': 'No custom logo set'}), 404

        logo_path = os.path.join(get_uploads_dir(), logo_filename)
        if not os.path.exists(logo_path):
            return jsonify({'error': 'Logo file not found'}), 404

        return send_file(logo_path, mimetype='image/png')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app_settings_bp.route('/api/v1/app-settings/logo', methods=['DELETE'])
@jwt_required()
@require_role(['admin'])
def delete_logo():
    """Remove the uploaded logo file (admin only)."""
    try:
        logo_filename = os.environ.get('LOGO_FILENAME', '')

        if logo_filename:
            logo_path = os.path.join(get_uploads_dir(), logo_filename)
            if os.path.exists(logo_path):
                os.remove(logo_path)

        os.environ['LOGO_FILENAME'] = ''

        env_file = get_env_file_path()
        with open(env_file, 'r', encoding='utf-8') as f:
            contents = f.read()

        pattern = r'^LOGO_FILENAME=.*$'
        if re.search(pattern, contents, re.MULTILINE):
            contents = re.sub(pattern, 'LOGO_FILENAME=', contents, flags=re.MULTILINE)
        else:
            contents += '\nLOGO_FILENAME='

        with open(env_file, 'w', encoding='utf-8') as f:
            f.write(contents)

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app_settings_bp.route('/api/v1/users/<int:user_id>/profile-picture', methods=['POST'])
@jwt_required()
def upload_profile_picture(user_id):
    """Upload profile picture for a user (user self or admin)."""
    try:
        current_user_id = get_jwt_identity()
        current_user_id = int(current_user_id) if current_user_id is not None else None
        current_user = User.query.get(current_user_id)

        if user_id != current_user_id and not (current_user and current_user.role == 'admin'):
            return jsonify({'error': 'Unauthorized'}), 403

        if 'profile_picture' not in request.files:
            return jsonify({'error': 'No profile picture file provided'}), 400

        file = request.files['profile_picture']
        if file.filename == '':
            return jsonify({'error': 'No file selected'}), 400

        allowed_extensions = {'png', 'jpg', 'jpeg', 'gif', 'webp'}
        file_ext = file.filename.rsplit('.', 1)[1].lower() if '.' in file.filename else ''
        if file_ext not in allowed_extensions:
            return jsonify({'error': 'Invalid file type. Allowed: PNG, JPG, JPEG, GIF, WebP'}), 400

        file.seek(0, 2)
        file_size = file.tell()
        file.seek(0)
        if file_size > 2 * 1024 * 1024:
            return jsonify({'error': 'File too large. Max 2 MB'}), 400

        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        uploads_dir = get_uploads_dir()
        if user.profile_picture_filename:
            old_pic_path = os.path.join(uploads_dir, user.profile_picture_filename)
            if os.path.exists(old_pic_path):
                os.remove(old_pic_path)

        filename = secure_filename(file.filename)
        from datetime import datetime
        timestamp = datetime.now().strftime('%Y%m%d_%H%M%S_')
        filename = f'profile_{user_id}_{timestamp}{filename}'

        file_path = os.path.join(uploads_dir, filename)
        file.save(file_path)

        user.profile_picture_filename = filename
        db.session.commit()

        return jsonify({'success': True, 'profile_picture_url': f'/api/v1/users/{user_id}/profile-picture'})
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app_settings_bp.route('/api/v1/users/<int:user_id>/profile-picture', methods=['GET'])
def get_profile_picture(user_id):
    """Serve the profile picture file."""
    try:
        user = User.query.get(user_id)
        if not user or not user.profile_picture_filename:
            return jsonify({'error': 'Profile picture not found'}), 404

        pic_path = os.path.join(get_uploads_dir(), user.profile_picture_filename)
        if not os.path.exists(pic_path):
            return jsonify({'error': 'Profile picture file not found'}), 404

        return send_file(pic_path, mimetype='image/png')
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app_settings_bp.route('/api/v1/users/<int:user_id>/profile-picture', methods=['DELETE'])
@jwt_required()
def delete_profile_picture(user_id):
    """Delete profile picture for a user (user self or admin)."""
    try:
        current_user_id = get_jwt_identity()
        current_user_id = int(current_user_id) if current_user_id is not None else None
        current_user = User.query.get(current_user_id)

        if user_id != current_user_id and not (current_user and current_user.role == 'admin'):
            return jsonify({'error': 'Unauthorized'}), 403

        user = User.query.get(user_id)
        if not user:
            return jsonify({'error': 'User not found'}), 404

        if user.profile_picture_filename:
            pic_path = os.path.join(get_uploads_dir(), user.profile_picture_filename)
            if os.path.exists(pic_path):
                os.remove(pic_path)

        user.profile_picture_filename = None
        db.session.commit()

        return jsonify({'success': True})
    except Exception as e:
        return jsonify({'error': str(e)}), 500
