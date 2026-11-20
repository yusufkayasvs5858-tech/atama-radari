@echo off
set "GIT=C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe"

if "%~1"=="" (
    echo ========================================================
    echo  ATAMA RADARI: GITHUB PUSH YARDIMCISI
    echo ========================================================
    echo Ornek: https://github.com/kullanici-adiniz/atama-radari.git
    echo.
    set /p REPO_URL="GitHub Deponuzun URL adresini girin: "
) else (
    set "REPO_URL=%~1"
)

echo.
echo Depo baglaniyor: %REPO_URL%
"%GIT%" remote remove origin 2>nul
"%GIT%" remote add origin %REPO_URL%
"%GIT%" branch -M main

echo.
echo GitHub'a gonderiliyor (Push)...
"%GIT%" push -u origin main

if %ERRORLEVEL% EQU 0 (
    echo.
    echo [BASARILI] Projeniz basariyla GitHub'a pushlandi!
) else (
    echo.
    echo [HATA] Push islemi tamamlanamadi. Lutfen URL adresinizi ve GitHub yetkinizi kontrol edin.
)

pause
