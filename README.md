# Legion of Fans — *Too Hot To Handle*

Plugin [Decky Loader](https://decky.xyz/) per la **Lenovo Legion Go originale (83E1)** su Bazzite / SteamOS: curva della ventola a scaglioni, temperature in tempo reale, statistiche e protezione dal surriscaldamento, tutto dal menu laterale di Steam.

> **English:** Decky Loader plugin for the original Lenovo Legion Go (83E1). Step-based fan curve driven through the embedded controller, live temperatures, a 5-minute chart, per-game session stats, an optional gradual TDP protection and the firmware 80 % charge limit. The UI is in Italian.

<p>
  <img src="docs/screenshots/overview.png" width="300" alt="Panoramica">
  <img src="docs/screenshots/fan-curve.png" width="300" alt="Curva ventola">
  <img src="docs/screenshots/sections.png" width="300" alt="Sezioni">
</p>

## Funzioni

- **Scheda dedicata nel menu laterale** (accanto all'icona di Decky), oltre alla voce nella lista dei plugin.
- **Situazione a colpo d'occhio**: temperatura CPU e GPU con barre colorate e stato testuale (✅ Fresca, 🙂 Tiepida, ⚠️ Calda, 🔥 Critica), giri ventola, potenza APU, TDP, scheda e SSD.
- **Grafico degli ultimi 5 minuti** con le soglie di avviso e salvavita.
- **Curva della ventola a scaglioni** (40–90 °C ogni 10 °C) regolabile con il pad, con mini grafico e **scaglione attivo evidenziato**.
- **Profili**: 🤫 Silenziosa, ⚖️ Bilanciata, 🎯 Ottimale, 🚀 Massima, 🤖 **Automatica** (reagisce a quanto in fretta sale la temperatura e al carico dell'APU), 🛠️ Personalizzata.
- **Salvavita**: da 90 °C, o se la temperatura non è leggibile, ventola sempre al 100 %.
- **Gioco e TDP**: gioco in esecuzione, profilo di [SimpleDeckyTDP](https://github.com/aarron-lee/SimpleDeckyTDP) e TDP realmente applicato.
- **Protezione automatica** (facoltativa): −3 W ogni *N* minuti sopra la soglia (minimo 15 W), +3 W dopo *N* minuti al fresco; freno di emergenza immediato a 92 °C.
- **Avviso**: notifica di Steam se la temperatura resta sopra la soglia per 10 secondi.
- **Statistiche della sessione**: massima, media, tempo sopra 85/90 °C, ventola e potenza massime, tagli di potenza del firmware, interventi della protezione. Si azzerano quando cambi gioco.
- **Alimentazione**: stato del caricatore e della batteria, **limite di carica all'80 %** (modalità `Long_Life` del firmware Lenovo) con interruttore.

## Requisiti

- Lenovo Legion Go **83E1** (prima generazione). Su altri modelli il plugin resta in sola lettura.
- [Decky Loader](https://decky.xyz/) su Bazzite o SteamOS.
- Non usarlo insieme ad altri plugin che comandano la ventola (es. Panel de Control).

## Installazione

1. Scarica lo zip dalla pagina [Releases](../../releases), oppure compilalo (vedi sotto).
2. In Decky: **Impostazioni → Generali → Modalità sviluppatore**, poi **Sviluppatore → Installa plugin da ZIP**.

## Come funziona

La Legion Go non espone la ventola ai driver Linux (`lenovo_wmi_other: fan reporting/tuning is unsupported on this device`). Il plugin usa direttamente la **tabella ventola a 10 gradini dell'embedded controller**, nella finestra di memoria `0xFE0B0000` (via `/dev/mem`):

| Offset | Significato |
|---|---|
| `+0x30E` (`SFNT`) | 1 = l'EC segue la tabella personalizzata, 0 = curva del firmware |
| `+0x930` | 10 byte: percentuale ventola per gradino |
| `+0x38B` | giri ventola, 16 bit little-endian |

La tabella è indicizzata da un sensore della scheda più freddo dell'APU, quindi il plugin calcola la percentuale dalla temperatura più alta tra CPU (`k10temp Tctl`) e GPU (`amdgpu edge`) e la scrive in tutti i gradini, senza mai scendere sotto i minimi del firmware sui gradini caldi. Ogni secondo rilegge e, se il firmware ha azzerato `SFNT` (succede ad esempio al cambio di profilo energetico), la riattiva. Quando spegni il controllo, disinstalli il plugin o si verifica un errore, la ventola torna al firmware.

Gli indirizzi sono quelli del DSDT della Legion Go (metodo `GZFD.SFAN`), gli stessi usati da [Panel de Control](https://github.com/Hooandee/panel-de-control): grazie a quel progetto per averli documentati.

### Perché la CPU segna qualche grado in più dell'overlay di Steam

L'overlay (MangoHud) mostra la **media delle temperature dei core** letta dalle metriche dell'SMU. Legion of Fans mostra **Tctl**, il sensore di controllo che il firmware usa per throttling e protezioni: di solito è 2–5 °C più alto, ed è il valore più prudente per comandare la ventola.

### Il caricatore

Linux espone solo la corrente USB-PD negoziata (es. 3,25 A), non la tensione né la potenza in ingresso: la potenza del caricatore è quindi una stima a 20 V.

> ⚠️ Accesso non ufficiale all'hardware e funzionamento come root: usalo a tuo rischio.

## Sviluppo

```bash
pnpm install
pnpm run build
```

Copia e installazione su una Legion Go via SSH:

```bash
LEGION_HOST=utente@legion-go.local scripts/push.sh
```

```bash
ssh -t utente@legion-go.local 'sudo bash ~/legion-fan-stage/deploy.sh ~/legion-fan-stage'
```

Il menu laterale di Steam è una finestra separata: gli stili sono renderizzati dentro il pannello (`src/styles.tsx`), non iniettati nel documento principale.

### Strumenti

| File | A cosa serve |
|---|---|
| `tools/cef.mjs` | Collegamento al debugger remoto di Steam via tunnel SSH: elenca le finestre, esegue JavaScript e cattura screenshot del pannello. |
| `tools/thermal-logger.sh` + `.service` | Servizio utente che registra ogni 5 s temperature, potenze, TDP e giri in `~/thermal-log/AAAA-MM-GG.csv` (scritto su disco riga per riga, utile per capire uno spegnimento improvviso). |
| `tools/sdtdp-25w.py` | Imposta in blocco i profili di SimpleDeckyTDP (Home 10 W, giochi 25 W). |
| `tools/legacy/` | Script usati con Panel de Control prima di questo plugin (curve ventola, limite di carica, orologio). |

La storia del progetto, dalla diagnosi degli spegnimenti al plugin, è in [docs/STORIA.md](docs/STORIA.md). Le modifiche versione per versione sono nel [CHANGELOG](CHANGELOG.md).

## Licenza

BSD-3-Clause (vedi [LICENSE](LICENSE)), basato sul [decky-plugin-template](https://github.com/SteamDeckHomebrew/decky-plugin-template).
