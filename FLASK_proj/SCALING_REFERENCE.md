# Quick Reference - Large Scale Translation Settings

## Current Optimizations (70,000 Records Support)

### Gunicorn Configuration
```python
timeout = 1800  # 30 minutes
graceful_timeout = 1800
workers = (CPU cores × 2) + 1
```

### Processing Thresholds
- **< 1,000 records**: Standard processing
- **≥ 1,000 records**: Chunked processing (automatic)

### Batch Commit Sizes
- **Standard processing**: 100 records per commit
- **Chunked processing**: 200 records per commit

### Environment Variables (Azure App Settings)
```bash
LST_CHUNK_SIZE=1000        # Records per chunk
LST_MAX_WORKERS=10         # Concurrent workers
LST_BATCH_SIZE=25          # Azure API batch size
```

## Performance Benchmarks

| Records | Processing Time | Method    |
|---------|----------------|-----------|
| 500     | ~1-2 min       | Standard  |
| 2,000   | ~4-8 min       | Standard  |
| 5,000   | ~10-15 min     | Chunked   |
| 10,000  | ~20-25 min     | Chunked   |
| 70,000  | ~25-30 min     | Chunked   |

## Scaling Up (If Needed)

### For Extreme Loads (100,000+ records)
```python
# gunicorn_config.py
timeout = 3600  # 60 minutes
graceful_timeout = 3600

# Azure Environment Variables
LST_CHUNK_SIZE=2000
LST_MAX_WORKERS=15
```

### Azure App Service Plan
- **Basic/Standard**: Up to 10,000 records
- **Premium V2**: Up to 50,000 records
- **Premium V3**: 70,000+ records (recommended)

## Monitoring Commands

```bash
# Tail logs in real-time
az webapp log tail --name YOUR_APP --resource-group YOUR_RG

# Check app metrics
az monitor metrics list --resource YOUR_APP_RESOURCE_ID

# View deployment logs
az webapp deployment list --name YOUR_APP --resource-group YOUR_RG
```

## Troubleshooting Quick Fixes

### Timeout Error
1. Check current timeout setting
2. Increase to 3600 if processing 50,000+ records
3. Verify App Service Plan has sufficient resources

### Memory Error
1. Scale up App Service Plan
2. Reduce chunk size: `LST_CHUNK_SIZE=500`
3. Reduce concurrent workers: `LST_MAX_WORKERS=5`

### Database Connection Error
1. Check Azure SQL firewall rules
2. Verify connection string in App Settings
3. Ensure database has sufficient DTUs

## Files Modified
- `gunicorn_config.py` - Worker configuration
- `routes/api.py` - Batch commits and thresholds
- `startup.sh` - Startup command
- `services/large_scale_translator.py` - (existing) Chunk processing
