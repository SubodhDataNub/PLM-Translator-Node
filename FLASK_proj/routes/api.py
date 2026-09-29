"""
API routes for DN Translator application.
Handles REST API endpoints for translation, test results, and data management.
"""
import json
import uuid
import threading
from datetime import datetime, timezone
from flask import Blueprint, request, jsonify, send_file, current_app
from FLASK_proj.models import db, TestResult
from FLASK_proj.services.translator import translator_service
from FLASK_proj.utils import unicode_safe_jsonify, get_user_info

# Configuration constant for large dataset threshold
LARGE_DATASET_THRESHOLD = 1000  # Lowered to use chunked processing earlier

api_bp = Blueprint('api', __name__)


def _format_target_language(code_or_display):
    """Return target language in 'code-Name' format.
    If input already looks like 'code-Name' return as-is. Otherwise try to find the display
    name from the translator service and return 'code-DisplayName'."""
    try:
        if not code_or_display:
            return ''

        # If already in code-Name form, return directly
        if isinstance(code_or_display, str) and '-' in code_or_display:
            return code_or_display

        # Try to resolve name from supported languages
        languages = translator_service.get_supported_languages()
        for lang in languages:
            if lang.get('key') == code_or_display:
                name = lang.get('text') or code_or_display
                return f"{code_or_display}-{name}"

        # Fallback to returning the code/string as provided
        return code_or_display
    except Exception:
        return code_or_display


@api_bp.route('/languages')
def get_languages():
    """API endpoint to get supported languages"""
    languages = translator_service.get_supported_languages()
    return jsonify({
        'success': True,
        'languages': languages
    })


@api_bp.route('/translate', methods=['POST'])
def translate():
    """API endpoint for text translation"""
    data = request.get_json()
    
    if not data:
        return jsonify({
            'success': False,
            'error': 'No data provided'
        }), 400
    
    source_text = data.get('text', '').strip()
    target_language = data.get('target_language', '').strip()
    
    # Validation
    if not source_text:
        return jsonify({
            'success': False,
            'error': 'Please enter text to translate'
        }), 400
    
    if not target_language:
        return jsonify({
            'success': False,
            'error': 'Please select a target language'
        }), 400
    
    if len(source_text) > 5000:
        return jsonify({
            'success': False,
            'error': 'Text is too long. Maximum 5000 characters allowed.'
        }), 400
    
    # Perform translation
    result = translator_service.translate_text(source_text, target_language)
    
    if result['success']:
        return unicode_safe_jsonify(result)
    else:
        return unicode_safe_jsonify(result, 500)


@api_bp.route('/azure-user')
def get_azure_user():
    """API endpoint to get current user information"""
    try:
        user_info = get_user_info()
        return jsonify({
            'success': True,
            **user_info,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })
    except Exception as e:
        # Fallback to a generic user
        return jsonify({
            'success': True,
            'user': 'Current User',
            'error': f'Limited user info: {str(e)}',
            'timestamp': datetime.now(timezone.utc).isoformat()
        })


