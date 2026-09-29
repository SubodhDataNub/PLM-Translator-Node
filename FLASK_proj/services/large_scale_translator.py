"""
Large Scale Translation Service
Handles mass translation with optimization for large datasets (1M+ records)
"""
import asyncio
import aiohttp
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
import time
import uuid
from datetime import datetime
import json
import os
from pathlib import Path
from FLASK_proj.services.translator import translator_service
from FLASK_proj.config import AzureTranslatorConfig


class LargeScaleTranslator:
    """Service for handling large scale translations with optimization"""
    
    def __init__(self, chunk_size=None, max_workers=None, batch_size=None, max_retries=None):
        self.chunk_size = chunk_size if chunk_size is not None else int(os.getenv("LST_CHUNK_SIZE", 1000))  # Process in chunks of 1000 records
        self.max_workers = max_workers if max_workers is not None else int(os.getenv("LST_MAX_WORKERS", 10))   # Maximum concurrent threads
        self.batch_size = batch_size if batch_size is not None else int(os.getenv("LST_BATCH_SIZE", 25))    # Azure API batch size
        self.max_retries = max_retries if max_retries is not None else int(os.getenv("LST_MAX_RETRIES", 3))    # Retry failed translations
        
    def estimate_processing_time(self, record_count, language_count=1):
        """Estimate processing time for given number of records"""
        # Rough estimation: 1000 records per minute with optimization
        estimated_minutes = (record_count * language_count) / 1000
        return {
            'estimated_minutes': estimated_minutes,
            'estimated_hours': estimated_minutes / 60,
            'record_count': record_count,
            'language_count': language_count,
            'recommendation': self._get_processing_recommendation(record_count, language_count)
        }
    
    def _get_processing_recommendation(self, record_count, language_count=1):
        """Get processing recommendation based on record count and language count"""
        total_translations = record_count * language_count
        
        if total_translations <= 1000:
            return f"Standard processing - should complete in under 5 minutes ({language_count} language{'s' if language_count > 1 else ''})"
        elif total_translations <= 10000:
            return f"Medium dataset - estimated 10-50 minutes for {record_count} records × {language_count} language{'s' if language_count > 1 else ''}, use background processing"
        elif total_translations <= 100000:
            return f"Large dataset - estimated 1-8 hours for {record_count} records × {language_count} language{'s' if language_count > 1 else ''}, use chunked processing with progress tracking"
        else:
            return f"Very large dataset - estimated 8+ hours for {record_count} records × {language_count} language{'s' if language_count > 1 else ''}, consider splitting into smaller files"
    
    async def translate_batch_async(self, texts, target_language, session):
        """Translate a batch of texts asynchronously"""
        if not AzureTranslatorConfig.is_configured():
            # Use mock translations for testing
            return [{'text': f"[MOCK] {text} -> {target_language}"} for text in texts]
        
        try:
            url = f"{AzureTranslatorConfig.TRANSLATOR_ENDPOINT}/translator/text/v3.0/translate"
            params = {
                'api-version': '3.0',
                'to': target_language
            }
            
            headers = {
                'Ocp-Apim-Subscription-Key': AzureTranslatorConfig.TRANSLATOR_KEY,
                'Ocp-Apim-Subscription-Region': AzureTranslatorConfig.TRANSLATOR_REGION,
                'Content-Type': 'application/json'
            }
            
            body = [{'text': text} for text in texts]
            
            async with session.post(url, params=params, headers=headers, json=body) as response:
                if response.status == 200:
                    result = await response.json()
                    return [item['translations'][0] for item in result]
                else:
                    error_text = await response.text()
                    raise Exception(f"API Error {response.status}: {error_text}")
                    
        except Exception as e:
            # Fallback to individual translations for failed batches
            return await self._fallback_individual_translations(texts, target_language, session)
    
    async def _fallback_individual_translations(self, texts, target_language, session):
        """Fallback to individual translations when batch fails"""
        results = []
        for text in texts:
            try:
                result = translator_service.translate_text(text, target_language)
                if result['success']:
                    results.append({'text': result['translated_text']})
                else:
                    results.append({'text': f"[ERROR] {result.get('error', 'Translation failed')}"})
            except Exception as e:
                results.append({'text': f"[ERROR] {str(e)}"})
        return results
    
    def process_large_dataset_chunked(self, df, target_languages, progress_callback=None, 
                                    output_dir=None, session_id=None):
        """Process large dataset in chunks with progress tracking"""
        if session_id is None:
            session_id = str(uuid.uuid4())
        
        if output_dir is None:
            output_dir = Path("temp_translations")
            output_dir.mkdir(exist_ok=True)
        
        total_rows = len(df)
        total_chunks = (total_rows + self.chunk_size - 1) // self.chunk_size
        
        # Process in chunks
        processed_chunks = []
        for chunk_idx in range(total_chunks):
            start_idx = chunk_idx * self.chunk_size
            end_idx = min(start_idx + self.chunk_size, total_rows)
            
            chunk_df = df.iloc[start_idx:end_idx].copy()
            
            # Process this chunk
            chunk_result = self._process_chunk(chunk_df, target_languages, chunk_idx, start_row_offset=start_idx)
            
            # Save chunk results to disk
            chunk_file = output_dir / f"chunk_{chunk_idx}_{session_id}.json"
            with open(chunk_file, 'w', encoding='utf-8') as f:
                json.dump(chunk_result, f, ensure_ascii=False, indent=2)
            
            processed_chunks.append(chunk_file)
            
            # Progress callback
            if progress_callback:
                progress = {
                    'session_id': session_id,
                    'chunk': chunk_idx + 1,
                    'total_chunks': total_chunks,
                    'rows_processed': end_idx,
                    'total_rows': total_rows,
                    'progress_percent': round((end_idx / total_rows) * 100, 2),
                    'estimated_time_remaining': self._estimate_remaining_time(
                        chunk_idx + 1, total_chunks, time.time()
                    )
                }
                progress_callback(progress)
        
        return {
            'session_id': session_id,
            'total_chunks': total_chunks,
            'total_rows': total_rows,
            'chunk_files': [str(f) for f in processed_chunks],
            'output_dir': str(output_dir),
            'completed_at': datetime.now().isoformat()
        }
    
    def _process_chunk(self, chunk_df, target_languages, chunk_idx, start_row_offset=0):
        """Process a single chunk of data"""
        # Get text column
        text_column = self._get_text_column(chunk_df)
        
        # Check for description column
        description_column = None
        possible_description_columns = ['description', 'Description', 'DESCRIPTION', 'desc', 'Desc', 'notes', 'Notes']
        
        for col in possible_description_columns:
            if col in chunk_df.columns and col != text_column:  # Make sure it's not the same as text column
                description_column = col
                break
        
        # Process each row in the chunk
        results = []
        for local_index, (index, row) in enumerate(chunk_df.iterrows()):
            global_row_num = start_row_offset + local_index + 1  # 1-based row number
            source_text = str(row[text_column]).strip()
            
            # Get description if available
            description = ''
            if description_column and description_column in row:
                description = str(row[description_column]).strip()
                if description.lower() in ['nan', 'none', '']:
                    description = ''
            
            if not source_text or source_text.lower() in ['nan', 'none', '']:
                results.append({
                    'index': index,
                    'row': global_row_num,
                    'source_text': source_text,
                    'description': description,
                    'translations': {},
                    'success': False,
                    'error': 'Empty or invalid text'
                })
                continue
            
            # Translate to all target languages
            translations = {}
            for target_language in target_languages:
                try:
                    result = translator_service.translate_text(source_text, target_language)
                    if result['success']:
                        translations[target_language] = result['translated_text']
                    else:
                        translations[target_language] = f"[ERROR] {result.get('error', 'Failed')}"
                except Exception as e:
                    translations[target_language] = f"[ERROR] {str(e)}"
            
            results.append({
                'index': index,
                'row': global_row_num,
                'source_text': source_text,
                'description': description,
                'translations': translations,
                'success': bool(translations),
                'timestamp': datetime.now().isoformat()
            })
        
        return results
    
    def _get_text_column(self, df):
        """Get the text column from DataFrame"""
        possible_text_columns = ['text', 'Text', 'TEXT', 'content', 'Content', 'CONTENT', 
                               'message', 'Message', 'MESSAGE', 'description', 'Description']
        
        for col in possible_text_columns:
            if col in df.columns:
                return col
        
        # Use first column if no standard text column found
        return df.columns[0]
    
    def _estimate_remaining_time(self, completed_chunks, total_chunks, start_time):
        """Estimate remaining processing time"""
        if completed_chunks == 0:
            return "Calculating..."
        
        elapsed_time = time.time() - start_time
        time_per_chunk = elapsed_time / completed_chunks
        remaining_chunks = total_chunks - completed_chunks
        remaining_seconds = remaining_chunks * time_per_chunk
        
        if remaining_seconds < 60:
            return f"{int(remaining_seconds)} seconds"
        elif remaining_seconds < 3600:
            return f"{int(remaining_seconds / 60)} minutes"
        else:
            return f"{round(remaining_seconds / 3600, 1)} hours"
    
    def combine_chunk_results(self, chunk_files):
        """Combine results from all processed chunks"""
        all_results = []
        
        for chunk_file in chunk_files:
            try:
                with open(chunk_file, 'r', encoding='utf-8') as f:
                    chunk_data = json.load(f)
                    all_results.extend(chunk_data)
            except Exception as e:
                pass  # Silently continue on error
        
        return all_results
    
    def cleanup_temp_files(self, output_dir, session_id):
        """Clean up temporary chunk files"""
        try:
            output_path = Path(output_dir)
            if output_path.exists():
                for file in output_path.glob(f"chunk_*_{session_id}.json"):
                    file.unlink()
                    
                # Remove directory if empty
                if not any(output_path.iterdir()):
                    output_path.rmdir()
                    
        except Exception as e:
            pass  # Silently continue on error
    
    def validate_large_file(self, file_path):
        """Validate large Excel file before processing"""
        sample_df = None
        full_df = None
        
        try:
            # Read only first few rows to check structure
            with pd.ExcelFile(file_path) as excel_file:
                sample_df = pd.read_excel(excel_file, nrows=5)
            
            # Get file size
            file_size_mb = os.path.getsize(file_path) / (1024 * 1024)
            
            # Count total rows (this might be slow for very large files)
            total_rows = "Unknown"
            try:
                with pd.ExcelFile(file_path) as excel_file:
                    full_df = pd.read_excel(excel_file)
                    total_rows = len(full_df)
                    del full_df  # Free memory immediately
                    full_df = None
            except MemoryError:
                # File too large to load fully
                total_rows = "Unknown (file too large - MemoryError encountered)"
            except Exception as e:
                total_rows = "Unknown (error reading file)"
            
            text_column = self._get_text_column(sample_df)
            
            # Convert sample data to dict and handle NaN values for JSON serialization
            sample_data = sample_df.head(3).fillna('').to_dict('records')
            
            return {
                'success': True,
                'file_size_mb': round(file_size_mb, 2),
                'total_rows': total_rows,
                'columns': list(sample_df.columns),
                'text_column': text_column,
                'sample_data': sample_data,
                'recommendations': self._get_file_recommendations(total_rows, file_size_mb)
            }
            
        except Exception as e:
            return {
                'success': False,
                'error': str(e)
            }
        finally:
            # Ensure DataFrames are cleaned up
            if sample_df is not None:
                del sample_df
            if full_df is not None:
                del full_df
            # Force garbage collection to release file handles
            import gc
            gc.collect()
    
    def _get_file_recommendations(self, total_rows, file_size_mb):
        """Get recommendations for processing large files"""
        recommendations = []
        
        if isinstance(total_rows, int):
            if total_rows > 100000:
                recommendations.append("Consider using chunked processing for better performance")
                recommendations.append("Enable progress tracking to monitor translation status")
                
            if total_rows > 500000:
                recommendations.append("Very large dataset - processing may take several hours")
                recommendations.append("Consider splitting file into smaller chunks for parallel processing")
                
            if total_rows > 1000000:
                recommendations.append("Extremely large dataset - use background processing")
                recommendations.append("Consider processing during off-peak hours")
        
        if file_size_mb > 50:
            recommendations.append("Large file size - ensure sufficient disk space for temporary files")
            
        if file_size_mb > 100:
            recommendations.append("Very large file - consider using streaming processing")
        
        if not recommendations:
            recommendations.append("File size is optimal for standard processing")
        
        return recommendations


# Global instance
large_scale_translator = LargeScaleTranslator()