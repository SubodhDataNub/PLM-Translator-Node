#!/bin/bash
# Azure App Service startup script for DN Translator
# Uses gunicorn configuration file with optimized settings

gunicorn run:app --config gunicorn_config.py