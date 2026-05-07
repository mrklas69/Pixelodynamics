# CLAUDE.md — Pixelodynamics

Projektové instrukce. Doplňují globální `~/.claude/CLAUDE.md`, nepřevažují.

## Makra

### `@BEGIN` — zahájení sezení

1. **Spustit dev server** (`npm run dev`) jako **detached proces**, který přežije ukončení bash sessions / Claude Code restartu. PID uložit do `.claude/dev-server.pid` (`.claude/` je v gitignore). Pokud PID file existuje a proces stále běží, přeskočit start. Po startu/detekci vypsat URL `http://localhost:5173/` jako klikací odkaz, aby si uživatel mohl scénu okamžitě otevřít.

   PowerShell idiom:
   ```powershell
   $pidFile = ".claude\dev-server.pid"
   New-Item -ItemType Directory -Force -Path .claude | Out-Null
   $running = $false
   if (Test-Path $pidFile) {
     $existingPid = Get-Content $pidFile -ErrorAction SilentlyContinue
     if ($existingPid -and (Get-Process -Id $existingPid -ErrorAction SilentlyContinue)) { $running = $true }
   }
   if (-not $running) {
     $proc = Start-Process -FilePath cmd -ArgumentList '/c','npm run dev' -WindowStyle Hidden -PassThru
     $proc.Id | Out-File $pidFile -Encoding ascii
   }
   ```

2. Přečíst stav: `TODO.md`, `DIARY.md`, dnešní `docs/diary/YYYY-MM-DD.md` (pokud existuje), `IDEAS.md`.
3. Zkontrolovat audit cadence (prahy v globální CLAUDE.md). Pokud práh překročen ≥ 2 sezení, hlásit `⚠ PŘEKROČEN — spustit jako první bod sezení.`
4. Zkontrolovat **Stale Příště** (≥ 5 sezení po sobě v sekci "Příště") → hlásit `⚠ Stale Příště (N sezení) — DO nebo DROP.`
5. Vyhodnotit otevřené body z minulého "Příště" a navrhnout, čím dnes začít.

### `@END` — uzavření sezení

1. `@DOCS` (refresh dokumentace dle globální CLAUDE.md) — DIARY, TODO, DONE, GLOSSARY, IDEAS, případně README/CLAUDE.
2. `npm run check` (svelte-check + tsc) — musí projít bez warnings.
3. Commit + push (pokud nejsou změny pending).
4. **Zastavit dev server.** Přečíst PID z `.claude/dev-server.pid`, ukončit celý strom přes `taskkill /PID <pid> /T /F`, smazat PID file.

   ```powershell
   $pidFile = ".claude\dev-server.pid"
   if (Test-Path $pidFile) {
     $existingPid = Get-Content $pidFile
     taskkill /PID $existingPid /T /F 2>$null
     Remove-Item $pidFile
   }
   ```
