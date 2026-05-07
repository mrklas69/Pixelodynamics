# CLAUDE.md — Pixelodynamics

Projektové instrukce. Doplňují globální `~/.claude/CLAUDE.md`, nepřevažují.

## Makra

### `@BEGIN` — zahájení sezení

1. **Spustit dev server** (`npm run dev`) v backgroundu — uživatel chce vidět změny okamžitě, bez pinkání. Pokud server už běží, přeskočit.
2. Přečíst stav: `TODO.md`, `DIARY.md`, dnešní `docs/diary/YYYY-MM-DD.md` (pokud existuje), `IDEAS.md`.
3. Zkontrolovat audit cadence (prahy v globální CLAUDE.md). Pokud práh překročen ≥ 2 sezení, hlásit `⚠ PŘEKROČEN — spustit jako první bod sezení.`
4. Zkontrolovat **Stale Příště** (≥ 5 sezení po sobě v sekci "Příště") → hlásit `⚠ Stale Příště (N sezení) — DO nebo DROP.`
5. Vyhodnotit otevřené body z minulého "Příště" a navrhnout, čím dnes začít.

### `@END` — uzavření sezení

1. `@DOCS` (refresh dokumentace dle globální CLAUDE.md) — DIARY, TODO, DONE, GLOSSARY, IDEAS, případně README/CLAUDE.
2. `npm run check` (svelte-check + tsc) — musí projít bez warnings.
3. Commit + push (pokud nejsou změny pending).
4. Zastavit dev server, který `@BEGIN` spustil.
