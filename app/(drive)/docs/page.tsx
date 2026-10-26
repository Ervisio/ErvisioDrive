export default function Docs() {
  return (
    <article className="prose prose-invert mx-auto max-w-3xl p-8">
      <h1>Usare ErvisioDrive</h1>
      <h2>File e cartelle</h2>
      <p>
        Carica più file dal pulsante Carica o trascinali nell’area di upload. Le
        categorie automatiche separano immagini, video, audio e documenti. Le
        cartelle personalizzate sono spazi separati e, come nel drive originale,
        non compaiono nella vista Tutti.
      </p>
      <p>
        Usa ricerca, ordinamento e viste griglia, lista o dettagli. Trascina un
        file su una cartella per spostarlo. Dal file puoi aprire l’anteprima,
        scaricare, rinominare, duplicare, eliminare o modificare testo e codice.
      </p>
      <h2>Accessi</h2>
      <p>
        Si accede con email e password o con Google opzionale. L’amministratore
        abilita le email in Utenti e accessi. Tutti gli utenti autorizzati
        possono collaborare sui file visibili. Il proprietario di un file o di
        una cartella, e gli amministratori, possono limitarne l’accesso ad altri
        utenti della whitelist. Una lista vuota indica tutti gli utenti
        autorizzati, mai accesso pubblico. I permessi di cartella e file si
        applicano insieme.
      </p>
      <h2>Condivisione</h2>
      <p>
        Il link diretto richiede il login e rispetta i permessi. Il proprietario
        o un admin può creare anche link pubblici di download, utilizzabili
        senza account, con password, scadenza e limite di download facoltativi.
        Chiunque possieda quel link può usarlo secondo queste condizioni, anche
        se non è nella whitelist del file.
      </p>
      <p>
        La revoca di un link, la rimozione o scadenza del file e la rimozione
        dalla whitelist del creatore bloccano il download. Ogni richiesta
        riuscita, inclusa una richiesta parziale, conta come un download; i
        tentativi con password errata non contano.
      </p>
      <h2>Limiti</h2>
      <p>
        L’upload predefinito è di 100 MB per richiesta e si configura sul
        server. L’editor gestisce file fino a 2 MB. I file scaduti diventano
        inaccessibili immediatamente; la pulizia periodica rimuove anche i dati
        dal disco.
      </p>
      <h2>Amministrazione</h2>
      <p>
        Il setup Docker (.sh o .bat) configura cartella sul disco e quota
        espandibile, senza preallocare spazio. Il primo account configurato
        diventa proprietario. Può autorizzare altri admin ed è protetto da
        rimozione o declassamento accidentali dal pannello.
      </p>
    </article>
  );
}
