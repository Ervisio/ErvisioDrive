# ErvisioDrive

Drive privato separato da **FusionHub**, con la stessa interfaccia della sezione CDN: tema scuro, accenti arancioni, cartelle, upload, anteprime e strumenti di gestione. Funziona sul proprio server con **Docker Compose**, **Next.js**, **MongoDB** e file conservati sul disco host.

## Avvio rapido

Serve soltanto Docker Engine con Compose v2 su Linux, oppure Docker Desktop avviato in modalità container Linux su Windows/macOS. Non servono Node.js o MongoDB installati sull’host.

```bash
git clone https://github.com/Fonlogen/ErvisioDrive.git
cd ErvisioDrive
./setup.sh
```

Su Windows aprire `setup.bat`, oppure eseguirlo dal terminale nella cartella del progetto. In caso di permesso mancante su Linux: `bash setup.sh`.

Il setup chiede URL, email del primo admin, cartella sul disco host, porta e quota massima in GiB. Genera il secret di sessione, avvia database e applicazione e mostra un **link monouso valido 48 ore** per impostare la password del proprietario. Aprire il link, scegliere la password e accedere. Lo stesso link si recupera con `docker compose logs bootstrap`; trattarlo come una credenziale.

Il valore predefinito è `http://localhost:3000`, ascolto su `127.0.0.1`, quota di 100 GiB. Per usarlo da remoto configurare un URL HTTPS e un reverse proxy o tunnel verso la porta locale. Non è necessario esporre MongoDB; Compose non pubblica alcuna porta del database.

Setup senza domande, utile anche su server:

```bash
./setup.sh --non-interactive --admin-email admin@example.com \
  --url https://drive.example.com --storage-path /srv/ervisiodrive/files --quota 500
```

Windows:

```bat
setup.bat --non-interactive --admin-email admin@example.com --url https://drive.example.com --storage-path C:/ErvisioDrive/files --quota 500
```

## Spazio disco: progressivo, espandibile

La cartella scelta viene montata nel container come `/data/files`. **Non viene creato un disco virtuale né preallocata la quota.** Con una quota di 500 GiB e 3 GiB di file, i dati dei file occupano circa 3 GiB. Database, immagini Docker e log occupano spazio aggiuntivo, escluso dalla quota file. Il filesystem host deve comunque avere spazio libero sufficiente.

Il contatore persistente riserva atomicamente lo spazio prima di upload, duplicazioni e ampliamenti nell’editor, anche con richieste simultanee. Le eliminazioni e la pulizia dei file scaduti liberano la quota. Il pannello mostra usato e limite.

Per passare, ad esempio, da 100 a 500 GiB:

```bash
./setup.sh --resize 500
```

```bat
setup.bat --resize 500
```

I dati, il percorso e le credenziali restano invariati. Nessuna migrazione o allocazione preventiva. Abbassare la quota sotto l’uso corrente conserva i file e blocca nuove scritture che aumenterebbero l’occupazione.

Per cambiare disco fisico: fermare `app` e `cleanup`, copiare integralmente la cartella file preservando i permessi, aggiornare `DRIVE_STORAGE_PATH` in `.env`, quindi `docker compose up -d`. Il nuovo disco deve essere già montato e disponibile al demone Docker. Su Windows usare percorsi come `D:/ErvisioDrive/files`; Docker Desktop deve poter accedere a quell’unità.

## Account e autenticazione

