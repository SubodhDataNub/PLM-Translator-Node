"""
Main routes for DN Translator application.
Handles page rendering and general web routes.
"""
from flask import Blueprint, render_template, request
from sqlalchemy import func
from FLASK_proj.services.translator import translator_service
from FLASK_proj.models import TestResult, db

main_bp = Blueprint('main', __name__)


@main_bp.route('/')
def index():
    """Main translator page"""
    languages = translator_service.get_supported_languages()
    return render_template('translator.html', languages=languages)


@main_bp.route('/mass-translation')
def mass_translation():
    """Mass translation page with Excel upload"""
    languages = translator_service.get_supported_languages()
    return render_template('mass_translation.html', languages=languages)


@main_bp.route('/test-results')
def view_test_results():
    """View test results with pagination and server-side filtering/sorting for performance"""
    try:
        # Get pagination parameters
        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)  # Default 50 records per page
        
        # Validate page parameter
        if page < 1:
            page = 1
            
        # Get filter parameters
        outcome_filter = request.args.get('outcome', '').strip()
        language_filter = request.args.get('language', '').strip()
        search_query = request.args.get('q', '').strip()
        
        # Get sort parameters
        sort_by = request.args.get('sort', 'id_desc').strip()
        
        # Limit per_page to prevent abuse
        per_page = min(per_page, 200)  # Max 200 records per page
        
        # Build base query
        query = TestResult.query
        
        # Apply filters
        if outcome_filter:
            if outcome_filter.lower() == 'failed':
                # Handle both 'Failed' and 'Failure' for comprehensive failed filter
                query = query.filter(TestResult.outcome.in_(['Failed', 'Failure']))
            else:
                query = query.filter(TestResult.outcome == outcome_filter)
        
        if language_filter:
            # Search in target_language field (stored as 'code-Name')
            query = query.filter(TestResult.target_language.ilike(f'%{language_filter}%'))
        
        if search_query:
            # Search across multiple text fields
            search_term = f'%{search_query}%'
            query = query.filter(
                db.or_(
                    TestResult.tested_by.ilike(search_term),
                    TestResult.observation.ilike(search_term),
                    TestResult.text_to_translate.ilike(search_term),
                    TestResult.translated_text.ilike(search_term)
                )
            )
        
        # Apply sorting
        if sort_by == 'id_asc':
            query = query.order_by(TestResult.id.asc())
        elif sort_by == 'created_at_desc':
            query = query.order_by(TestResult.created_at.desc())
        elif sort_by == 'created_at_asc':
            query = query.order_by(TestResult.created_at.asc())
        elif sort_by == 'accuracy_desc':
            query = query.order_by(TestResult.accuracy.desc())
        elif sort_by == 'accuracy_asc':
            query = query.order_by(TestResult.accuracy.asc())
        else:  # Default to id_desc
            query = query.order_by(TestResult.id.desc())
        
        # Get total count for all records (unfiltered)
        total_results = TestResult.query.count()
        
        # Get filtered count
        filtered_count = query.count()
        
        # Calculate maximum pages based on filtered results
        max_pages = (filtered_count + per_page - 1) // per_page if filtered_count > 0 else 1
        
        # Validate page parameter against max pages
        if page > max_pages:
            page = max_pages if max_pages > 0 else 1
        
        # Calculate statistics for filtered results
        if outcome_filter or language_filter or search_query:
            # Calculate stats for filtered data
            stats = {
                'total': filtered_count,
                'success': query.filter_by(outcome='Success').count(),
                'partial': query.filter_by(outcome='Partial').count(),
            }
            
            # Calculate failed count for filtered data
            failed_query = query.filter(TestResult.outcome.in_(['Failed', 'Failure']))
            stats['failed'] = failed_query.count()
        else:
            # Calculate statistics for all records (not just current page)
            stats = {
                'total': total_results,
                'success': TestResult.query.filter_by(outcome='Success').count(),
                'partial': TestResult.query.filter_by(outcome='Partial').count(),
            }
            
            # Try both 'Failure' (standard) and 'Failed' (legacy) for compatibility
            failed_count = (TestResult.query.filter_by(outcome='Failure').count() + 
                           TestResult.query.filter_by(outcome='Failed').count())
            
            # If we don't have explicit failed records, calculate as remainder
            if failed_count == 0 and total_results > 0:
                failed_count = total_results - stats['success'] - stats['partial']
            
            stats['failed'] = failed_count
        
        # Calculate success rate
        if stats['total'] > 0:
            stats['success_rate'] = (stats['success'] / stats['total']) * 100
        else:
            stats['success_rate'] = 0
        
        # Get paginated results with error handling
        try:
            pagination = query.paginate(
                page=page,
                per_page=per_page,
                error_out=False
            )
            
            results = pagination.items
            
            # Calculate pagination info
            pagination_info = {
                'page': page,
                'per_page': per_page,
                'total': filtered_count,  # Use filtered count for pagination
                'pages': pagination.pages,
                'has_prev': pagination.has_prev,
                'prev_num': pagination.prev_num,
                'has_next': pagination.has_next,
                'next_num': pagination.next_num,
                'iter_pages': list(pagination.iter_pages(left_edge=1, right_edge=1, left_current=1, right_current=2))
            }
        except Exception as pagination_error:
            # Fallback to first page if pagination fails
            pagination = query.paginate(
                page=1,
                per_page=per_page,
                error_out=False
            )
            
            results = pagination.items
            
            # Calculate pagination info with fallback
            pagination_info = {
                'page': 1,
                'per_page': per_page,
                'total': filtered_count,
                'pages': pagination.pages,
                'has_prev': False,
                'prev_num': None,
                'has_next': pagination.has_next,
                'next_num': pagination.next_num if pagination.has_next else None,
                'iter_pages': list(range(1, min(6, pagination.pages + 1))) if pagination.pages > 0 else [1]
            }
        
        # Get unique languages for filter dropdown
        unique_languages = db.session.query(TestResult.target_language).distinct().filter(
            TestResult.target_language.isnot(None)
        ).all()
        unique_languages = [lang[0] for lang in unique_languages if lang[0]]
        
        # Final validation of pagination_info
        if not pagination_info or pagination_info.get('pages', 0) < 1:
            pagination_info['pages'] = 1
            pagination_info['total'] = filtered_count
            
        # Ensure iter_pages is never empty
        if not pagination_info.get('iter_pages'):
            pagination_info['iter_pages'] = [pagination_info['page']]

        return render_template('test_results.html', 
                             results=results, 
                             pagination=pagination_info,
                             stats=stats,
                             total_results=total_results,
                             filtered_count=filtered_count,
                             unique_languages=unique_languages,
                             current_filters={
                                 'outcome': outcome_filter,
                                 'language': language_filter,
                                 'search': search_query,
                                 'sort': sort_by
                             })
    except Exception as e:
        return f"Error loading test results: {str(e)}", 500


@main_bp.errorhandler(404)
def not_found(error):
    """Handle 404 errors"""
    return render_template('error.html', 
                         error_code=404, 
                         error_message="Page not found"), 404


@main_bp.errorhandler(500)
def internal_error(error):
    """Handle 500 errors"""
    return render_template('error.html', 
                         error_code=500, 
                         error_message="Internal server error"), 500