@echo off
setlocal EnableDelayedExpansion

REM Dalinar — Full workspace setup (Windows)
REM Initializes submodules, dependencies, memory pack, skills, and agent configs.
REM Idempotent — safe to re-run at any time.
REM Requires: git, bun, and admin/developer mode for symlinks.

set "SCRIPT_DIR=%~dp0"
set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"
cd /d "%SCRIPT_DIR%"

set "CLAUDE_GLOBAL=%USERPROFILE%\.claude"
set "CLAUDE_PROJECT=%SCRIPT_DIR%\.claude"
set "OPENCODE_DIR=%SCRIPT_DIR%\.opencode"
set "SKILLS_DIR=%SCRIPT_DIR%\skills"
set "JASNAH_DIR=%SCRIPT_DIR%\modules\jasnah"
set "SAZED_DIR=%SCRIPT_DIR%\modules\sazed"
set "HOID_DIR=%SCRIPT_DIR%\modules\hoid"
set "MEMORY_DIR=%SCRIPT_DIR%\.memory"

REM ── 1. Git submodules ──────────────────────────────────────────

echo.
echo ==^> Initializing git submodules

if not exist "%JASNAH_DIR%\package.json" (
    git submodule update --init --recursive
    echo   [ok] Submodules initialized
) else (
    echo   [skip] Submodules already initialized
)

REM ── 2. Dependencies ─────────────────────────────────────────────

echo.
echo ==^> Installing dependencies

call bun install
echo   [ok] bun install complete

REM ── 3. Jasnah memory pack ───────────────────────────────────────

echo.
echo ==^> Setting up Jasnah memory pack

for %%D in (decisions insights facts architecture domain-facts api-contracts glossary lessons-learned locks) do (
    if not exist "%MEMORY_DIR%\%%D" mkdir "%MEMORY_DIR%\%%D"
)
echo   [ok] .memory directories created

if not exist "%MEMORY_DIR%\config.yaml" (
    copy "%JASNAH_DIR%\config\config.yaml.template" "%MEMORY_DIR%\config.yaml" >nul
    echo   [ok] Memory config created
) else (
    echo   [skip] Memory config already exists
)

REM ── 4. LanceDB vector store ─────────────────────────────────────

echo.
echo ==^> Setting up LanceDB local vector store

if not exist "%MEMORY_DIR%\.vectors" mkdir "%MEMORY_DIR%\.vectors"
echo   [ok] .vectors directory created

set "JASNAH_SYNC=%JASNAH_DIR%\scripts\sync-vector.ts"
if exist "%JASNAH_SYNC%" (
    echo   Running initial vector sync (downloads embedding model on first run ~23 MB^)...
    bun run "%JASNAH_SYNC%" --root "%SCRIPT_DIR%"
    echo   [ok] Vector sync complete
) else (
    echo   [warn] sync-vector.ts not found — skipping vector sync
)

REM ── 5. OpenCode plugins ^& commands ──────────────────────────────

echo.
echo ==^> Setting up OpenCode integration

if not exist "%OPENCODE_DIR%\plugins" mkdir "%OPENCODE_DIR%\plugins"
if not exist "%OPENCODE_DIR%\commands" mkdir "%OPENCODE_DIR%\commands"

REM Use mklink for symlinks (requires developer mode or admin)
if not exist "%OPENCODE_DIR%\plugins\jasnah-memory-extractor.ts" (
    mklink "%OPENCODE_DIR%\plugins\jasnah-memory-extractor.ts" "%JASNAH_DIR%\.opencode\plugins\memory-extractor.ts" >nul 2>&1
    if !errorlevel! neq 0 (
        copy "%JASNAH_DIR%\.opencode\plugins\memory-extractor.ts" "%OPENCODE_DIR%\plugins\jasnah-memory-extractor.ts" >nul
        echo   [ok] Copied plugin (symlink not available — enable Developer Mode)
    ) else (
        echo   [ok] Symlinked plugin
    )
) else (
    echo   [skip] OpenCode plugin already exists
)

