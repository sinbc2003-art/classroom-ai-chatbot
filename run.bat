@echo off
cd /d "%~dp0"
title Classroom AI Chatbot Server

python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo [ERROR] Python is not found. Please install Python and add it to PATH.
    pause
    exit /b
)

echo Starting Classroom AI Chatbot Server...
python main.py

if %errorlevel% neq 0 (
    echo.
    echo [ERROR] Server terminated unexpectedly.
    pause
)
