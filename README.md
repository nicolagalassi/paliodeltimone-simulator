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

### La formazione

Ogni braccio del timone ha tre posizioni, dal perno verso l'esterno. La rosa si
compone scegliendone **due per posizione**, in sequenza — prima gli Esterni, poi
i Mediani, poi gli Interni — sempre entro il tetto fisso dei **540 kg**.

| Posizione | Peso | Leva | Nella tirata |
|---|---|---|---|
| **Esterno** | il più pesante | lunga | la Forza qui pesa di più sulla coppia |
| **Mediano** | medio | media | contributo intermedio |
| **Interno** | il più leggero | corta | leggero e agile, poco braccio |

La posizione è la fascia di peso del tiratore, e la sua **leva** entra nella
tirata: la Forza di un Esterno, più lontano dal perno, sposta il timone molto
più di quella di un Interno. La spinta è il confronto di potenza, e qui la
differenza si vede — una squadra con Esterni fortissimi spinge decisamente di
più, e **a parità di Forza la squadra più pesante vince** il confronto diretto.
Una rosa leggera non regge la spinta a viso aperto: deve rifiutarla e giocare la
giostra. Siccome i pesanti nascono forti e i leggeri agili, le posizioni
acquistano un'identità — e comporre la formazione diventa scegliere i due
migliori per fascia invece di bilanciare a mano un budget indistinto.

Ogni tiratore porta anche una **disciplina**, che nasce dal Gioco di squadra:
oggi la tirata la applica per intero, ma è l'aggancio per un futuro in cui, con
una squadra poco affiatata, qualcuno possa non rispettare la chiamata.

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

### Due giocatori

Sulla schermata iniziale si sceglie **1 giocatore** (tu contro le tre IA) o
**2 giocatori** sulla stessa tastiera. In coppia si compongono due rose di fila —
prima il Giocatore 1, poi il Giocatore 2 — e ciascuno chiama il proprio
quartiere per tutto il torneo; gli altri due restano all'IA. Quando i due
quartieri umani si incontrano si chiama la tirata in due, ognuno con i suoi tasti.

| | Giocatore 1 | Giocatore 2 |
|---|---|---|
| **Spinta** | `S` | `↑` |
| **Tirata** | `T` | `↓` |
| **Sotto** | `I` | `→` |
| **Freno giostra** | `F` | `←` |

A giocatore singolo restano validi anche gli alias comodi (`Spazio` e le frecce
`↑`/`↓` per spinta e tirata).

Su telefono in verticale, quando i due quartieri umani si affrontano, i comandi
si dispongono in **hotseat**: il pannello del Giocatore 2 va in cima e ruotato
di 180°, quello del Giocatore 1 resta in basso. Si posa il telefono fra i due e
ognuno gioca dal proprio bordo, con i comandi dritti dal suo lato.

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