if not exist "%OPENCODE_DIR%\commands\extract-memory.md" (
    mklink "%OPENCODE_DIR%\commands\extract-memory.md" "%JASNAH_DIR%\.opencode\commands\extract-memory.md" >nul 2>&1
    if !errorlevel! neq 0 (
        copy "%JASNAH_DIR%\.opencode\commands\extract-memory.md" "%OPENCODE_DIR%\commands\extract-memory.md" >nul
        echo   [ok] Copied command (symlink not available)
    ) else (
        echo   [ok] Symlinked command
    )
) else (
    echo   [skip] OpenCode command already exists
)

REM ── 5. Project skills ───────────────────────────────────────────

echo.
echo ==^> Linking project skills

if not exist "%SKILLS_DIR%" mkdir "%SKILLS_DIR%"

for %%S in (jasnah-debug-trace jasnah-query jasnah-search-memory jasnah-export-memory) do (
    if exist "%JASNAH_DIR%\skills\%%S" (
        if not exist "%SKILLS_DIR%\%%S" (
            mklink /D "%SKILLS_DIR%\%%S" "%JASNAH_DIR%\skills\%%S" >nul 2>&1
            if !errorlevel! neq 0 (
                xcopy /E /I /Q "%JASNAH_DIR%\skills\%%S" "%SKILLS_DIR%\%%S" >nul
                echo   [ok] Copied skill %%S
            ) else (
                echo   [ok] Symlinked skill %%S
            )
        ) else (
            echo   [skip] Skill %%S
        )
    )
)

REM ── 6. Global Claude Code skills ────────────────────────────────

echo.
echo ==^> Linking global Claude Code skills

set "GLOBAL_SKILLS=%CLAUDE_GLOBAL%\skills"
if not exist "%GLOBAL_SKILLS%" mkdir "%GLOBAL_SKILLS%"

for %%S in (calendar dialectic jira) do (
    if exist "%SKILLS_DIR%\%%S" (
        if not exist "%GLOBAL_SKILLS%\%%S" (
            mklink /D "%GLOBAL_SKILLS%\%%S" "%SKILLS_DIR%\%%S" >nul 2>&1
            if !errorlevel! neq 0 (
                xcopy /E /I /Q "%SKILLS_DIR%\%%S" "%GLOBAL_SKILLS%\%%S" >nul
                echo   [ok] Copied global skill %%S
            ) else (
                echo   [ok] Symlinked global skill %%S
            )
        ) else (
            echo   [skip] Global skill %%S
        )
    )
)

REM ── 7. Environment file ─────────────────────────────────────────

echo.
echo ==^> Checking environment files

if not exist "%SCRIPT_DIR%\.env" (
    if exist "%SCRIPT_DIR%\.env.example" (
        copy "%SCRIPT_DIR%\.env.example" "%SCRIPT_DIR%\.env" >nul
        echo   [ok] Created .env from template — edit it with your credentials
    )
) else (
    echo   [skip] .env file
)

REM ── 8. Hoid calendar config ─────────────────────────────────────

echo.
echo ==^> Checking Hoid calendar config

set "HOID_CONFIG_DIR=%APPDATA%\hoid"
set "HOID_CONFIG=%HOID_CONFIG_DIR%\hoid.config.json"

if not exist "%HOID_CONFIG%" (
    if not exist "%HOID_CONFIG_DIR%" mkdir "%HOID_CONFIG_DIR%"
    copy "%HOID_DIR%\config\hoid.config.example.json" "%HOID_CONFIG%" >nul
    echo   [ok] Created Hoid config — edit with your account details
) else (
    echo   [skip] Hoid config
)

REM ── Summary ─────────────────────────────────────────────────────

echo.
echo ========================================
echo   Dalinar workspace setup complete
echo ========================================
echo.
echo   Next steps:
echo     1. Edit .env with your API keys (ANTHROPIC_API_KEY, JIRA_*, etc.)
echo     2. For GitHub Copilot LLM: bunx @mariozechner/pi-ai login github-copilot
echo     3. For Google Calendar:    bun run modules\hoid\install.sh (WSL/Git Bash)
echo     4. Edit %HOID_CONFIG% with your calendar accounts
echo     5. Set JASNAH_ROOT=%JASNAH_DIR% in your environment variables
echo.

endlocal
