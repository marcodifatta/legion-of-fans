# Com'è nato Legion of Fans

## Il problema

Una Legion Go con Bazzite si spegneva all'improvviso durante il gioco, sempre collegata al caricatore, con TDP a 30–33 W. Nessun errore nei log: il journal si interrompeva di colpo, senza sequenza di spegnimento.

## La diagnosi

1. **Nessun segnale software.** Nessun errore di kernel, GPU o driver: lo spegnimento era hardware (protezione dell'embedded controller).
2. **Un registratore di temperature.** Un servizio utente (`tools/thermal-logger.sh`) ha iniziato a salvare ogni 5 secondi temperature, potenze, TDP, batteria e giri, scrivendo su disco ogni riga per non perdere gli ultimi secondi.
3. **Il secondo spegnimento, registrato.** Negli ultimi 4 minuti: 33 W reali costanti, CPU/GPU/scheda a 93–94 °C con la ventola al massimo (~7450 RPM), e il firmware che ogni 60–80 secondi tagliava la potenza a ~18 W per una decina di secondi. Durante uno di questi tagli il dispositivo si è spento.
4. **Esclusi** caricatore (USB-PD 3,25 A, batteria al 99 %), driver e GPU.

**Conclusione:** spegnimento termico. Con una stanza calda, 33 W sostenuti erano oltre ciò che il raffreddamento riusciva a smaltire.

## Le correzioni

- TDP dei giochi portati a 25 W (SimpleDeckyTDP), Home a 10 W.
- Limite di carica all'80 % (meno calore dalla batteria sempre in carica).
- Curva della ventola più efficace: prima con Panel de Control, poi con questo plugin.
- Disattivato un servizio di Bazzite (`gamemode-news-hook`) che ogni 5 secondi reiniettava codice nell'interfaccia di Steam causando piccoli scatti.
- Orologio hardware riportato in UTC (prima in ora locale, residuo di Windows).

## Il plugin

Il kernel non permette di leggere né comandare la ventola della Legion Go originale. Studiando come Panel de Control usa la tabella ventola dell'embedded controller, è nato un plugin più semplice e focalizzato: ventola, temperature e protezione, con una curva a scaglioni comoda da regolare con il pad.

Per progettare l'interfaccia è stato usato il debugger remoto di Steam (`tools/cef.mjs`) per catturare screenshot del menu laterale direttamente dalla Legion Go.
