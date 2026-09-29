"""
Azure Translator service module.
Handles Microsoft Azure Translator API calls and language operations.
"""
import requests
import time
from FLASK_proj.config import AzureTranslatorConfig


class TranslatorService:
    """Service class to handle Microsoft Azure Translator API calls"""
    
    def __init__(self):
        self.subscription_key = AzureTranslatorConfig.TRANSLATOR_KEY
        self.endpoint = AzureTranslatorConfig.TRANSLATOR_ENDPOINT
        self.region = AzureTranslatorConfig.TRANSLATOR_REGION
        self.languages_cache = None
    
    def get_supported_languages(self):
        """Get list of supported languages from Microsoft Translator API"""
        if self.languages_cache:
            return self.languages_cache
            
        try:
            url = "https://api.cognitive.microsofttranslator.com/languages?api-version=3.0&scope=translation"
            headers = {
                'Accept': 'application/json'
            }
            
            response = requests.get(url, headers=headers, timeout=10)
            response.raise_for_status()
            
            data = response.json()
            
            if 'translation' in data:
                # Convert to list format for frontend
                languages = [{"key": "", "text": "Select Target Language"}]
                for key, value in data['translation'].items():
                    languages.append({
                        "key": key,
                        "text": value.get('name', key)
                    })
                # Sort by name
                languages[1:] = sorted(languages[1:], key=lambda x: x['text'])
                self.languages_cache = languages
                return languages
            else:
                raise Exception("Invalid API response structure")
                
        except Exception as e:
            # Return fallback languages
            return self._get_fallback_languages()
    
    def _get_fallback_languages(self):
        """Fallback languages list when API is unavailable"""
        return [
            {"key": "", "text": "Select Target Language"},
            {"key": "ar", "text": "Arabic"},
            {"key": "zh", "text": "Chinese (Simplified)"},
            {"key": "da", "text": "Danish"},
            {"key": "nl", "text": "Dutch"},
            {"key": "fi", "text": "Finnish"},
            {"key": "fr", "text": "French"},
            {"key": "de", "text": "German"},
            {"key": "hi", "text": "Hindi"},
            {"key": "it", "text": "Italian"},
            {"key": "ja", "text": "Japanese"},
            {"key": "ko", "text": "Korean"},
            {"key": "no", "text": "Norwegian"},
            {"key": "pl", "text": "Polish"},
            {"key": "pt", "text": "Portuguese"},
            {"key": "ru", "text": "Russian"},
            {"key": "es", "text": "Spanish"},
            {"key": "sv", "text": "Swedish"},
            {"key": "th", "text": "Thai"},
            {"key": "tr", "text": "Turkish"}
        ]
    
    def translate_text(self, text, target_language):
        """Translate text using Azure Translator API"""
        if not AzureTranslatorConfig.is_configured():
            return {
                'success': False,
                'error': 'Azure Translator service is not configured. Please set the required environment variables.'
            }
        
        try:
            url = f"{self.endpoint}/translator/text/v3.0/translate"
            params = {
                'api-version': '3.0',
                'to': target_language
            }
            
            headers = {
                'Ocp-Apim-Subscription-Key': self.subscription_key,
                'Ocp-Apim-Subscription-Region': self.region,
                'Content-Type': 'application/json'
            }
            
            body = [{'text': text}]
            
            response = requests.post(url, params=params, headers=headers, json=body, timeout=30)
            response.raise_for_status()
            
            result = response.json()
            
            if result and len(result) > 0 and 'translations' in result[0]:
                translated_text = result[0]['translations'][0]['text']
                return {
                    'success': True,
                    'translated_text': translated_text,
                    'source_language': result[0].get('detectedLanguage', {}).get('language', 'auto'),
                    'target_language': target_language
                }
            else:
                raise Exception("Invalid translation response")
                
        except requests.exceptions.Timeout:
            return {
                'success': False,
                'error': 'Translation request timed out. Please try again.'
            }
        except requests.exceptions.RequestException as e:
            return {
                'success': False,
                'error': f'Translation service error: {str(e)}'
            }
        except Exception as e:
            return {
                'success': False,
                'error': f'Translation failed: {str(e)}'
            }
    
    def translate_batch(self, texts, target_language, max_batch_size=50):
        """Translate multiple texts in batches using Azure Translator API
        
        Azure Translator Rate Limits:
        - Free Tier (F0): 2M characters/month, 2 requests/second
        - Standard Tier (S1): 40M characters/month, 10 requests/second
        
        Args:
            texts: List of strings to translate
            target_language: Target language code
            max_batch_size: Maximum texts per API call (default 50, Azure max 100)
            
        Returns:
            List of translation results
        """
        if not AzureTranslatorConfig.is_configured():
            return [{
                'success': False,
                'error': 'Azure Translator service is not configured.',
                'translated_text': ''
            }] * len(texts)
        
        if not texts:
            return []
        
        all_results = []
        
        try:
            url = f"{self.endpoint}/translator/text/v3.0/translate"
            params = {
                'api-version': '3.0',
                'to': target_language
            }
            
            headers = {
                'Ocp-Apim-Subscription-Key': self.subscription_key,
                'Ocp-Apim-Subscription-Region': self.region,
                'Content-Type': 'application/json'
            }
            
            # Rate limiting configuration
            # Conservative approach: 1 request per second to avoid 429 errors
            REQUEST_DELAY = 1.0  # 1 second between batches
            MAX_RETRIES = 5
            
            # Process in batches with aggressive rate limiting
            batch_count = 0
            total_batches = (len(texts) + max_batch_size - 1) // max_batch_size
            
            print(f"Processing {len(texts)} texts in {total_batches} batches of up to {max_batch_size} texts each")
            
            for i in range(0, len(texts), max_batch_size):
                batch = texts[i:i + max_batch_size]
                batch_num = batch_count + 1
                
                # Calculate character count for logging
                char_count = sum(len(text) for text in batch)
                print(f"Batch {batch_num}/{total_batches}: {len(batch)} texts, {char_count} characters")
                
                # Add delay between batches to respect rate limits
                # Wait BEFORE sending (except for first batch)
                if batch_count > 0:
                    print(f"Waiting {REQUEST_DELAY} seconds before next batch...")
                    time.sleep(REQUEST_DELAY)
                
                batch_count += 1
                
                # Prepare batch request body
                body = [{'text': text} for text in batch]
                
                retry_count = 0
                
                while retry_count < MAX_RETRIES:
                    try:
                        response = requests.post(url, params=params, headers=headers, json=body, timeout=60)
                        
                        # Handle rate limiting with exponential backoff
                        if response.status_code == 429:
                            retry_count += 1
                            if retry_count < MAX_RETRIES:
                                # Exponential backoff: 5, 10, 20, 40, 80 seconds
                                wait_time = 5 * (2 ** (retry_count - 1))
                                print(f"Rate limit hit! Retry {retry_count}/{MAX_RETRIES} after {wait_time} seconds...")
                                time.sleep(wait_time)
                                continue
                            else:
                                # Max retries reached, return error for this batch
                                print(f"Max retries reached for batch {batch_num}. Marking as failed.")
                                for text in batch:
                                    all_results.append({
                                        'success': False,
                                        'error': 'Rate limit exceeded after multiple retries. Please reduce batch size or wait before retrying.',
                                        'translated_text': '',
                                        'original_text': text
                                    })
                                break
                        
                        response.raise_for_status()
                        
                        result = response.json()
                        
                        # Process batch results
                        for idx, translation_result in enumerate(result):
                            if 'translations' in translation_result and len(translation_result['translations']) > 0:
                                all_results.append({
                                    'success': True,
                                    'translated_text': translation_result['translations'][0]['text'],
                                    'source_language': translation_result.get('detectedLanguage', {}).get('language', 'auto'),
                                    'target_language': target_language,
                                    'original_text': batch[idx]
                                })
                            else:
                                all_results.append({
                                    'success': False,
                                    'error': 'Invalid translation response',
                                    'translated_text': '',
                                    'original_text': batch[idx]
                                })
                        
                        print(f"Batch {batch_num}/{total_batches} completed successfully")
                        break  # Success, exit retry loop
                            
                    except requests.exceptions.Timeout:
                        # Handle timeout for this batch
                        print(f"Timeout error for batch {batch_num}")
                        for text in batch:
                            all_results.append({
                                'success': False,
                                'error': 'Translation request timed out',
                                'translated_text': '',
                                'original_text': text
                            })
                        break
                            
                    except requests.exceptions.RequestException as e:
                        # Handle request error for this batch
                        error_msg = str(e)
                        print(f"Request error for batch {batch_num}: {error_msg}")
                        
                        if '429' in error_msg or 'Too Many Requests' in error_msg:
                            retry_count += 1
                            if retry_count < MAX_RETRIES:
                                wait_time = 5 * (2 ** (retry_count - 1))
                                print(f"Rate limit detected. Retry {retry_count}/{MAX_RETRIES} after {wait_time} seconds...")
                                time.sleep(wait_time)
                                continue
                        
                        for text in batch:
                            all_results.append({
                                'success': False,
                                'error': f'Translation service error: {error_msg}',
                                'translated_text': '',
                                'original_text': text
                            })
                        break
                        
        except Exception as e:
            # Handle unexpected errors
            print(f"Unexpected error in translate_batch: {str(e)}")
            for text in texts:
                all_results.append({
                    'success': False,
                    'error': f'Translation failed: {str(e)}',
                    'translated_text': '',
                    'original_text': text
                })
        
        return all_results


# Global translator service instance
translator_service = TranslatorService()