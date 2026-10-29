# ErvisioDrive — Design

Stile "Drive minimal": pulito, leggermente tondeggiante, ispirato a Google Drive, con la navigazione a rail di Discord.
Scelto in Variant Studio, round 004 A: shell di D, griglia di B come vista predefinita, lista di A a un clic.

## Struttura

- **Rail fisso (72px)**: logo, sezioni (Drive, Utenti, Token, Impostazioni, Guida), tile delle cartelle personali, "+" nuova cartella, anello dello spazio usato in fondo.
  - Gli elementi sono cerchi da 48px che diventano squircle (16px) in hover o quando attivi, con un indicatore a pillola a sinistra e un tooltip.
  - Le cartelle sono tile con iniziali e colore stabile (hash dello slug). Il lucchetto indica una cartella con accesso limitato.
- **Pannello cartelle (248px, comprimibile)**: pulsante "Nuovo" (Carica file / Nuova cartella), cartelle predefinite con conteggi, cartelle personalizzate con azioni in hover. Lo stato è salvato in `localStorage` (`drive-panel`).
- **Foglio contenuti**: titolo, ordinamento, toggle vista (lista / griglia / dettagli, salvato in `drive-view`).
- **Header**: la ricerca è a pillola (portal in `#shell-search`), poi lingua e menu account.
- La cartella attiva è nell'URL (`/?folder=slug`), quindi il rail può linkare le cartelle. `/?new=folder` apre la creazione.

## Token

Definiti in `app/globals.css` come canali RGB e mappati in `tailwind.config.ts` (`rgb(var(--x) / <alpha-value>)`).
Chiaro di default. Lo scuro si attiva con `prefers-color-scheme: dark` o `data-theme="dark"`.

| Token | Chiaro | Ruolo |
|---|---|---|
| `--backdrop` | 245 246 248 | sfondo app, rail e header |
| `--sheet` | 255 255 255 | foglio contenuti, pannelli, dialog |
| `--surface` / `-2` | 238 240 243 | campi, hover, fondo thumbnail |
| `--fg` | 31 32 35 | inchiostro (`text-ink`, alias `white`) |
| `--ink-dim` / `--ink-faint` | 75 79 85 / 103 108 115 | testo secondario / terziario |
| `--accent` | 201 80 11 | arancio ErvisioDrive: CTA, stato attivo |
| `--accent-soft` / `--accent-ink` | 253 232 218 / 122 46 0 | selezione morbida (panel-item attivo, badge) |
| `--danger` `--success` `--info` `--warn` `--media` | — | stati e tipi di file |

- **Alias di palette**: `white` = inchiostro, quindi `bg-white/5` è una tinta leggera in entrambi i temi. `orange` → accent, `rose`/`red` → danger, `emerald`/`green` → success, `blue` → info, `yellow` → warn. Così il codice esistente segue il tema senza riscritture.
- **Font**: Figtree (`next/font/google`, `--font-figtree`). I titoli usano peso 500, non bold.
- **Raggi**: `rounded-card` 12px (card, campi), `rounded-sheet` 16px (pannelli, foglio), dialog 24px, pulsanti e chip `rounded-full`.
- **Ombre**: `shadow-lift` (foglio, pannelli), `shadow-float` (popover, toast, FAB). Niente bordi pesanti: la separazione viene da sfondo, foglio e ombra leggera.

## Componenti (`@layer components` in globals.css)

`panel`, `field`, `primary-button` (pillola accent), `secondary-button`, `danger-button`, `icon-button` (cerchio 40px), `chip`/`chip.active`, `tab`, `avatar`, `status-badge`, `setting-row`.
Drive: `.rail-item`, `.panel-item` (`.active`, `.drop` per il drag&drop), `.new-button`, `.menu-popover`, `.search-pill`, `.view-toggle`, `.file-card`, `.folder-card`, `.drive-table`, `.drive-fab`, `.mobile-drawer`, `.app-dialog`.

**Stati**: hover = tinta `white/5–7`; attivo = `accent-soft` + `accent-ink`; focus visibile ad anello accent; drop target = bordo tratteggiato accent; azioni file visibili in hover e sempre accessibili via ⋮ "File actions".

## Limiti, quote e accesso (round 009 B "Interruttore Illimitato")

