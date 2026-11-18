# Palio del Timone — Simulatore

Il **Palio del Timone** come gioco di carte tattico: si sceglie un quartiere e si
chiamano le tirate a carte coperte. Due modi di giocarlo:

- **Il Cammino del Palio** (1 giocatore) — una run roguelike: una mappa a bivi
  di tirate, eventi, botteghe e osterie che sale fino al Palio, con tre cuori da
  non perdere;
- **Il Torneo** (1 o 2 giocatori) — girone all'italiana fra i quattro quartieri
  e finali.

In entrambi ogni secondo passato nella Zona Palio vale un passo verso un nuovo
bonus, e i bonus restano per tutta la run.

La grafica è quella di un codice miniato: pagine di pergamena, sigilli di
ceralacca, capitali in Cinzel e testo in EB Garamond. Il campo, in pixel art,
sta incorniciato come una miniatura.

Nessuna dipendenza, nessun passo di build: HTML, CSS e moduli ES nativi.

## Il gioco

Quattro quartieri. Partono tutti uguali, con la stessa formazione e lo stesso
mazzo: il quartiere è un'identità e, quando lo si affronta, il carattere del
suo chiamatore.

| Quartiere | Colore | Chiamatore |
|---|---|---|
| San Paolo | Rosso | calcolatore: gioca il colpo giusto |
| San Giovanni | Blu | aggressivo: spinge e carica |
| Bolognano | Arancione | agile: passa sotto e rimescola |
| Meletolo | Verde | metodico: tiene e frena |

### Il Cammino del Palio

Si parte con il mazzo base, un primo bonus a scelta e **tre cuori**. La mappa ha
nove righe di tappe, dal basso verso l'alto; da ogni tappa partono uno o due
sentieri verso la riga dopo, e si sceglie quale prendere. Le tappe che non sono
tirate stanno in luoghi veri di Massa Lombarda.

| Tappa | Che cosa succede |
|---|---|
| ⚔ **Tirata** | Contro un quartiere rivale. Vinta: 15 fiorini e un bonus a scelta. Persa: un cuore. |
| ☠ **Rivale** | Un avversario con più bonus. Vinta: 30 fiorini e un bonus a scelta. |
| ? **Evento** | Un incontro in paese con una scelta: il vecchio tiratore, la scommessa, il vino del Moro… |
| ⚖ **La Piazza del Mercato** | Tre bonus in vendita (35 fiorini le carte, 50 gli effetti), togliere una carta, un cuore. |
| ≈ **L'antico lavatoio** | Allenamento: si toglie una carta dal mazzo, o se ne raddoppia una. |
| ✝ **La chiesa di San Paolo** | Si accende un cero (+1 cuore), o si toglie una carta. |
| ★ **Il Palio** | Sotto la Torre dell'Orologio: la tirata finale contro il rivale storico, scelto a inizio run. |

Le tirate del cammino sono brevi all'inizio e si allungano salendo:

| Tirata | Battute | Tenuta per vincere | Durata media |
|---|---|---|---|
| prime tre righe | 6 | 4 s | ~5 battute |
| resto della mappa | 8 | 5 s | ~6 battute |
| rivale | 10 | 5 s | ~7 battute |
| Palio | 12 | 6 s | ~10 battute |

Prima di ogni tirata si vede il **mazzo dell'avversario** e i suoi effetti, così
si può preparare la strategia. Gli avversari crescono salendo la mappa: nessun
bonus in basso, fino a tre in alto, due in più per i rivali, sei per chi aspetta
al Palio. Il mazzo non scende mai sotto le sette carte.

Senza cuori il cammino finisce; vincendo il Palio, la run è vinta. Il cammino si
salva a ogni passo e si riprende dalla schermata iniziale. Misurato in
simulazione, un chiamatore forte quanto l'IA vince il Palio in quattro run su
dieci: le tirate brevi lasciano più spazio al caso, e la differenza la fa chi
chiama meglio dell'IA.

Durante la tirata **▶▶** (o `F`) fa scorrere le battute al doppio della velocità.

### Il Torneo

Girone all'italiana andata e ritorno, poi finale 3°/4° e finale 1°/2° posto.

### La tirata

