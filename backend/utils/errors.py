"""Central error handling.

Log full tracebacks server-side and return generic messages to clients so
internals (filesystem paths, SQL errors, stack details) never leak into API
responses.
"""
import logging
import os
from logging.handlers import RotatingFileHandler
from flask import jsonify

logger = logging.getLogger('flaskapp')


def internal_error(exc, message="Internal server error"):
    """Log the exception with traceback and return a generic 500 response.

    Call from an except block: `return internal_error(e)`.
    """
    logger.exception(exc)
    return jsonify({"error": message}), 500


def init_error_handling(app):
    """Attach rotating file logging and a catch-all exception handler."""
    logs_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'logs'
    )
    os.makedirs(logs_dir, exist_ok=True)

    handler = RotatingFileHandler(
        os.path.join(logs_dir, 'app.log'), maxBytes=1_000_000, backupCount=3
    )
    handler.setFormatter(
        logging.Formatter('[%(asctime)s] %(levelname)s %(name)s: %(message)s')
    )

    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    app.logger.addHandler(handler)

    @app.errorhandler(Exception)
    def _unhandled_exception(exc):
        from werkzeug.exceptions import HTTPException
        # Let deliberate aborts (404, 401, ...) pass through untouched
        if isinstance(exc, HTTPException):
            return exc
        logger.exception("Unhandled exception")
        return jsonify({"error": "Internal server error"}), 500