- Accesso con **email e password**, oppure **Google opzionale**.
- Nessuna registrazione pubblica. Un admin autorizza l’email in **Utenti e accessi** e consegna privatamente il link di invito mostrato dal pannello.
- L’invito attiva o reimposta la password; è casuale, monouso, scade dopo 48 ore e nel database si conserva soltanto il digest. Il token è nel frammento `#` dell’URL, escluso da richieste HTTP e referrer, e viene rimosso dalla barra dell’indirizzo dopo l’apertura.
- Password di 12–128 caratteri, hash scrypt con salt casuale e parametri `N=131072, r=8, p=1`. Nessuna password in chiaro o memorizzata in `.env`.
- Protezione CSRF per i form di login, controllo dell’origine per le API di modifica, rate limit persistente per login e attivazioni. Cookie di sessione HttpOnly; Secure automatico quando `NEXTAUTH_URL` usa HTTPS.
- La whitelist, il ruolo e la versione di sessione vengono ricontrollati nel database a ogni richiesta protetta. Rimozione di un account o reset password invalidano le sessioni già aperte. Rimuovere e ricreare la stessa email non ripristina i vecchi cookie.
- Il primo admin è proprietario e non può essere rimosso o declassato dal pannello. Gli altri admin sono gestibili normalmente.
- Gli inviti di reset vengono emessi dagli admin; non è richiesto SMTP e non viene inviata automaticamente alcuna email.

Per recuperare l’account proprietario dall’host:

```bash
docker compose run --rm bootstrap node scripts/ops.mjs reset-owner
```

Il vecchio accesso viene invalidato quando la nuova password è impostata. L’emissione di un nuovo invito invalida il precedente invito per quell’account.

### Attivare Google

Creare un client OAuth di tipo Web in Google Cloud e impostare il redirect:

```text
https://drive.example.com/api/auth/callback/google
```

Per lo sviluppo: `http://localhost:3000/api/auth/callback/google`. Configurare consent screen e utenti di test se l’app è in modalità Testing. In `.env` aggiungere:

```dotenv
GOOGLE_CLIENT_ID='il-client-id'
GOOGLE_CLIENT_SECRET='il-client-secret'
```

Poi `docker compose up -d`. Il bottone Google appare solo con entrambe le variabili configurate. L’accesso richiede `email_verified=true` e un’email già autorizzata. Il primo accesso Google associa in modo persistente l’identificatore `sub` all’account; i successivi devono corrispondere. Password e Google possono essere usati sullo stesso account autorizzato. Sono richiesti soltanto `openid email profile`, senza accesso al Google Drive personale.

