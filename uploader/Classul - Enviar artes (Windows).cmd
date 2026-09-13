@echo off
title Classul - Enviador de artes
cd /d "%~dp0"
node classul-uploader.mjs
echo.
echo O enviador parou. Aperte uma tecla para fechar.
pause >nul