Dodici tiratori su una croce imperniata al centro. Ogni squadra occupa due
bracci opposti; vince chi tiene un proprio braccio nella **Zona Palio** per
qualche secondo consecutivo (5 nella tirata breve del torneo), o — a tempo scaduto — chi ha il palo più vicino
all'arco.

Il giocatore non muove i tiratori: è il **Chiamatore**. La tirata si divide in
**battute** da cinque secondi — nel torneo 8 nel formato breve, 12 nel
regolamentare; nel cammino dipende dalla tappa. A
ogni battuta i due Chiamatori mettono in fila le loro carte **coperte**; le
sequenze si scoprono insieme e il motore fisico gioca la battuta sul campo.
Nessuno vede la mossa dell'altro prima di aver chiamato la propria: si vince
prevedendo, non reagendo.

### Il campo e il duello

La piazza è disegnata in **pixel art**, vista di tre quarti: il timone di legno
con la sua ombra, la Zona Palio in fondo sotto il drappo, il pubblico attorno.
I tiratori cambiano posa secondo la carta che la squadra sta giocando — chini
nella spinta, sbilanciati all'indietro nella tirata, piantati nel freno,
accucciati nel sotto — e frecce a terra mostrano il verso e la forza della
spinta di ciascuno. La bandiera del palo che conta è più alta, con la punta
bianca.

Sotto il campo c'è il **duello**: le due sequenze scoperte, una riga per
squadra, allineate sui cinque secondi della battuta. Mentre il motore gioca, un
cursore scorre e accende la carta che ognuno sta giocando in quel momento —
così si vede che cosa si scontra con che cosa. A fine battuta il duello resta in
vista per tutta la scelta successiva, con i **gradi** di cui ciascuno ha
avvicinato (o allontanato) il proprio palo alla Zona Palio. La battuta scorre
al tempo vero.

### Energia e tempo

Ogni battuta hai **4 energia** e **5 secondi**. Ogni carta ha un costo in
energia e una durata: se ne giocano quante si vuole, **in fila e nell'ordine
scelto**, finché bastano energia e tempo. Il tempo che avanza è presa passiva:
la squadra tiene ma non spinge. A fine battuta la mano va negli scarti e se ne
pescano cinque nuove.

Il **Freno** è sempre in mano: non costa energia, frena per un secondo e fa
rifiatare — **+1 energia alla battuta dopo**. Si gioca una volta per battuta,
come il sotto.

### Le carte

Il mazzo di partenza, uguale per tutti:

| Carta | Costo | Durata | Che cosa fa |
|---|---|---|---|
| **Spinta** ×5 | 1⚡ | 1 s | Tutta la squadra avanti, spalle al palo |
| **Tirata** ×2 | 1⚡ | 1 s | Il palo verso di sé, camminando all'indietro: breve e forte |
| **Tenuta** ×3 | 1⚡ | 1 s | Riporta il palo al centro dell'arco e lo ferma |
| **Sotto** ×2 | 1⚡ | 2 s | Si passa sotto e ci si rigira: la spinta cambia verso |
| **Freno** | 0⚡ | 1 s | Smorza la giostra, +1⚡ alla battuta dopo (sempre in mano) |

Le carte da guadagnare come bonus aprono due strade — **potenza** (molta
energia per pochi secondi) o **efficienza** (più secondi per energia):

| Carta | Costo | Durata | Che cosa fa |
|---|---|---|---|
| **Spallata** | 2⚡ | 1 s | La spinta più forte che c'è (+60%) |
| **Strattone** | 2⚡ | 1 s | Una tirata violenta (+50%) |
| **Carica lunga** | 2⚡ | 3 s | Una spinta che non molla per tre secondi |
| **Àncora** | 2⚡ | 3 s | Tiene il palo nell'arco per tre secondi |
| **Passaggio lampo** | 1⚡ | 1 s | Sotto sicuro e rapidissimo |

Con poco Gioco di squadra una chiamata può uscire **a metà**: rende di meno, e
un sotto chiamato male esita. È la disciplina dei tiratori.

### I bonus

Prima del torneo ogni quartiere sceglie un **primo bonus** fra tre. Poi, ogni
**4 secondi** passati nella Zona Palio — accumulati, anche in una tirata persa —
se ne guadagna un altro, al massimo **2 per tirata**: la tirata si ferma e si
sceglie fra tre. I bonus restano per tutto il torneo e sono di due tipi:

- **carte nuove** che entrano nel mazzo (quelle della tabella sopra);
- **effetti permanenti**: *Fiato lungo* (+1 energia), *Occhio del chiamatore*
  (una carta in più), *Esterni d'acciaio* (spinte +15%), *Braccia lunghe*
  (tirate +20%), *Mediani di ferro* (tenute +20%), *Interni svelti* (ogni sotto
  riesce), *Piede piantato* (il Freno rende 2 energia e frena il doppio),
  *Disciplina ferrea* (nessuna chiamata a metà).

Le IA guadagnano i loro con la stessa regola — anche nelle tirate fra loro — e
li scelgono secondo il carattere del quartiere.

### Il Chiamatore artificiale

Non vede le tue carte. A ogni battuta mette in fila le sequenze che può giocare
e le prova contro giocate verosimili tue: pesca a caso alcune mani dal tuo
mazzo, che è pubblico, e ne ricava le sequenze che potresti chiamare con la tua
energia, che si conta. Tiene conto di come hai giocato finora, quindi chi chiama
sempre la stessa cosa viene letto. Poi sceglie con un po' di imprevedibilità,
più o meno secondo il carattere del quartiere.

### I due regimi

**Stallo** — le due squadre si spingono contro e il timone quasi non si muove.
È la posizione di partenza e quella in cui si torna per fermare il palo dove
serve.

**Giostra** — dopo un sotto le due squadre si trovano a spingere nello stesso
verso: le coppie si sommano e il timone parte in rotazione continua. Chi tira la
rallenta appena. Se ne esce solo con un altro sotto, cronometrato — e in piena
rotazione può fallire.

### La formazione

Tutte le squadre schierano la stessa formazione: due **Esterni** (i più pesanti,
leva lunga), due **Mediani** e due **Interni** (i più leggeri, leva corta). La
posizione entra nella fisica: la Forza di un Esterno, più lontano dal perno,
sposta il timone più di quella di un Interno, e il peso della squadra è spinta.

### Due giocatori

Sulla schermata iniziale si sceglie **Torneo in due**, sullo stesso schermo: ciascuno sceglie il proprio quartiere e il
proprio primo bonus, gli altri due quartieri restano all'IA. Quando i due umani
si affrontano, ogni mano resta **coperta** finché il suo proprietario non la
guarda.

Su telefono in verticale la tirata fra due umani si gioca in **hotseat**: la
mano del Giocatore 2 va in cima, ruotata di 180°, quella del Giocatore 1 resta
in basso. Si posa il telefono fra i due e ognuno gioca dal proprio bordo.

Da tastiera il Giocatore 1 aggiunge le carte con `1`–`9`, toglie l'ultima con
`Backspace` e chiama con `Invio`; `P` mette in pausa l'animazione, `F` la fa
scorrere veloce.

## Avvio in locale

I moduli ES richiedono `http://`, quindi non basta aprire il file:

```bash
python3 -m http.server 8000
```

poi `http://localhost:8000`.

## Struttura

```
js/
├── core/      stato, PRNG seedabile, formazione, calendario e classifica
├── run/       il Cammino: mappa a bivi, regole della run, svolgimento delle tappe
├── data/      i quartieri
├── match/     engine (fisica pura), renderer in pixel art, HUD
├── cards/     carte ed energia, bonus, battuta, IA, sessione, tirata giocata
└── ui/        schermate, bonus e mazzi, calendario, mappa e scene del Cammino
```

Il motore in `js/match/engine.js` non tocca il DOM, e nemmeno la sessione delle
carte (`js/cards/cardSim.js`): le stesse identiche regole governano la tirata
giocata e la simulazione degli incontri fra IA, comprese quelle risolte con
**Simula il resto del torneo** — bonus inclusi. Non c'è un dado sui rating: sono
tirate vere, calcolate senza disegnarle.

Le costanti fisiche stanno in `TUNING` in cima a `engine.js`; energia, carte e
mazzo base in `js/cards/cards.js`; i bonus in `js/cards/bonus.js`. Il PRNG è
seedabile: a parità di seme, calendario ed esiti sono riproducibili.

Il Cammino ha un suo formato di salvataggio (`kind: 'cammino'`, versione 5).
I tornei salvati con le versioni precedenti (rose scelte a mano e tirata in
tempo reale) non si possono riprendere.