Documentazione: [provider Google](https://next-auth.js.org/providers/google), [OAuth Google](https://developers.google.com/identity/protocols/oauth2/web-server), [parametri password OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).

## Funzioni e permessi

- Upload multipli e drag & drop, categorie automatiche, cartelle personalizzate con descrizione.
- Viste griglia, lista e dettagli; ricerca, ordinamento, anteprime immagini/video/audio e download con supporto Range.
- Rinomina, spostamento, duplicazione, eliminazione e scadenza opzionale dei file.
- Editor di testo/codice con evidenziazione e anteprima Markdown, fino a 2 MiB per file.
- Accessi specifici su file e cartelle: lista vuota = tutti gli utenti della whitelist, mai accesso pubblico. I permessi di cartella e file si applicano insieme; un admin può sempre amministrare i contenuti. Anche conteggi, liste e URL diretti applicano questi controlli.
- I membri possono modificare i file a cui hanno accesso: è uno spazio collaborativo. Proprietario del contenuto e admin gestiscono gli accessi e i link condivisi.
- Link diretto autenticato; link pubblici di download separati con password, scadenza e limite di download opzionali, revocabili dal pannello. Chi possiede un link pubblico può scaricare senza login secondo le condizioni del link, indipendentemente dall’ACL del file. Rimozione/scadenza del file, revoca del link o rimozione dalla whitelist del creatore bloccano il download.
- Il limite dei link è atomico: richieste parallele non possono superarlo. Ogni richiesta riuscita, anche parziale, conta; tentativi con password errata non contano. Le password dei link non passano nella query string.
- File HTML, SVG e altri formati attivi vengono scaricati come allegati, con `nosniff` e sandbox. I dati non sono dentro `public/` e non possono aggirare il login con un URL statico.

La vista **Tutti**, come nell’originale FusionHub, include le categorie automatiche; le cartelle personalizzate si aprono separatamente. La pulizia automatica rimuove dal disco i file scaduti ogni ora; diventano inaccessibili subito alla scadenza.

## Configurazione

| Variabile | Uso |
| --- | --- |
| `NEXTAUTH_URL` | URL base del servizio; HTTPS per uso remoto |
| `NEXTAUTH_SECRET` | Secret casuale generato dal setup; conservarlo fra riavvii |
| `BOOTSTRAP_ADMIN_EMAIL` | Email del proprietario, usata solo sul database vuoto |
| `DRIVE_STORAGE_PATH` | Cartella file sul disco **host** |
| `STORAGE_QUOTA_GB` | Quota totale file in GiB, espandibile senza migrazione |
| `UPLOAD_MAX_MB` | Limite per richiesta upload, predefinito 100 MiB |
| `APP_PORT`, `BIND_ADDRESS` | Porta host e indirizzo di ascolto |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | OAuth Google opzionale |
| `TRUST_PROXY` | Predefinito `false`; attivare soltanto dietro un proxy fidato che sovrascrive `X-Forwarded-For` |
| `MONGODB_URI`, `STORAGE_DIR` | Impostate automaticamente da Compose; servono esplicitamente per sviluppo senza Docker |

Con `TRUST_PROXY=false`, i tentativi di login condividono un limite globale oltre a quello per email. Il servizio non si fida di indirizzi IP dichiarati dal client. Un reverse proxy deve anche impostare un limite al corpo delle richieste coerente con `UPLOAD_MAX_MB` (ad esempio 101 MiB per un upload da 100 MiB) e gestire HTTPS.

La quota è applicativa, non una quota kernel o una partizione riservata. Scritture manuali dall’host non passano dal contatore. Per riallineare metadati e contatore dopo un ripristino o un arresto anomalo:

```bash
docker compose stop app cleanup
docker compose run --rm -e MAINTENANCE_CONFIRMED=true bootstrap node scripts/ops.mjs reconcile
docker compose up -d
```

Il comando segnala file mancanti senza cancellare file orfani. Non modificare direttamente i file del drive mentre il servizio è attivo.

## Gestione e backup

```bash
docker compose logs -f app
docker compose stop
docker compose up -d
docker compose run --rm bootstrap node scripts/ops.mjs cleanup
```

I file sono nella cartella scelta; MongoDB usa il volume Docker `ervisiodrive_mongo_data`. Salvare **insieme** cartella file, dump MongoDB e `.env`. Per un backup coerente fermare temporaneamente `app` e `cleanup`, esportare MongoDB con `mongodump` tramite `docker compose exec`, copiare file e configurazione, poi riavviare. Non usare `docker compose down -v` su un’installazione con dati da conservare.

## Sviluppo e verifiche

Node.js 22+ e MongoDB 8:

```bash
npm ci
cp .env.example .env.local
# Configurare MONGODB_URI, NEXTAUTH_SECRET e gli altri valori locali.
# Per inizializzare: esportare le variabili e avviare node scripts/ops.mjs bootstrap.
npm run dev
npm run typecheck
npm test
npm run test:integration
npm run build
```

I test d’integrazione avviano un database MongoDB temporaneo e scaricano il relativo binario al primo avvio. Coprono inviti monouso, login/password, Google verificato, revoca, ACL, operazioni sui file, quote, streaming e download concorrenti. La CI verifica anche l’immagine Docker e il setup Compose. Nessun test usa account o file di produzione.

## Origine

Interfaccia e componenti del drive estratti da `KFScripts/FusionHub`, commit `ad365d74e3e6f1c5797b289d2ee70c633bbd838c`. La logica di autenticazione, autorizzazione, storage privato, quote e distribuzione è separata. FusionHub non viene modificato. Non sono stati copiati configurazioni di produzione, dati, cookie, credenziali o moduli del portale non pertinenti.

Progetto privato; nessuna licenza open source aggiunta.
