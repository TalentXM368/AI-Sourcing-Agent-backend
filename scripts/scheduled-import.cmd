@echo off
REM Nightly resume import from Cloudinary (deterministic parsing, no LLM).
REM Each run processes the next batch from resume_import_items and stops after
REM IMPORT_LIMIT files or IMPORT_MAX_MINUTES, whichever comes first. Safe to re-run:
REM files already handled are never processed twice.
REM Register: schtasks /create /tn "SourcingXM Resume Import" /tr "\"%~f0\"" /sc daily /st 01:00
cd /d "%~dp0.."
if not exist logs mkdir logs
set NODE_OPTIONS=--max-old-space-size=2048
if "%IMPORT_LIMIT%"=="" set IMPORT_LIMIT=4000
if "%IMPORT_MAX_MINUTES%"=="" set IMPORT_MAX_MINUTES=180
echo ==== %DATE% %TIME% ==== >> logs\import.log
node --import tsx scripts/import-cloudinary.ts inventory >> logs\import.log 2>&1
node --import tsx scripts/import-cloudinary.ts retry-failed >> logs\import.log 2>&1
REM Re-parse anything imported by an older parser version (from stored text, no download)
node --import tsx scripts/import-cloudinary.ts refresh >> logs\import.log 2>&1
node --import tsx scripts/import-cloudinary.ts run --limit %IMPORT_LIMIT% --concurrency 4 --max-minutes %IMPORT_MAX_MINUTES% >> logs\import.log 2>&1
REM Finish any old-data re-parse batch left running (no-op when none)
node --import tsx scripts/run-recovery.ts resume >> logs\import.log 2>&1
