"""
Routes package for DN Translator application.
Contains Blueprint definitions for different route groups.
"""
from .main import main_bp
from .api import api_bp

def register_blueprints(app):
    """Register all blueprints with the Flask app"""
    app.register_blueprint(main_bp)
    app.register_blueprint(api_bp, url_prefix='/api')