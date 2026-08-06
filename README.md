# Palio del Timone — Simulatore

Simulatore tattico del **Palio del Timone**: si sceglie un quartiere, si compone
una rosa di sei tiratori sotto il tetto dei 540 kg e si disputa un torneo fra i
quattro quartieri, chiamando di persona le tirate.

Nessuna dipendenza, nessun passo di build: HTML, CSS e moduli ES nativi.

## Il gioco

Quattro quartieri, ciascuno con il proprio bonus:

| Quartiere | Colore | Bonus |
|---|---|---|
| San Paolo | Rosso | +10% Resistenza |
| San Giovanni | Blu | +10% Forza |
| Bolognano | Arancione | +10% Agilità |
| Meletolo | Verde | +10% Gioco di squadra |

Girone all'italiana andata e ritorno, poi finale 3°/4° e finale 1°/2° posto.

### La tirata

Dodici tiratori su una croce imperniata al centro. Ogni squadra occupa due
bracci opposti; vince chi tiene un proprio braccio nella **Zona Palio** per i
secondi richiesti, o — a tempo scaduto — chi ha il palo più vicino all'arco.

Il giocatore non muove i tiratori: è il **Chiamatore**, e dispone di quattro
comandi.

| Comando | Tasto | Che cosa fa |
|---|---|---|
| **Spinta** | `S` | Si va avanti, spalle al palo: il gesto pieno |
| **Tirata** | `T` | Si porta il palo a sé camminando all'indietro. Rende quasi quanto la spinta per i primi istanti, poi crolla |
| **Sotto** | `I` | Si passa sotto il palo e la squadra si rigira. Mentre si passa non si applica forza |
| **Freno giostra** | `F` | Ci si pianta per smorzare la rotazione e rifiatare |

I comandi non hanno una direzione: la direzione è quella in cui la squadra
guarda, e il sotto la ribalta.

### I due regimi

**Stallo** — le due squadre si spingono contro e il timone quasi non si muove.
È la posizione di partenza e quella in cui si torna per fermare il palo dove
serve.

**Giostra** — dopo un sotto le due squadre si trovano a spingere nello stesso
verso: le coppie si sommano e il timone parte in rotazione continua. Chi tira la
rallenta appena. Se ne esce solo con un altro sotto, cronometrato — e in piena
rotazione può fallire.

## Avvio in locale

I moduli ES richiedono `http://`, quindi non basta aprire il file:

```bash
python3 -m http.server 8000
```

poi `http://localhost:8000`.

## Struttura

```
js/
├── core/      stato, PRNG seedabile, rose, calendario e classifica
├── data/      quartieri e generazione dei nomi
├── match/     engine (fisica pura), ai, renderer, input, loop di gioco
└── ui/        schermate, draft, calendario
```

Il motore in `js/match/engine.js` non tocca il DOM: le stesse identiche regole
governano la tirata giocata a 60 fps e la simulazione headless degli incontri
fra IA, comprese quelle risolte con **Simula il resto del torneo**. Non c'è un
dado sui rating — sono tirate vere, calcolate senza disegnarle.

Tutte le costanti di gioco stanno nell'oggetto `TUNING` in cima a `engine.js`.
Il PRNG è seedabile: a parità di seme, rose, calendario ed esiti sono
riproducibili.
