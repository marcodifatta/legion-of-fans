# Changelog

Formato ispirato a [Keep a Changelog](https://keepachangelog.com/it/1.1.0/).

## [0.5.1] — 2026-11-22

### Aggiunto
- Frequenza media della CPU sotto la temperatura CPU (anche nel monitor `tools/thermal-logger.sh`).

### Corretto
- Steam a volte segnala per qualche secondo "nessun gioco" mentre un gioco è aperto: prima il plugin applicava il profilo predefinito e azzerava le statistiche. Ora un gioco risulta chiuso solo dopo 10 secondi senza segnale, e se ricompare entro un minuto mantiene statistiche e profilo.

### Verificato e scartato
- **Undervolt (Curve Optimizer)**: il firmware della Legion Go rifiuta il comando anche con valore 0 (`set_coall is rejected by SMU`, `set_cogfx is rejected by SMU`). La funzione non è stata introdotta; il codice dell'esperimento è in `docs/undervolt-experiment.py`.

## [0.5.0] — 2026-11-22

### Aggiunto
- **TDP e GPU integrati** (tutte le funzioni di SimpleDeckyTDP utili sulla Legion Go):
  - slider TDP da 5 W al massimo scelto (fino a 40 W), scritto sui tre limiti del firmware (sostenuto, breve, picco) ciascuno entro il proprio massimo;
  - modalità GPU 🔋 Batteria, ⚖️ Bilanciata, ↔️ Intervallo (frequenza min/max) e 📌 Fissa;
  - **profili per gioco** che si salvano da soli quando cambi qualcosa in gioco, profilo predefinito e predefinito con caricatore;
  - pulsante "Usa il predefinito per questo gioco".
- **CPU avanzate**: SMT, boost, governor ed EPP per profilo.
- **Opzioni TDP**: attivazione separata di TDP, GPU e CPU, profili per gioco, profilo con caricatore, massimo dello slider, TDP massimo all'avvio di un gioco, TDP massimo o nessuna modifica al risveglio, SMT riattivato prima della sospensione.
- **Import automatico** dei profili e delle opzioni di SimpleDeckyTDP al primo avvio.
- **Controllo intelligente**: ogni 5 s verifica TDP, GPU e CPU e li riapplica solo se qualcosa li ha cambiati (contatore delle correzioni).
- Rilevamento del gioco in esecuzione anche a menu chiuso, e del risveglio dalla sospensione.
- Numero di versione in fondo al plugin.

### Modificato
- La protezione automatica ora abbassa il TDP del profilo in uso, senza più contendersi il valore con un altro plugin.
- Il TDP viene scritto solo quando cambia (gioco, profilo, protezione, risveglio) invece che ogni 15 secondi.

## [0.4.0] — 2026-11-21

### Aggiunto
- Nuovo design: riquadri scuri con accento blu ghiaccio, numeri grandi, barre colorate e stato testuale delle temperature.
- Sezioni apribili (Curva ventola, Gioco e TDP, Protezione, Avviso, Statistiche, Alimentazione) che ricordano se le hai lasciate aperte.
- Interruttore del **limite di carica all'80 %** (`Long_Life`), riapplicato all'avvio e controllato ogni minuto.
- Freno di emergenza della protezione a 92 °C.
- Intervallo della protezione regolabile (3–15 minuti, predefinito 5).

### Modificato
- Protezione automatica **graduale**: −3 W ogni intervallo sopra la soglia e +3 W dopo lo stesso tempo al fresco (prima ogni 15 secondi, troppo aggressiva).
- Grafico dei 5 minuti: solo temperatura, scala in gradi leggibile e soglie con legenda.
- Menu del profilo a tutta larghezza; valori della sezione Gioco su una riga.
- Soglia della protezione limitata a 90 °C (sotto il freno di emergenza).

### Corretto
- Gli stili non venivano applicati: il menu laterale di Steam è una finestra separata, ora il foglio di stile è renderizzato dentro il pannello.
- Testi del grafico neri (invisibili) su sfondo scuro.

## [0.3.0] — 2026-11-21

### Aggiunto
- Grafico della temperatura degli ultimi 5 minuti.
- Statistiche della sessione per gioco (max/media, tempo sopra 85 e 90 °C, tagli di potenza del firmware).
- Gioco in esecuzione con profilo SimpleDeckyTDP e TDP applicato.
- Stato del caricatore (stima della potenza) e flusso della batteria.
- Protezione automatica del TDP (facoltativa) con notifiche.
- Profili **Ottimale** e **Automatica**.
- Mini grafico della curva con scaglione attivo evidenziato.

### Modificato
- Lettura dei sensori e aggiornamento dell'interfaccia ogni secondo (prima fino a ~3,5 s di ritardo rispetto all'overlay).

## [0.2.0] — 2026-11-21

### Aggiunto
- Nome **Legion of Fans** e motto *Too Hot To Handle*.
- Scheda dedicata nella barra del menu laterale di Steam.
- Icone e ventola animata in base ai giri.

### Corretto
- `PermissionError` su `/dev/mem`: il flag del plugin era `_root` (disattivato nel template) invece di `root`.

## [0.1.0] — 2026-11-21

### Aggiunto
- Prima versione: curva ventola a scaglioni (40–90 °C) tramite la tabella dell'embedded controller, profili Silenziosa / Bilanciata / Massima, salvavita al 100 % da 90 °C, temperature e avviso di surriscaldamento.
