# Azure App Service Deployment Guide - Large Scale Dataset Support

## Issue Fixed
**WORKER TIMEOUT** error during mass translation operations with datasets up to **70,000 records**.

## Optimizations for Large Datasets

### Performance Settings
- **Dataset Size**: Up to 70,000 records
- **Timeout**: 30 minutes (1800 seconds)
- **Batch Commits**: 100 records (standard) / 200 records (chunked)
- **Chunked Processing**: Triggered at 1,000+ records
- **Chunk Size**: 1,000 records per chunk

## Changes Made

### 1. Created `gunicorn_config.py`
- Increased worker timeout to **30 minutes (1800s)**
- Optimized worker configuration for Azure App Service
- Added graceful timeout handling
- Auto-scaled workers based on CPU cores

### 2. Updated `routes/api.py`
- Implemented **batch database commits** (100-200 records)
- Lowered chunked processing threshold to **1,000 records**
- Shared session_id for better tracking across all records
- Optimized for both standard and chunked processing methods

### 3. Updated `startup.sh`
- Now uses the gunicorn configuration file
- Ensures consistent deployment settings

## Azure App Service Configuration

### Required Settings in Azure Portal

1. **Navigate to**: Azure Portal → Your App Service → Configuration → General settings

2. **Startup Command**:
   ```bash
   gunicorn run:app --config gunicorn_config.py
   ```

3. **Application Settings** (Environment Variables):
   Add the following for optimal performance:
   ```
   SCM_DO_BUILD_DURING_DEPLOYMENT=true
   WEBSITE_HTTPLOGGING_RETENTION_DAYS=7
   LST_CHUNK_SIZE=1000
   LST_MAX_WORKERS=10
   LST_BATCH_SIZE=25
   ```

### Deployment Steps

1. **Push changes to your repository**:
   ```bash
   git add .
   git commit -m "Fix worker timeout with gunicorn config and batch commits"
   git push origin main
   ```

2. **Deploy to Azure**:
   - If using GitHub Actions/Azure DevOps: Push will trigger deployment
   - If using local Git: 
     ```bash
     git push azure main
     ```

3. **Verify deployment**:
   - Check deployment logs in Azure Portal → Deployment Center
   - Monitor application logs: Azure Portal → Log stream

### Testing the Fix

1. Navigate to your app's mass translation page
2. **Small Test** (500 rows): Upload and verify successful completion
3. **Medium Test** (2,000 rows): Monitor processing time (~2-5 minutes)
4. **Large Test** (10,000+ rows): Should use chunked processing automatically
5. Check Azure logs for successful completion without timeout errors

## Performance Expectations

| Records | Languages | Estimated Time | Processing Method |
|---------|-----------|----------------|-------------------|
| 500     | 3         | 1-2 min        | Standard          |
| 2,000   | 3         | 4-8 min        | Standard          |
| 5,000   | 3         | 10-15 min      | Chunked           |
| 10,000  | 3         | 20-25 min      | Chunked           |
| 70,000  | 1         | 25-30 min      | Chunked           |

**Note**: Times vary based on network latency and Azure Translator API response times.

## Performance Improvements

- **Batch Commits**: 100 records (standard) / 200 records (chunked) instead of all at once
- **Extended Timeout**: 30-minute timeout allows processing of up to 70,000 records
- **Lower Threshold**: Chunked processing starts at 1,000 records for better reliability
- **Optimized Workers**: Auto-scaled based on CPU cores
- **Memory Management**: Workers restart after 1,000 requests to prevent memory leaks
- **Shared Session ID**: Better tracking of all translations in a single batch

## Monitoring

### Check Logs
```bash
az webapp log tail --name YOUR_APP_NAME --resource-group YOUR_RESOURCE_GROUP
```

### Watch for Success Messages
- ✅ "Successfully saved XXX translation records to test results table"
- ✅ "Mass translation completed: XXX/XXX rows successful"
- ❌ No more "WORKER TIMEOUT" errors

## Rollback Plan

If issues occur, revert by changing startup command to:
```bash
gunicorn run:app --bind=0.0.0.0:8000 --timeout 600
```

## Additional Optimizations (Optional)

### For Very Large Datasets (50,000+ rows)

1. **Increase Timeout Further** (if needed):
   Edit `gunicorn_config.py`:
   ```python
   timeout = 3600  # 60 minutes for extreme cases
   graceful_timeout = 3600
   ```

2. **Increase Chunk Size**:
   Add to Azure Application Settings:
   ```
   LST_CHUNK_SIZE=2000
   ```

3. **Enable Application Insights**:
   - Monitor performance metrics
   - Track long-running requests
   - Identify bottlenecks

4. **Consider Premium Tier**:
   - More CPU and memory
   - Better for concurrent translations
   - Faster processing overall

5. **Database Connection Pooling**:
   Already configured in the application with SQLAlchemy

## Troubleshooting

### Still Getting Timeout?
1. **For 70,000 records**, increase timeout in `gunicorn_config.py`:
   ```python
   timeout = 3600  # 60 minutes
   graceful_timeout = 3600
   ```

2. **Increase chunk size** in Azure Application Settings:
   ```
   LST_CHUNK_SIZE=2000
   LST_MAX_WORKERS=15
   ```

3. Check database connection:
   - Ensure Azure SQL allows connections
   - Check firewall rules
   - Verify connection pool settings

4. Monitor resource usage:
   - CPU: Should be < 80%
   - Memory: Should be < 90%
   - If higher, consider scaling up App Service Plan

### Slow Performance?
1. Check network latency to translation API
2. Enable caching for repeated translations
3. Consider async processing for very large files

## Support
For issues, check application logs or contact support team.
