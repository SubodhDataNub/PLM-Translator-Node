"""
DN Translator Flask Application
A modular Flask web application for language translation using Azure Translator API.
"""
import os
from flask import Flask
from flask_caching import Cache
from FLASK_proj.config import config
from FLASK_proj.models import init_db
from FLASK_proj.routes import register_blueprints
from FLASK_proj.utils import get_environment_type

# Initialize cache
cache = Cache()


def create_app(config_name=None):
    """Application factory function"""
    if config_name is None:
        config_name = get_environment_type()
    
    app = Flask(__name__)
    
    # Load configuration
    app.config.from_object(config[config_name])
    
    # Set database URI based on environment
    if config_name == 'production':
        app.config['SQLALCHEMY_DATABASE_URI'] = config[config_name].get_database_url()
    else:
        app.config['SQLALCHEMY_DATABASE_URI'] = config[config_name].get_database_url()
    
    # Configure cache for background job tracking
    app.config['CACHE_TYPE'] = 'SimpleCache'
    app.config['CACHE_DEFAULT_TIMEOUT'] = 3600  # 1 hour
    
    # Initialize extensions
    cache.init_app(app)
    init_db(app)
    
    # Register blueprints
    register_blueprints(app)
    
    return app


# Create the Flask application
app = create_app()

if __name__ == '__main__':
    app.run(debug=True, host='0.0.0.0', port=5000)