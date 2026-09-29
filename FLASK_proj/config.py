"""
Configuration module for DN Translator application.
Handles database connections, environment variables, and app settings.
"""
import os
from urllib.parse import quote_plus
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class Config:
    """Base configuration class"""
    SECRET_KEY = os.environ.get('SECRET_KEY', 'your-secret-key-here')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    JSON_AS_ASCII = False  # Ensure JSON responses support Unicode
    
    # Configure SQLAlchemy engine with proper encoding
    SQLALCHEMY_ENGINE_OPTIONS = {
        'pool_pre_ping': True,
        'pool_recycle': 300,
        'echo': False
    }


class ProductionConfig(Config):
    """Production configuration"""
    DEBUG = False
    
    @staticmethod
    def get_database_url():
        """Get Azure SQL Database URL from environment variables"""
        
        # Check if running on Azure App Service
        is_azure_app_service = os.environ.get('WEBSITE_SITE_NAME') is not None
        
        if is_azure_app_service:
            # Azure App Service - check for connection string
            azure_conn_str = os.environ.get('SQLAZURECONNSTR_DefaultConnection')
            if azure_conn_str:
                return azure_conn_str
        
        # Check if explicit DATABASE_URL is provided
        if os.environ.get('DATABASE_URL'):
            database_url = os.environ.get('DATABASE_URL')
            return database_url
        
        # Check if Azure SQL Database components are provided
        azure_server = os.environ.get('AZURE_SQL_SERVER')
        azure_database = os.environ.get('AZURE_SQL_DATABASE')
        azure_username = os.environ.get('AZURE_SQL_USERNAME')
        azure_password = os.environ.get('AZURE_SQL_PASSWORD')
        
        if all([azure_server, azure_database, azure_username, azure_password]):
            # Build Azure SQL connection string with proper Unicode encoding
            encoded_username = quote_plus(azure_username)
            encoded_password = quote_plus(azure_password)
            return f"mssql+pyodbc://{encoded_username}:{encoded_password}@{azure_server}/{azure_database}?driver=ODBC+Driver+17+for+SQL+Server&Encrypt=yes&TrustServerCertificate=no&Connection+Timeout=30&charset=utf8"
        
        # If no Azure SQL configuration is found, raise an error
        raise ValueError("Azure SQL Database configuration not found. Please set the required environment variables: AZURE_SQL_SERVER, AZURE_SQL_DATABASE, AZURE_SQL_USERNAME, AZURE_SQL_PASSWORD")


class DevelopmentConfig(Config):
    """Development configuration"""
    DEBUG = True
    
    @staticmethod
    def get_database_url():
        """Get database URL for development - supports SQLite and Azure SQL"""
        
        # Check if DATABASE_URL is explicitly provided (including SQLite)
        if os.environ.get('DATABASE_URL'):
            database_url = os.environ.get('DATABASE_URL')
            return database_url
        
        # Check if DATABASE_TYPE is set to sqlite
        if os.environ.get('DATABASE_TYPE', '').lower() == 'sqlite':
            # Use simple relative path for SQLite
            sqlite_path = 'dn_translator.db'
            database_url = f'sqlite:///{sqlite_path}'
            return database_url
        
        # Fall back to Azure SQL configuration
        return ProductionConfig.get_database_url()


class TestingConfig(Config):
    """Testing configuration"""
    TESTING = True
    
    @staticmethod
    def get_database_url():
        """Use SQLite for testing"""
        # Use in-memory SQLite for testing
        return 'sqlite:///:memory:'


# Configuration dictionary
config = {
    'development': DevelopmentConfig,
    'production': ProductionConfig,
    'testing': TestingConfig,
    'default': DevelopmentConfig
}


class AzureTranslatorConfig:
    """Azure Translator API configuration"""
    TRANSLATOR_KEY = os.environ.get("TRANSLATOR_KEY")
    TRANSLATOR_ENDPOINT = os.environ.get("TRANSLATOR_ENDPOINT")
    TRANSLATOR_REGION = os.environ.get("TRANSLATOR_REGION")
    
    @classmethod
    def is_configured(cls):
        """Check if Azure Translator is properly configured"""
        return all([cls.TRANSLATOR_KEY, cls.TRANSLATOR_ENDPOINT, cls.TRANSLATOR_REGION])