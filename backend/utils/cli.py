import click
import bcrypt
from flask.cli import with_appcontext


def register_cli(app):
    """Register CLI commands with the Flask app."""

    @app.cli.command('create-admin')
    @click.option('--username', prompt=True, help='Admin username')
    @click.option('--email', prompt=True, help='Admin email')
    @click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True, help='Admin password')
    @with_appcontext
    def create_admin(username, email, password):
        """Create the initial admin user."""
        from database.models import db, User

        # Check if any admin exists - only one admin can be created via CLI
        existing_admin = User.query.filter_by(role='admin').first()
        if existing_admin:
            click.echo(f"Error: An admin user already exists: {existing_admin.username}")
            click.echo("Only one admin can be created via CLI. Use the web interface to manage additional admins.")
            return

        # Check for existing username/email
        existing = User.query.filter(
            (User.username == username) | (User.email == email)
        ).first()
        if existing:
            if existing.username == username:
                click.echo(f"Error: Username '{username}' already exists.")
            else:
                click.echo(f"Error: Email '{email}' already exists.")
            return

        # Validate inputs
        if len(username) < 3:
            click.echo("Error: Username must be at least 3 characters.")
            return

        if len(password) < 6:
            click.echo("Error: Password must be at least 6 characters.")
            return

        if '@' not in email:
            click.echo("Error: Invalid email format.")
            return

        # Hash password and create user
        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())

        admin = User(
            username=username,
            email=email,
            password_hash=password_hash.decode('utf-8'),
            role='admin',
            is_active=True
        )
        db.session.add(admin)
        db.session.commit()

        click.echo(f"Admin user '{username}' created successfully!")

    @app.cli.command('list-users')
    @with_appcontext
    def list_users():
        """List all users."""
        from database.models import User

        users = User.query.all()
        if not users:
            click.echo("No users found.")
            return

        click.echo(f"\n{'ID':<5} {'Username':<20} {'Email':<30} {'Role':<12} {'Active':<8}")
        click.echo("-" * 80)
        for user in users:
            active = "Yes" if user.is_active else "No"
            click.echo(f"{user.id:<5} {user.username:<20} {user.email:<30} {user.role:<12} {active:<8}")

    @app.cli.command('reset-password')
    @click.argument('username')
    @click.option('--password', prompt=True, hide_input=True, confirmation_prompt=True, help='New password')
    @with_appcontext
    def reset_password(username, password):
        """Reset a user's password."""
        from database.models import db, User

        user = User.query.filter_by(username=username).first()
        if not user:
            click.echo(f"Error: User '{username}' not found.")
            return

        if len(password) < 6:
            click.echo("Error: Password must be at least 6 characters.")
            return

        password_hash = bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt())
        user.password_hash = password_hash.decode('utf-8')
        db.session.commit()

        click.echo(f"Password reset for user '{username}'.")
