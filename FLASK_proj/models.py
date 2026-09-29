"""
Database models for DN Translator application.
Contains SQLAlchemy models and database schemas.
"""
from datetime import datetime, timezone
from flask_sqlalchemy import SQLAlchemy
from sqlalchemy import Text, NVARCHAR

# Initialize SQLAlchemy
db = SQLAlchemy()


class TestResult(db.Model):
    """Model for storing translation test results"""
    __tablename__ = 'test_results'
    
    id = db.Column(db.Integer, primary_key=True)
    outcome = db.Column(db.String(50), nullable=False)  # Success/Failed
    accuracy = db.Column(db.Float, nullable=False)  # Percentage accuracy (required)
    observation = db.Column(Text().with_variant(NVARCHAR(None), 'mssql'), nullable=True)  # User observations with Unicode support
    tested_by = db.Column(db.String(100), nullable=True)  # Who tested it
    text_to_translate = db.Column(Text().with_variant(NVARCHAR(None), 'mssql'), nullable=True)  # Original text with Unicode support
    translated_text = db.Column(Text().with_variant(NVARCHAR(None), 'mssql'), nullable=True)  # Translated text with Unicode support
    source_language = db.Column(db.String(50), nullable=True)  # Source language code
    target_language = db.Column(db.String(50), nullable=True)  # Target language code
    session_id = db.Column(db.String(100), nullable=True)  # Session identifier
    created_at = db.Column(db.DateTime, default=lambda: datetime.now(timezone.utc))  # When created
    
    def to_dict(self):
        """Convert model to dictionary for JSON serialization"""
        return {
            'id': self.id,
            'outcome': self.outcome,
            'accuracy': self.accuracy,
            'observation': self.observation,
            'tested_by': self.tested_by,
            'text_to_translate': self.text_to_translate,
            'translated_text': self.translated_text,
            'source_language': self.source_language,
            'target_language': self.target_language,
            'session_id': self.session_id,
            'created_at': self.created_at.isoformat() if self.created_at else None
        }
    
    def __repr__(self):
        return f'<TestResult {self.id}: {self.outcome}>'


def init_db(app):
    """Initialize database with app context"""
    db.init_app(app)
    
    with app.app_context():
        try:
            # First, try to update existing tables for Unicode (for SQL Server)
            update_database_for_unicode(app)
            
            # Create tables (this will create new ones or skip existing)
            db.create_all()
        except Exception as e:
            # Still try to create tables
            db.create_all()


def update_database_for_unicode(app):
    """Update existing database columns to support Unicode properly"""
    try:
        # Check if we're using SQL Server/Azure SQL
        if 'mssql' in app.config['SQLALCHEMY_DATABASE_URI']:
            
            # Execute raw SQL to alter columns for Unicode support
            with db.engine.connect() as conn:
                # Start a transaction
                trans = conn.begin()
                try:
                    # Check if table exists and has data
                    result = conn.execute(db.text("SELECT COUNT(*) as count FROM test_results")).fetchone()
                    if result and result[0] > 0:
                        # Alter columns to NVARCHAR for Unicode support
                        conn.execute(db.text("ALTER TABLE test_results ALTER COLUMN observation NVARCHAR(MAX)"))
                        conn.execute(db.text("ALTER TABLE test_results ALTER COLUMN text_to_translate NVARCHAR(MAX)"))
                        conn.execute(db.text("ALTER TABLE test_results ALTER COLUMN translated_text NVARCHAR(MAX)"))
                    
                    trans.commit()
                except Exception as e:
                    trans.rollback()
                    
    except Exception as e:
        pass  # Silently continue on error