- **Spazio e limiti** (`LimitSettings.tsx`): una riga `.lim-row` per limite, raggruppate in Spazio / Caricamenti / Richieste / Statistiche. A destra c'è il segmentato `.seg`: «Usa .env» (solo spazio totale e dimensione file, valore mostrato in `.lim-env`), «Limite» (campo con unità), «Illimitato» (salva 0). Niente campi vuoti con significati nascosti.
- **Utenti e accessi**: card `.member-card` in griglia con spazio usato, quota («(predefinita)», personale o illimitata), `.usage-bar` (avviso sopra il 90%), «Quota» apre un dialog con lo stesso segmentato (`.seg-wide`), «Sfoglia file» apre `/?owner=<id>`.
- **Drive**: filtro a pillole `.scope-filter` Tutti / Miei / Condivisi con me (`?scope=`). Con `?owner=` compare `.owner-banner` con «Torna al mio drive».
- **Dialog Accesso** (file e cartelle): due radio card `.visibility-option`, Privato / Tutti i membri, poi l'elenco delle persone aggiunte.

## Barra laterale (round 011 B)

Pannello estendibile/ritraibile: ritratto mostra solo icone con tooltip, esteso mostra etichette e contatori. Il blocco in basso (spazio usato) resta fisso; l'elenco cartelle scorre da solo quando non entra.

## Selezione e azioni in blocco (round 012 A "Barra in testata")

- Ogni file ha una checkbox (`.select-box`): su schede appare al passaggio del mouse al posto dell'icona, su touch è sempre visibile. "Seleziona tutto" in testa a griglia, elenco ed Esplora.
- Con almeno un file selezionato la testata diventa `.select-bar` (pillola accent-soft): conteggio, Sposta, Scarica, Elimina. Maiusc+clic seleziona un intervallo, ⌘A tutto, Esc annulla.
- Eliminare una cartella apre un dialog con il numero di sottocartelle e l'opzione "Elimina anche i suoi N file" (`.del-opt`, tinta danger quando attiva). Senza l'opzione i file tornano nella categoria automatica.

## Sottocartelle, Esplora file e ordinamento (round 013 A "Albero + elenco")

- "Nuova cartella" crea sempre dentro la cartella aperta; il percorso è un breadcrumb (`.crumbs`) con "Su di un livello", e ogni voce è anche un bersaglio di trascinamento.
- Vista Esplora (`.explorer`): albero a sinistra (240px, chevron per espandere, si apre da solo sul percorso corrente) e tabella a destra con colonne Nome, Tipo, Dimensione, Creato, Modificato. Clic sull'intestazione ordina, di nuovo inverte (`aria-sort`). Doppio clic o Invio apre una cartella.
- Il menu "Ordina" in testata vale per tutte le viste: nome, tipo, dimensione, creazione, modifica, crescente/decrescente.
- <760px l'albero sparisce; <640px restano solo Nome e Dimensione e il titolo della cartella va su una riga intera sopra gli strumenti.

## Aggiornamento dal plugin (round 014 A "Striscia sotto l'intestazione")

- Nella pagina del plugin, tra l'intestazione e le sezioni, così si vede da ogni sezione (`.dv-up`, `plugin/src/views/Update.tsx`). Appare quando il drive è più vecchio del plugin (versione assente o 1.x contano come più vecchie).
- Offerta: tinta info-soft, icona su `--surface`, titolo "È disponibile ErvisioDrive X", pulsante primario Aggiorna. In corso: `--sunk`, icona che ruota, registro dell'unità e barra indeterminata. Fine: ok-soft con Chiudi, solo se la pagina ha visto l'aggiornamento finire. Errore: warn-soft con Riprova e registro.
- Se il drive è spento perché si sta ricostruendo, la striscia resta sopra la procedura di connessione. Con `prefers-reduced-motion` icona e barra stanno ferme.

## Responsive

- **≥1024px**: rail + pannello + foglio.
- **<1024px**: rail e pannello nascosti, "Open navigation" apre il drawer, le cartelle diventano chip orizzontali, appare il FAB di caricamento.
- **<640px**: i dialog diventano bottom sheet, la tabella si impila e le colonne `col-meta` spariscono. I target touch sono ≥44px.

## Motion

Transizioni di 150–200ms su colore e raggio (morph cerchio → squircle del rail), collasso del pannello in larghezza, `dialog-in` (scala e opacità) per le modali. Con `prefers-reduced-motion` le animazioni sono disattivate.

## Do / Don't

- ✅ Usare i token e gli alias. Nessun hex nuovo, tranne `TILE_COLORS` del rail.
- ✅ Una sola CTA accent per vista ("Nuovo" o il FAB).
- ❌ Niente gradienti, glow o glass. Niente `rounded-xl` o `shadow-2xl` raw.
- ❌ Non forzare il tema scuro su `<html>`: segue il sistema.

## Verifica

`npx tsc --noEmit`, `npm test`, `npm run build`, `npx playwright test` (360/390/768/1280), `lint-slop` PASS.
