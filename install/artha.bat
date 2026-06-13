@echo off
setlocal enabledelayedexpansion
REM ====================================================================
REM  Artha - self-host control script (Windows).
REM
REM    artha.bat install     pull the image + start Artha (first time)
REM    artha.bat start       start a stopped Artha
REM    artha.bat stop        stop Artha (data is kept)
REM    artha.bat restart     restart Artha
REM    artha.bat status      show whether Artha is running
REM    artha.bat logs        show the logs (Ctrl-C to quit)
REM    artha.bat update      pull the latest image + recreate (data kept)
REM    artha.bat backup      save a database backup to %USERPROFILE%\artha-backups
REM    artha.bat uninstall   remove the container (data volume KEPT)
REM
REM  Override defaults with env vars, e.g.:  set ARTHA_PORT=8080 ^& artha.bat install
REM ====================================================================

REM --- defaults (override by setting ARTHA_* env vars before running) ---
set "IMAGE=ghcr.io/beedev/pfd-saas:latest"
if defined ARTHA_IMAGE set "IMAGE=%ARTHA_IMAGE%"
set "NAME=artha"
if defined ARTHA_NAME set "NAME=%ARTHA_NAME%"
set "PORT=9999"
if defined ARTHA_PORT set "PORT=%ARTHA_PORT%"
set "VOLUME=artha-data"
if defined ARTHA_VOLUME set "VOLUME=%ARTHA_VOLUME%"
set "OWNER="
if defined ARTHA_OWNER set "OWNER=%ARTHA_OWNER%"
set "BACKUP_DIR=%USERPROFILE%\artha-backups"
if defined ARTHA_BACKUP_DIR set "BACKUP_DIR=%ARTHA_BACKUP_DIR%"

set "CMD=%~1"
if /i "%CMD%"=="install"   goto install
if /i "%CMD%"=="start"     goto start
if /i "%CMD%"=="stop"      goto stop
if /i "%CMD%"=="restart"   goto restart
if /i "%CMD%"=="status"    goto status
if /i "%CMD%"=="logs"      goto logs
if /i "%CMD%"=="update"    goto update
if /i "%CMD%"=="backup"    goto backup
if /i "%CMD%"=="uninstall" goto uninstall
goto usage

:install
call :needdocker || exit /b 1
if not defined OWNER set /p "OWNER=Your name (shows as ^<name^>'s Artha; blank for plain Artha): "
echo Pulling %IMAGE% (first run is a one-time ~600 MB download)...
docker pull %IMAGE% || exit /b 1
call :runcontainer
call :waithealthy
echo.
echo Artha is running - http://localhost:%PORT%
echo    Next: open it, choose "Personal", then Settings -^> Personalize / Telegram.
echo    See README.md Step 3 onwards.
goto :eof

:start
call :needdocker || exit /b 1
docker start %NAME% >nul && echo Started - http://localhost:%PORT%
goto :eof

:stop
docker stop %NAME% >nul && echo Stopped (data kept).
goto :eof

:restart
call :needdocker || exit /b 1
docker restart %NAME% >nul && echo Restarted - http://localhost:%PORT%
goto :eof

:status
docker ps -a --filter "name=^/%NAME%$" --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
goto :eof

:logs
docker logs -f %NAME%
goto :eof

:update
call :needdocker || exit /b 1
echo Pulling the latest image...
docker pull %IMAGE% || exit /b 1
call :runcontainer
call :waithealthy
echo Updated. Your data (volume %VOLUME%) is preserved.
goto :eof

:backup
call :needdocker || exit /b 1
if not exist "%BACKUP_DIR%" mkdir "%BACKUP_DIR%"
for /f %%t in ('powershell -NoProfile -Command "Get-Date -Format yyyyMMdd-HHmmss"') do set "TS=%%t"
set "OUT=%BACKUP_DIR%\artha-db-!TS!.dump"
docker exec %NAME% sh -c "PGPASSWORD=$(cat /data/.secrets/postgres_password) su-exec postgres pg_dump -Fc -h 127.0.0.1 -U pfd_saas -d pfd_saas -f /tmp/artha-backup.dump" || exit /b 1
docker cp "%NAME%:/tmp/artha-backup.dump" "!OUT!"
docker exec %NAME% rm -f /tmp/artha-backup.dump
echo Backup saved - !OUT!
echo    (Tip: also export from the app - Settings -^> Data portability -^> Download JSON.)
goto :eof

:uninstall
docker rm -f %NAME% >nul 2>&1
echo Container removed. Your data volume %VOLUME% is KEPT.
echo To delete your data too (irreversible): docker volume rm %VOLUME%
goto :eof

:usage
echo Artha - usage: artha.bat {install ^| start ^| stop ^| restart ^| status ^| logs ^| update ^| backup ^| uninstall}
exit /b 1

REM ---------------------- helpers (called) ----------------------------
:needdocker
where docker >nul 2>&1 || (echo X Docker is not installed. See README.md - Step 1 ^(Install Docker^). & exit /b 1)
docker info >nul 2>&1 || (echo X Docker is installed but not running. Start Docker Desktop, then retry. & exit /b 1)
exit /b 0

:runcontainer
docker rm -f %NAME% >nul 2>&1
if defined OWNER (
  docker run -d --name %NAME% --restart unless-stopped -p %PORT%:3000 -v %VOLUME%:/data -e AUTH_URL=http://localhost:%PORT% -e DEMO_PERSONAL_SWITCH=true -e APP_OWNER=%OWNER% %IMAGE% >nul
) else (
  docker run -d --name %NAME% --restart unless-stopped -p %PORT%:3000 -v %VOLUME%:/data -e AUTH_URL=http://localhost:%PORT% -e DEMO_PERSONAL_SWITCH=true %IMAGE% >nul
)
exit /b 0

:waithealthy
echo Waiting for Artha to start...
for /l %%i in (1,1,45) do (
  curl -fsS http://localhost:%PORT%/api/health >nul 2>&1 && (echo    ready & exit /b 0)
  timeout /t 2 >nul
)
echo ! Not healthy yet - check: artha.bat logs
exit /b 0
