"""
Utility functions for DN Translator application.
Contains helper functions and common utilities.
"""
import os
import getpass
import platform
from flask import jsonify, make_response


def unicode_safe_jsonify(data, status_code=200):
    """Create a JSON response that properly handles Unicode characters"""
    response = make_response(jsonify(data), status_code)
    response.headers['Content-Type'] = 'application/json; charset=utf-8'
    return response


def get_user_info():
    """Get current user information for the application"""
    try:
        # Get system user information
        current_user = getpass.getuser()
        computer_name = platform.node()
        
        # Try to get more detailed user info if available
        user_display_name = current_user
        
        # On Windows, try to get full name from environment
        if platform.system() == 'Windows':
            full_name = os.environ.get('USERNAME', current_user)
            if full_name and full_name != current_user:
                user_display_name = full_name
        
        # Format user information
        user_info = f"{user_display_name}"
        
        # Add computer info for local development
        if not os.environ.get('WEBSITE_SITE_NAME'):  # Not on Azure
            user_info += f" ({computer_name})"
        
        return {
            'user': user_info,
            'username': current_user,
            'computer': computer_name
        }
    except Exception as e:
        # Fallback to a generic user
        return {
            'user': 'Current User',
            'username': 'unknown',
            'computer': 'unknown',
            'error': f'Limited user info: {str(e)}'
        }


def validate_translation_request(data):
    """Validate translation request data"""
    if not data:
        return False, 'No data provided'
    
    source_text = data.get('text', '').strip()
    target_language = data.get('target_language', '').strip()
    
    if not source_text:
        return False, 'Please enter text to translate'
    
    if not target_language:
        return False, 'Please select a target language'
    
    if len(source_text) > 5000:
        return False, 'Text is too long. Maximum 5000 characters allowed.'
    
    return True, None


def validate_test_result_data(data):
    """Validate test result data before saving"""
    if not data:
        return False, 'No data provided', None
    
    # Validate required fields
    if not data.get('outcome'):
        return False, 'Outcome is required', None
    
    # Validate accuracy field
    if not data.get('accuracy'):
        return False, 'Accuracy is required', None
    
    try:
        accuracy = float(data.get('accuracy'))
        if accuracy < 0 or accuracy > 100:
            return False, 'Accuracy must be between 0 and 100', None
    except (ValueError, TypeError):
        return False, 'Accuracy must be a valid number', None
    
    return True, None, accuracy


def get_environment_type():
    """Determine the current environment type"""
    if os.environ.get('WEBSITE_SITE_NAME'):
        return 'production'
    elif os.environ.get('FLASK_ENV') == 'development':
        return 'development'
    elif os.environ.get('TESTING'):
        return 'testing'
    else:
        return 'development'  # Default to development