@api_bp.route('/save-test-results', methods=['POST'])
def save_test_results():
    """API endpoint to save test results to database"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
        
        # Validate required fields
        if not data.get('outcome'):
            return jsonify({
                'success': False,
                'error': 'Outcome is required'
            }), 400
        
        # Validate accuracy field (optional for mass translations)
        accuracy = None
        if data.get('accuracy') is not None and data.get('accuracy') != '':
            try:
                accuracy = float(data.get('accuracy'))
                if accuracy < 0 or accuracy > 100:
                    return jsonify({
                        'success': False,
                        'error': 'Accuracy must be between 0 and 100'
                    }), 400
            except (ValueError, TypeError):
                return jsonify({
                    'success': False,
                    'error': 'Accuracy must be a valid number'
                }), 400
        
        # Create new test result record
        test_result = TestResult(
            outcome=data.get('outcome').replace('Failed', 'Failure') if data.get('outcome') == 'Failed' else data.get('outcome'),
            accuracy=accuracy,  # Use the validated accuracy value
            observation=data.get('observation'),
            tested_by=data.get('testedBy'),
            text_to_translate=data.get('sourceText'),
            translated_text=data.get('translatedText'),
            source_language=data.get('sourceLanguage', 'auto'),
            target_language=_format_target_language(data.get('targetLanguage')),
            session_id=data.get('sessionId', str(uuid.uuid4()))
        )
        
        # Save to database
        db.session.add(test_result)
        db.session.commit()
        
        return jsonify({
            'success': True,
            'message': 'Test results saved successfully to database',
            'result_id': test_result.id,
            'data': test_result.to_dict()
        })
        
    except ValueError as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': f'Invalid data format: {str(e)}'
        }), 400
    except Exception as e:
        db.session.rollback()
        return jsonify({
            'success': False,
            'error': f'Failed to save test results: {str(e)}'
        }), 500


@api_bp.route('/test-results', methods=['GET'])
def get_test_results():
    """API endpoint to retrieve test results from database"""
    try:
        # Check if requesting a specific result by ID
        result_id = request.args.get('id', None, type=int)
        
        if result_id:
            # Return specific result by ID
            result = TestResult.query.get(result_id)
            if result:
                return jsonify({
                    'success': True,
                    'results': [result.to_dict()]
                })
            else:
                return jsonify({
                    'success': False,
                    'error': 'Test result not found'
                }), 404
        
        # Get query parameters for pagination and filtering
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 10, type=int)
        outcome_filter = request.args.get('outcome', None)
        
        # Build query
        query = TestResult.query
        
        # Apply filters
        if outcome_filter:
            # Accept both the new 'Failure' label and legacy 'Failed' values when filtering
            of = outcome_filter.strip()
            if of.lower() in ['failed', 'failure']:
                query = query.filter(TestResult.outcome.in_(['Failed', 'Failure']))
            else:
                query = query.filter(TestResult.outcome == of)
        
        # Order by most recent first
        query = query.order_by(TestResult.created_at.desc())
        
        # Paginate results
        pagination = query.paginate(
            page=page, 
            per_page=per_page, 
            error_out=False
        )
        
        # Convert to dictionaries
        results = [result.to_dict() for result in pagination.items]
        
        return jsonify({
            'success': True,
            'data': results,
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total': pagination.total,
                'pages': pagination.pages,
                'has_next': pagination.has_next,
                'has_prev': pagination.has_prev
            }
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Failed to retrieve test results: {str(e)}'
        }), 500


@api_bp.route('/export-test-results', methods=['GET'])
def export_test_results():
    """API endpoint to export test results as Excel file"""
    try:
        import pandas as pd
        from io import BytesIO

        # Optional filters from query params
        outcome_filter = request.args.get('outcome')
        language_filter = request.args.get('language')
        q = request.args.get('q')

        # Build query with optional filters
        query = TestResult.query
        if outcome_filter:
            of = outcome_filter.strip()
            # Be flexible when filtering for failures: accept 'Failed', 'Failure',
            # and simple case/whitespace variants by using a case-insensitive contains match
            try:
                if 'fail' in of.lower():
                    query = query.filter(TestResult.outcome.ilike('%fail%'))
                else:
                    # Exact match for other outcome values
                    query = query.filter(TestResult.outcome == of)
            except Exception:
                # Fallback to exact match if ilike isn't supported on the DB
                query = query.filter(TestResult.outcome == of)

        if language_filter:
            # target_language stored as 'code-Name' so use ilike to match either code or name
            query = query.filter(TestResult.target_language.ilike(f"%{language_filter}%"))
        if q:
            # Search across several text fields
            like_q = f"%{q}%"
            query = query.filter(
                db.or_(
                    TestResult.tested_by.ilike(like_q),
                    TestResult.observation.ilike(like_q),
                    TestResult.text_to_translate.ilike(like_q),
                    TestResult.translated_text.ilike(like_q)
                )
            )

        # Order and fetch results
        results = query.order_by(TestResult.created_at.desc()).all()

        if not results:
            return jsonify({'error': 'No test results to export'}), 404
        
        # Convert to DataFrame
        data = []
        for result in results:
            # Normalize outcome display - show "Failed" for any failure variant for better UX
            outcome_display = 'Failed' if (result.outcome and result.outcome.lower() in ['failed', 'failure']) else result.outcome
            data.append({
                'ID': result.id,
                'Text to Translate': result.text_to_translate,
                'Translated Text': result.translated_text,
                'Source Language': result.source_language,
                'Target Language': result.target_language,
                'Outcome': outcome_display,
                'Observation': result.observation,
                'Accuracy (%)': result.accuracy,
                'Tested By': result.tested_by,
                'Date Created': result.created_at.strftime('%Y-%m-%d %H:%M:%S') if result.created_at else '',
                'Session ID': result.session_id
            })
        
        df = pd.DataFrame(data)
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='Test Results', index=False)
            
            # Auto-adjust column widths
            worksheet = writer.sheets['Test Results']
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except:
                        pass
                adjusted_width = min(max_length + 2, 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width
        
        output.seek(0)
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f'test_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        )
        
    except ImportError:
        return jsonify({'error': 'Pandas and openpyxl libraries are required for Excel export'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/test-results/<int:result_id>', methods=['DELETE'])
def delete_test_result(result_id):
    """API endpoint to delete a specific test result"""
    try:
        # Find the test result
        result = TestResult.query.get(result_id)
        
        if not result:
            return jsonify({'error': 'Test result not found'}), 404
        
        # Delete the test result
        db.session.delete(result)
        db.session.commit()
        
        return jsonify({'message': 'Test result deleted successfully'})
        
    except Exception as e:
        db.session.rollback()
        return jsonify({'error': str(e)}), 500


@api_bp.route('/validate-large-file', methods=['POST'])
def validate_large_file():
    """API endpoint to validate large Excel files before processing"""
    try:
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file uploaded'
            }), 400
        
        file = request.files['file']
        
        if file.filename == '':
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400
        
        # Check file extension
        if not file.filename.lower().endswith(('.xlsx', '.xls')):
            return jsonify({
                'success': False,
                'error': 'Please upload an Excel file (.xlsx or .xls)'
            }), 400
        
        # Save temporary file for validation
        import tempfile
        import os
        import time
        
        temp_file_path = None
        try:
            # Create temporary file
            with tempfile.NamedTemporaryFile(delete=False, suffix='.xlsx') as temp_file:
                temp_file_path = temp_file.name
                file.save(temp_file_path)
            
            # Import large scale translator
            from FLASK_proj.services.large_scale_translator import large_scale_translator
            
            # Validate the file
            validation_result = large_scale_translator.validate_large_file(temp_file_path)
            
            if validation_result['success']:
                # Add processing time estimates
                total_rows = validation_result.get('total_rows', 0)
                if isinstance(total_rows, int):
                    # Check if target languages are provided in the request
                    target_languages_param = request.form.get('target_languages')
                    language_count = 1  # Default to 1 language
                    
                    if target_languages_param:
                        try:
                            target_languages = json.loads(target_languages_param)
                            if isinstance(target_languages, list):
                                language_count = len(target_languages)
                        except (json.JSONDecodeError, TypeError):
                            pass  # Use default language_count = 1
                    
                    time_estimates = large_scale_translator.estimate_processing_time(total_rows, language_count)
                    validation_result['time_estimates'] = time_estimates
                
                return jsonify(validation_result)
            else:
                return jsonify(validation_result), 400
                
        finally:
            # Clean up temporary file with retry mechanism for Windows
            if temp_file_path and os.path.exists(temp_file_path):
                max_retries = 3
                for attempt in range(max_retries):
                    try:
                        os.unlink(temp_file_path)
                        break
                    except (PermissionError, OSError) as e:
                        if attempt < max_retries - 1:
                            time.sleep(0.1)  # Wait 100ms before retry
                
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'File validation error: {str(e)}'
        }), 500


@api_bp.route('/estimate-processing-time', methods=['POST'])
def estimate_processing_time():
    """API endpoint to estimate processing time based on row count and target languages"""
    try:
        data = request.get_json()
        
        if not data:
            return jsonify({
                'success': False,
                'error': 'No data provided'
            }), 400
        
        record_count = data.get('record_count', 0)
        target_languages = data.get('target_languages', [])
        
        if not isinstance(record_count, int) or record_count <= 0:
            return jsonify({
                'success': False,
                'error': 'Valid record_count is required'
            }), 400
        
        if not isinstance(target_languages, list) or len(target_languages) == 0:
            return jsonify({
                'success': False,
                'error': 'Valid target_languages list is required'
            }), 400
        
        # Import large scale translator
        from FLASK_proj.services.large_scale_translator import large_scale_translator
        
        # Calculate estimates
        language_count = len(target_languages)
        time_estimates = large_scale_translator.estimate_processing_time(record_count, language_count)
        
        return jsonify({
            'success': True,
            'time_estimates': time_estimates,
            'total_translations': record_count * language_count
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Error calculating estimates: {str(e)}'
        }), 500


@api_bp.route('/mass-translate', methods=['POST'])
def mass_translate():
    """API endpoint for mass translation from Excel file - with batch processing for speed"""
    try:
        # Check if file was uploaded
        if 'file' not in request.files:
            return jsonify({
                'success': False,
                'error': 'No file uploaded'
            }), 400
        
        file = request.files['file']
        target_languages_json = request.form.get('target_languages')
        tested_by = request.form.get('tested_by')
        
        if file.filename == '':
            return jsonify({
                'success': False,
                'error': 'No file selected'
            }), 400
        
        if not tested_by or not tested_by.strip():
            return jsonify({
                'success': False,
                'error': 'Tested by field is required'
            }), 400
        
        if not target_languages_json:
            return jsonify({
                'success': False,
                'error': 'Target languages are required'
            }), 400
        
        # Parse target languages from JSON
        try:
            import json
            target_languages = json.loads(target_languages_json)
            if not isinstance(target_languages, list) or len(target_languages) == 0:
                raise ValueError("Invalid target languages format")
        except (json.JSONDecodeError, ValueError) as e:
            return jsonify({
                'success': False,
                'error': f'Invalid target languages format: {str(e)}'
            }), 400
        
        # Check file extension
        if not file.filename.lower().endswith(('.xlsx', '.xls')):
            return jsonify({
                'success': False,
                'error': 'Please upload an Excel file (.xlsx or .xls)'
            }), 400
        
        # Process Excel file
        import pandas as pd
        from io import BytesIO
        
        # Read Excel file
        file_content = BytesIO(file.read())
        
        try:
            df = pd.read_excel(file_content)
            df = df.fillna('')
        except Exception as e:
            return jsonify({
                'success': False,
                'error': f'Error reading Excel file: {str(e)}'
            }), 400
        
        # Validate Excel structure
        if df.empty:
            return jsonify({
                'success': False,
                'error': 'Excel file is empty'
            }), 400
        
        total_rows = len(df)
        session_id = f'mass_translation_{datetime.now().strftime("%Y%m%d_%H%M%S")}'
        
        # Process with batch translation (fast!)
        result = _process_batch_translation(df, target_languages, total_rows, tested_by.strip(), session_id)
        
        return jsonify(result)
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Server error: {str(e)}'
        }), 500


def _process_batch_translation(df, target_languages, total_rows, tested_by, session_id):
    """Process translation using batch API calls for maximum speed"""
    
    # Find text column
    text_column = None
    for col in ['Phrase Text', 'phrase text', 'PHRASE TEXT', 'text', 'Text', 'TEXT', 
                'content', 'Content', 'CONTENT', 'message', 'Message', 'MESSAGE']:
        if col in df.columns:
            text_column = col
            break
    
    if text_column is None:
        text_column = df.columns[0]
    
    # Find description column
    description_column = None
    for col in ['description', 'Description', 'DESCRIPTION', 'desc', 'Desc', 'notes', 'Notes']:
        if col in df.columns and col != text_column:
            description_column = col
            break
    
    # Collect all valid texts
    texts_data = []
    for index, row in df.iterrows():
        source_text = str(row[text_column]).strip()
        description = ''
        if description_column and description_column in row:
            description = str(row[description_column]).strip()
            if description.lower() in ['nan', 'none', '']:
                description = ''
        
        if source_text and source_text.lower() not in ['nan', 'none', '']:
            texts_data.append({
                'index': index,
                'text': source_text,
                'description': description
            })
    
    successful_translations = 0
    failed_translations = 0
    
    # Process each language
    for target_language in target_languages:
        # Extract texts for batch translation
        texts = [item['text'] for item in texts_data]
        
        # Batch translate all texts for this language
        # Use smaller batch size (25) to avoid rate limits for large datasets
        batch_results = translator_service.translate_batch(texts, target_language, max_batch_size=25)
        
        # Prepare batch for database (including both successful and failed)
        db_batch = []
        for idx, result in enumerate(batch_results):
            original_data = texts_data[idx]
            
            if result['success']:
                db_batch.append({
                    'outcome': 'Success',
                    'accuracy': 0,
                    'observation': f'Mass translation - Row {original_data["index"] + 1}' + (f' - {original_data["description"]}' if original_data["description"] else ''),
                    'tested_by': tested_by,
                    'text_to_translate': original_data['text'],
                    'translated_text': result['translated_text'],
                    'source_language': 'auto',
                    'target_language': _format_target_language(target_language),
                    'session_id': session_id
                })
                successful_translations += 1
            else:
                # Save failed translations with error details
                error_message = result.get('error', 'Translation failed - Unknown error')
                db_batch.append({
                    'outcome': 'Failure',
                    'accuracy': 0,
                    'observation': f'Mass translation FAILED - Row {original_data["index"] + 1} - Error: {error_message}' + (f' - {original_data["description"]}' if original_data["description"] else ''),
                    'tested_by': tested_by,
                    'text_to_translate': original_data['text'],
                    'translated_text': f'ERROR: {error_message}',
                    'source_language': 'auto',
                    'target_language': _format_target_language(target_language),
                    'session_id': session_id
                })
                failed_translations += 1
        
        # Bulk insert to database
        if db_batch:
            try:
                db.session.bulk_insert_mappings(TestResult, db_batch)
                db.session.commit()
            except Exception:
                db.session.rollback()
                # Fallback to individual inserts
                for item in db_batch:
                    try:
                        test_result = TestResult(**item)
                        db.session.add(test_result)
                        db.session.commit()
                    except Exception:
                        db.session.rollback()
                        failed_translations += 1
                        successful_translations -= 1
    
    # Calculate statistics
    total_failed = (total_rows * len(target_languages)) - successful_translations
    
    return {
        'success': True,
        'message': f'Mass translation completed: {successful_translations} successful',
        'session_id': session_id,
        'statistics': {
            'total_rows': total_rows,
            'successful': successful_translations,
            'failed': total_failed,
            'success_rate': round((successful_translations / (total_rows * len(target_languages))) * 100, 2) if total_rows > 0 else 0,
            'languages_count': len(target_languages),
            'target_languages': target_languages
        }
    }


@api_bp.route('/translation-progress/<job_id>', methods=['GET'])
def get_translation_progress(job_id):
    """API endpoint to poll translation job progress"""
    try:
        from FLASK_proj.app import cache
        
        # Get job status from cache
        job_status = cache.get(f'job_{job_id}_status')
        
        if not job_status:
            return jsonify({
                'success': False,
                'error': 'Job not found or expired'
            }), 404
        
        return jsonify({
            'success': True,
            **job_status
        })
        
    except Exception as e:
        return jsonify({
            'success': False,
            'error': f'Error retrieving job status: {str(e)}'
        }), 500


def _process_translation_background(app_instance, job_id, session_id, df, target_languages, total_rows, tested_by, use_chunked):
    """Background processing function for mass translation"""
    from FLASK_proj.app import cache
    import traceback
    
    try:
        print(f"[DEBUG] Background processing started - Job ID: {job_id}, Rows: {total_rows}, Chunked: {use_chunked}")
        
        # Create application context for database operations
        with app_instance.app_context():
            if use_chunked:
                # Use chunked processing for large datasets
                print(f"[DEBUG] Using chunked processing")
                _process_large_dataset_chunked_with_progress(
                    job_id, session_id, df, target_languages, total_rows, tested_by
                )
            else:
                # Use standard processing
                print(f"[DEBUG] Using standard processing")
                _process_standard_dataset_with_progress(
                    job_id, session_id, df, target_languages, total_rows, tested_by
                )
    except Exception as e:
        # Update job status with error
        print(f"[ERROR] Background processing failed: {str(e)}")
        traceback.print_exc()
        
        with app_instance.app_context():
            cache.set(f'job_{job_id}_status', {
                'status': 'error',
                'progress': 100,
                'total': total_rows,
                'successful': 0,
                'failed': total_rows,
                'current_row': 0,
                'session_id': session_id,
                'message': f'Processing error: {str(e)}'
            })


def _process_standard_dataset_with_progress(job_id, session_id, df, target_languages, total_rows, tested_by):
    """Process smaller datasets with batch translation and progress updates"""
    from FLASK_proj.app import cache
    
    print(f"[DEBUG] _process_standard_dataset_with_progress started - Job: {job_id}")
    
    # Check for text column
    text_column = None
    possible_text_columns = ['Phrase Text', 'phrase text', 'PHRASE TEXT', 'text', 'Text', 'TEXT', 
                           'content', 'Content', 'CONTENT', 'message', 'Message', 'MESSAGE', 
                           'description', 'Description']
    
    for col in possible_text_columns:
        if col in df.columns:
            text_column = col
            break
    
    if text_column is None:
        text_column = df.columns[0]
    
    print(f"[DEBUG] Using text column: {text_column}")
    
    # Check for description column
    description_column = None
    possible_description_columns = ['description', 'Description', 'DESCRIPTION', 'desc', 'Desc', 'notes', 'Notes']
    
    for col in possible_description_columns:
        if col in df.columns and col != text_column:
            description_column = col
            break
    
    # Collect all texts and metadata
    texts_data = []
    for index, row in df.iterrows():
        source_text = str(row[text_column]).strip()
        description = ''
        if description_column and description_column in row:
            description = str(row[description_column]).strip()
            if description.lower() in ['nan', 'none', '']:
                description = ''
        
        if source_text and source_text.lower() not in ['nan', 'none', '']:
            texts_data.append({
                'index': index,
                'text': source_text,
                'description': description
            })
    
    print(f"[DEBUG] Collected {len(texts_data)} valid texts from {total_rows} rows")
    
    successful_translations = 0
    failed_translations = 0
    
    # Update initial progress
    cache.set(f'job_{job_id}_status', {
        'status': 'processing',
        'progress': 5,
        'total': total_rows,
        'successful': 0,
        'failed': 0,
        'current_row': 0,
        'session_id': session_id,
        'message': f'Starting batch translation for {len(texts_data)} valid texts...'
    })
    
    print(f"[DEBUG] Initial progress set, starting translation loop")
    
    # Process each target language
    for lang_idx, target_language in enumerate(target_languages):
        print(f"[DEBUG] Processing language {lang_idx + 1}/{len(target_languages)}: {target_language}")
        
        try:
            # Extract texts for batch translation
            texts = [item['text'] for item in texts_data]
            
            # Update progress - starting this language
            progress_percent = 10 + int((lang_idx / len(target_languages)) * 80)
            cache.set(f'job_{job_id}_status', {
                'status': 'processing',
                'progress': progress_percent,
                'total': total_rows,
                'successful': successful_translations,
                'failed': failed_translations,
                'current_row': len(texts),
                'session_id': session_id,
                'message': f'Translating to {target_language.upper()}... ({lang_idx + 1}/{len(target_languages)} languages)'
            })
            
            # Batch translate all texts for this language
            batch_results = translator_service.translate_batch(texts, target_language)
            
            # Update progress - translation complete, now saving
            cache.set(f'job_{job_id}_status', {
                'status': 'processing',
                'progress': progress_percent + 5,
                'total': total_rows,
                'successful': successful_translations,
                'failed': failed_translations,
                'current_row': len(texts),
                'session_id': session_id,
                'message': f'Saving {target_language.upper()} translations to database...'
            })
            
            # Save results to database in batches
            db_batch = []
            successful_in_batch = 0
            failed_in_batch = 0
            
            for idx, result in enumerate(batch_results):
                if result['success']:
                    original_data = texts_data[idx]
                    db_batch.append({
                        'outcome': 'Success',
                        'accuracy': 0,
                        'observation': f'Mass translation - Row {original_data["index"] + 1}' + (f' - {original_data["description"]}' if original_data["description"] else ''),
                        'tested_by': tested_by,
                        'text_to_translate': original_data['text'],
                        'translated_text': result['translated_text'],
                        'source_language': 'auto',
                        'target_language': _format_target_language(target_language),
                        'session_id': session_id
                    })
                    successful_in_batch += 1
                else:
                    failed_in_batch += 1
            
            # Bulk insert for this language
            if db_batch:
                try:
                    db.session.bulk_insert_mappings(TestResult, db_batch)
                    db.session.commit()
                    successful_translations += successful_in_batch
                    failed_translations += failed_in_batch
                except Exception as db_error:
                    db.session.rollback()
                    # Fallback to individual inserts
                    for item in db_batch:
                        try:
                            test_result = TestResult(**item)
                            db.session.add(test_result)
                            db.session.commit()
                            successful_translations += 1
                        except Exception:
                            db.session.rollback()
                            failed_translations += 1
            else:
                failed_translations += failed_in_batch
            
            # Update progress - this language complete
            progress_percent = 10 + int(((lang_idx + 1) / len(target_languages)) * 80)
            cache.set(f'job_{job_id}_status', {
                'status': 'processing',
                'progress': progress_percent,
                'total': total_rows,
                'successful': successful_translations,
                'failed': failed_translations,
                'current_row': len(texts),
                'session_id': session_id,
                'message': f'Completed {target_language.upper()} ({lang_idx + 1}/{len(target_languages)} languages) - {successful_in_batch} successful'
            })
                            
        except Exception as lang_error:
            failed_translations += len(texts_data)
            # Update progress with error
            cache.set(f'job_{job_id}_status', {
                'status': 'processing',
                'progress': 10 + int(((lang_idx + 1) / len(target_languages)) * 80),
                'total': total_rows,
                'successful': successful_translations,
                'failed': failed_translations,
                'current_row': len(texts_data),
                'session_id': session_id,
                'message': f'Error translating to {target_language.upper()}: {str(lang_error)}'
            })
    
    # Calculate final stats
    total_failed = total_rows - successful_translations
    
    # Update final status
    cache.set(f'job_{job_id}_status', {
        'status': 'completed',
        'progress': 100,
        'total': total_rows,
        'successful': successful_translations,
        'failed': total_failed,
        'current_row': total_rows,
        'session_id': session_id,
        'message': f'Translation completed: {successful_translations}/{total_rows} successful',
        'success_rate': round((successful_translations / total_rows) * 100, 2) if total_rows > 0 else 0
    })


def _process_large_dataset_chunked_with_progress(job_id, session_id, df, target_languages, total_rows, tested_by):
    """Process large datasets using chunked method with progress updates"""
    from FLASK_proj.app import cache
    from FLASK_proj.services.large_scale_translator import large_scale_translator
    
    try:
        # Update status - starting chunked processing
        cache.set(f'job_{job_id}_status', {
            'status': 'processing',
            'progress': 5,
            'total': total_rows,
            'successful': 0,
            'failed': 0,
            'current_row': 0,
            'session_id': session_id,
            'message': 'Starting chunked processing for large dataset...'
        })
        
        # Process using chunked method
        processing_result = large_scale_translator.process_large_dataset_chunked(
            df, target_languages, session_id=session_id
        )
        
        # Update progress - combining results
        cache.set(f'job_{job_id}_status', {
            'status': 'processing',
            'progress': 70,
            'total': total_rows,
            'successful': 0,
            'failed': 0,
            'current_row': total_rows,
            'session_id': session_id,
            'message': 'Combining chunk results...'
        })
        
        # Combine results from all chunks
        all_results = large_scale_translator.combine_chunk_results(
            processing_result['chunk_files']
        )
        
        # Update progress - saving to database
        cache.set(f'job_{job_id}_status', {
            'status': 'processing',
            'progress': 80,
            'total': total_rows,
            'successful': 0,
            'failed': 0,
            'current_row': total_rows,
            'session_id': session_id,
            'message': 'Saving results to database...'
        })
        
        # Save to database with batch commits
        successful_translations = 0
        batch_commit_size = 200
        pending_commits = 0
        
        for result in all_results:
            if result.get('success', False) and result.get('translations'):
                try:
                    source_text = result.get('source_text', '')
                    description = result.get('description', '')
                    translations = result.get('translations', {})
                    row_num = result.get('row', 0)
                    
                    for target_lang, translated_text in translations.items():
                        try:
                            test_result = TestResult(
                                outcome='Success',
                                accuracy=0,
                                observation=f'Mass translation - Row {row_num}' + (f' - {description}' if description else ''),
                                tested_by=tested_by,
                                text_to_translate=source_text,
                                translated_text=translated_text,
                                source_language='auto',
                                target_language=_format_target_language(target_lang),
                                session_id=session_id
                            )
                            db.session.add(test_result)
                            pending_commits += 1
                            
                            if pending_commits >= batch_commit_size:
                                try:
                                    db.session.commit()
                                    pending_commits = 0
                                except Exception:
                                    db.session.rollback()
                                    pending_commits = 0
                        except Exception:
                            pass
                    
                    successful_translations += 1
                except Exception:
                    pass
        
        # Final commit
        if pending_commits > 0:
            try:
                db.session.commit()
            except Exception:
                db.session.rollback()
        
        failed_translations = total_rows - successful_translations
        
        # Clean up temporary files
        large_scale_translator.cleanup_temp_files(
            processing_result['output_dir'], 
            session_id
        )
        
        # Update final status
        cache.set(f'job_{job_id}_status', {
            'status': 'completed',
            'progress': 100,
            'total': total_rows,
            'successful': successful_translations,
            'failed': failed_translations,
            'current_row': total_rows,
            'session_id': session_id,
            'message': f'Large dataset translation completed: {successful_translations}/{total_rows} rows successful',
            'success_rate': round((successful_translations / total_rows) * 100, 2) if total_rows > 0 else 0,
            'chunks_processed': processing_result['total_chunks']
        })
        
    except Exception as e:
        # Update error status
        cache.set(f'job_{job_id}_status', {
            'status': 'error',
            'progress': 100,
            'total': total_rows,
            'successful': 0,
            'failed': total_rows,
            'current_row': 0,
            'session_id': session_id,
            'message': f'Chunked processing error: {str(e)}'
        })


@api_bp.route('/download-template', methods=['GET'])
def download_template():
    """API endpoint to download Excel template for mass translation"""
    try:
        import pandas as pd
        from io import BytesIO
        
        # Create sample data for the template
        template_data = [
            {
                'Phrase Text': 'Hello, how are you?'
            },
            {
                'Phrase Text': 'Thank you for your help.'
            },
            {
                'Phrase Text': 'Please review this document.'
            }
        ]
        
        df = pd.DataFrame(template_data)
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='Translation Data', index=False)
            
            # Get workbook and worksheet
            workbook = writer.book
            worksheet = writer.sheets['Translation Data']
            
            # Auto-adjust column widths
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except:
                        pass
                adjusted_width = min(max_length + 2, 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width
            
            # Add header styling
            from openpyxl.styles import Font, PatternFill
            header_font = Font(bold=True, color="FFFFFF")
            header_fill = PatternFill(start_color="366092", end_color="366092", fill_type="solid")
            
            for cell in worksheet[1]:
                cell.font = header_font
                cell.fill = header_fill
            
            # Add instructions sheet
            instructions_data = [
                ['Mass Translation Template Instructions'],
                [''],
                ['How to use this template:'],
                ['1. Replace the sample data with your own text to translate'],
                ['2. Keep the column headers as they are'],
                ['3. Supported column names: text, content, message, description'],
                ['4. You can use either "text" or "description" column (or both)'],
                ['5. Maximum 5000 characters per text entry'],
                ['6. Save the file as .xlsx or .xls format'],
                ['7. Upload the file to the DN Translator mass translation page'],
                [''],
                ['Column Descriptions:'],
                ['- text: The main text content to be translated (required)'],
                ['- description: Optional description or context for the text'],
                [''],
                ['Notes:'],
                ['- Empty rows will be skipped'],
                ['- Processing time depends on the number of rows'],
                ['- Results will include source text, translated text, and status'],
                ['- You can download the translation results after processing']
            ]
            
            instructions_df = pd.DataFrame(instructions_data, columns=['Instructions'])
            instructions_df.to_excel(writer, sheet_name='Instructions', index=False, header=False)
            
            # Style instructions sheet
            instructions_ws = writer.sheets['Instructions']
            instructions_ws.column_dimensions['A'].width = 80
            
            # Style the title
            title_font = Font(bold=True, size=14, color="366092")
            instructions_ws['A1'].font = title_font
        
        output.seek(0)
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name='mass_translation_template.xlsx'
        )
        
    except ImportError:
        return jsonify({'error': 'Pandas and openpyxl libraries are required for template generation'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@api_bp.route('/download-translation-results', methods=['POST'])
def download_translation_results():
    """API endpoint to download translation results as Excel file - fetches all results from database"""
    try:
        import pandas as pd
        from io import BytesIO
        
        data = request.get_json()
        
        # Get session_id to fetch all results from database
        session_id = data.get('session_id') if data else None
        
        # Fallback: use results from request if no session_id
        if session_id:
            # Fetch all results from database by session_id
            from FLASK_proj.models import TestResult
            test_results = TestResult.query.filter_by(session_id=session_id).order_by(TestResult.id).all()
            
            if not test_results:
                return jsonify({'error': 'No translation results found for this session'}), 400
            
            # Convert database results to the format expected by the Excel generator
            results = []
            for idx, result in enumerate(test_results, 1):
                # Extract row number from observation if available
                row_num = idx
                if result.observation and 'Row ' in result.observation:
                    try:
                        row_num = int(result.observation.split('Row ')[1].split(' ')[0].split('-')[0])
                    except:
                        pass
                
                results.append({
                    'row': row_num,
                    'source_text': result.text_to_translate or '',
                    'success': result.outcome == 'Success',
                    'translations': {result.target_language.split('-')[0]: result.translated_text} if result.translated_text else {},
                    'description': result.observation or '',
                    'error': result.observation if result.outcome != 'Success' else ''
                })
        elif data and 'results' in data:
            # Fallback to provided results (for backward compatibility)
            results = data['results']
        else:
            return jsonify({'error': 'No translation results or session_id provided'}), 400
        
        if not results:
            return jsonify({'error': 'No translation results to download'}), 400
        
        # Get language descriptions for mapping
        from FLASK_proj.services.translator import translator_service
        languages_list = translator_service.get_supported_languages()
        language_map = {}
        for lang in languages_list:
            if lang.get('key'):  # Skip empty key
                language_map[lang['key']] = lang['text']
        
        # Create DataFrame from results - handle multiple languages
        df_data = []
        for result in results:
            base_row = {
                'Row': result.get('row', ''),
                'Source Text': result.get('source_text', ''),
                'Status': 'Success' if result.get('success') else 'Failed'
            }
            
            # Add description if available from the original data
            if result.get('description'):
                base_row['Description'] = result.get('description', '')
            
            if result.get('success') and result.get('translations'):
                # Multiple languages - create columns for each language
                translations = result.get('translations', {})
                for lang_code, translation in translations.items():
                    # Get language description from the map
                    lang_description = language_map.get(lang_code, lang_code.upper())
                    base_row[f'{lang_description} ({lang_code.upper()})'] = translation
                
                # Add success info
                if 'successful_languages' in result:
                    base_row['Successful Languages'] = f"{result['successful_languages']}/{result['total_languages']}"
                
                # Add any errors
                if result.get('errors'):
                    base_row['Errors'] = '; '.join(result['errors'])
                else:
                    base_row['Errors'] = ''
                    
            elif result.get('success') and result.get('translated_text'):
                # Single language (backward compatibility)
                base_row['Translation'] = result.get('translated_text', '')
                base_row['Detected Language'] = result.get('detected_language', '')
                base_row['Errors'] = ''
            else:
                # Failed translation
                base_row['Translation'] = ''
                base_row['Errors'] = result.get('error', '') if not result.get('success') else ''
            
            df_data.append(base_row)
        
        df = pd.DataFrame(df_data)
        
        # Create Excel file in memory
        output = BytesIO()
        with pd.ExcelWriter(output, engine='openpyxl') as writer:
            df.to_excel(writer, sheet_name='Translation Results', index=False)
            
            # Auto-adjust column widths
            worksheet = writer.sheets['Translation Results']
            for column in worksheet.columns:
                max_length = 0
                column_letter = column[0].column_letter
                for cell in column:
                    try:
                        if len(str(cell.value)) > max_length:
                            max_length = len(str(cell.value))
                    except:
                        pass
                adjusted_width = min(max_length + 2, 50)
                worksheet.column_dimensions[column_letter].width = adjusted_width
        
        output.seek(0)
        
        return send_file(
            output,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            as_attachment=True,
            download_name=f'translation_results_{datetime.now().strftime("%Y%m%d_%H%M%S")}.xlsx'
        )
        
    except ImportError:
        return jsonify({'error': 'Pandas and openpyxl libraries are required for Excel export'}), 500
    except Exception as e:
        return jsonify({'error': str(e)}), 500