# Híralapú szemantikai elemzés ETL alapú megközelítéssel

## Tartalomjegyzék

1. Bevezetés

2. Tárgyalási rész
   - 2.1 Az ETL folyamat és architektúrája
     - 2.1.1 Az ETL fogalma
     - 2.1.2 Az Extract fázis
     - 2.1.3 A Transform fázis
     - 2.1.4 A Load fázis
     - 2.1.5 Egymásba ágyazható ETL folyamatok
   - 2.2 Híralapú predikció ETL megközelítéssel
     - 2.2.1 A szemantikai elemzés elméleti alapjai
     - 2.2.2 Extract – hírek összegyűjtése
     - 2.2.3 Transform – szemantikai elemzés LLM segítségével
     - 2.2.4 Load – az aggregált elemzés tárolása
   - 2.3 Piaci termékek árának előrejelzése ETL segítségével
     - 2.3.1 Az árfolyam-előrejelzés informatikai megközelítése
     - 2.3.2 Extract – hisztorikus árfolyam-adatok kinyerése
     - 2.3.3 Transform – statisztikai számítások az ársorozatokon
     - 2.3.4 Transform – a hír és az árfolyam-adatok kombinálása
     - 2.3.5 Load – az előrejelzés tárolása és megjelenítése
   - 2.4 A rendszer megvalósítása
     - 2.4.1 Technológiai stack
     - 2.4.2 Osztályalapú architektúra és függőséginjektálás
     - 2.4.3 Konfigurációkezelés és futtatási módok
     - 2.4.4 A webszerver és az API réteg
   - 2.5 Jövőbeni fejlesztési lehetőségek
     - 2.5.1 Fejlettebb előrejelzési modellek
     - 2.5.2 Valós idejű adatforrások és streamelés
     - 2.5.3 Adatbázis-alapú tárolás és visszatekintő elemzés
     - 2.5.4 Kibővítés részvény-előrejelzési platformmá

3. Összefoglalás

4. Irodalomjegyzék

5. Függelék

6. Köszönetnyilvánítás

---

# 1. Bevezetés

- A pénzügyi és gazdasági piacokon a hírek jelentős hatással vannak az árak alakulására.
- Az elmúlt években a big data és a mesterséges intelligencia lehetővé tette, hogy nagy mennyiségű hírt feldolgozva piaci trendeket próbáljunk meg előre jelezni.
- A hírek automatikus feldolgozásának egyik kulcseleme a szemantikai elemzés, amely képes a szöveg jelentését és érzelmi töltetét azonosítani.
- Az ilyen rendszerek működéséhez gyakran szükség van egy adatfeldolgozási pipeline-ra, amely az adatokat begyűjti, feldolgozza és felhasználható formában eltárolja.
- Az egyik legelterjedtebb architektúra erre a célra az ETL (Extract–Transform–Load) modell.

A dolgozat célja egy híralapú szemantikai elemzésen alapuló, ETL architektúrát alkalmazó rendszer bemutatása, amely képes a piaci ármozgások előrejelzésének támogatására.

---

# 2. Tárgyalási rész

## 2.1 Az ETL folyamat és architektúrája

### 2.1.1 Az ETL fogalma

- ETL definíció
- Adatfeldolgozó pipeline-ok szerepe
- Big data rendszerekben való használat

### 2.1.2 Extract

- Adatok kinyerése különböző forrásokból
- API-k, adatbázisok, web scraping

### 2.1.3 Transform

- Adattisztítás
- Normalizálás
- Strukturálás

### 2.1.4 Load

- Adatok betöltése adatbázisba vagy adatpiacra
- Felhasználás analitikában vagy gépi tanulásban

### 2.1.5 Egymásba ágyazható ETL folyamatok

A rendszerben két párhuzamos, független ETL pipeline fut, amelyek kimenete kombinálódik a prediktorban:

- **Pipeline 1 – Hír ETL**: `NewsApiFetcher` → OpenAI szemantikai elemzés → `aggregate-summary-YYYY-MM-DD.json`
- **Pipeline 2 – Ár ETL**: `MetalPriceFetcher` → `priceStatistics` → `price-data-YYYY-MM-DD.json`
- **Kombináció**: A `RareEarthMetalPredictor` mindkét JSON-t beolvassa és összekapcsolja a predikció generálásához

Feldolgozási mód: batch (10 cikk párhuzamosan), nem streaming.

---

## 2.2 Híralapú predikció ETL megközelítéssel

### 2.2.1 A híralapú predikció elméleti alapjai

- Szövegbányászat
- Szemantikai elemzés
- Sentiment analysis

### 2.2.2 Extract – hírek gyűjtése

A rendszer kizárólag **NewsAPI REST API**-t használ (RSS feed vagy web scraping nincs).

- Négy célzott lekérdezés párhuzamosan:
  - Általános ritkaföldfém + autóipar
  - Akkumulátor fémek (Li, Co, Ni, Mn) + EV
  - Mágnes fémek (Nd, Pr, Dy, Tb) + motor/magnet
  - Ellátási lánc fókusz (export, bányászat, Kína)
- ~400 cikk / futtatás, URL-alapú deduplikáció

Letöltött mezők: `title`, `description`, `content` (csonkított), `publishedAt`, `source`, `url`

### 2.2.3 Transform – szöveges adatok szemantikai elemzése

A rendszer **Large Language Model (LLM) alapú** szemantikai elemzést alkalmaz (OpenAI `gpt-4o-mini`), nem hagyományos NLP módszereket (TF-IDF, tokenizálás, stopword eltávolítás).

Három független elemzési lépés minden cikkre:

1. **Relevanciaszűrés** (`assessRareEarthRelevance`): releváns-e az autóipari ritkaföldfém témára?
   - Kimenet: `relevant: bool`, `confidence: 0..1`, `matchedTerms[]`, `category: magnet|battery|mixed`
2. **Sentiment osztályozás** (`classifyNews`): piaci hangulat besorolás
   - Kimenet: `bullish | bearish | neutral`, `impact: up|down|flat`, `confidence: 0..1`
3. **Árhatás becslés** (`assessRareEarthPriceImpact`): várható árirány
   - Kimenet: `direction: up|down|uncertain`, `drivers: string[]`

Aggregáció: eloszlások számítása, domináns driverek azonosítása, AI-generált narratíva (`summarizeAggregate`)

### 2.2.4 Load – predikciós modell bemenete

Az elemzett adatok **JSON fájlba** kerülnek (`output/aggregate-summary-YYYY-MM-DD.json`), nem relációs adatbázisba.

- REST API-n keresztül (`/api/summary` endpoint) a dashboard eléri
- A `pricePrediction` mező a JSON-ben tartalmazza az előrejelzés eredményét

---

## 2.3 Piaci termékek árának előrejelzése ETL segítségével

### 2.3.1 Ritka földfémek piaci jelentősége

- Technológiai ipar és elektromos járművek
- Akkumulátorok és permanens mágnesek
- Geopolitikai tényezők (kínai exportkorlátozások, ellátási lánc kockázatok)

### 2.3.2 Extract – historikus árfolyam adatok

A ritkaföldfémek OTC (over-the-counter) piacon kereskednek, nincs ingyenes publikus napi árfolyam API. Ennek megfelelően a rendszer kétszintű forrás-hierarchiát alkalmaz:

- **Elsődleges forrás**: Metals-API (`metals-api.com`) – ha konfigurálva van, 45 kereskedési nap lekérése REST API-n keresztül
- **Fallback forrás**: Beágyazott seed adatok (`src/data/seed-prices.json`) – USGS Mineral Commodity Summaries alapján, 41 kereskedési nap

Négy követett fém és kosár-súlyok (autóipari felhasználási arányok alapján):

| Fém | Szimbólum | Kosársúly | Felhasználás |
|-----|-----------|-----------|--------------|
| Neodymium oxide | ND | 40% | Trakciós motor mágnes |
| Praseodymium oxide | PR | 20% | NdPr ötvözet |
| Lithium carbonate | LI | 30% | Akkumulátor katód |
| Cobalt | CO | 10% | Akkumulátor stabilizáció |

### 2.3.3 Extract – híralapú predikció kimenete

Az `aggregate-summary` JSON tartalmazza a hír ETL pipeline kimenetét:

- Sentiment eloszlás (bullish/bearish/neutral arányok)
- Árhatás eloszlás (up/down/uncertain arányok)
- Domináns driverek listája (pl. export restrictions, supply chain security)

### 2.3.4 Transform – adatok kombinálása és statisztikai számítások

**Ár ETL statisztikai számítások** (`src/statistics/priceStatistics.ts`):

Napi hozamok:

$$r_i = \frac{p_i - p_{i-1}}{p_{i-1}} \times 100$$

Súlyozott kosárár:

$$P_{basket} = \sum_{i} w_i \cdot p_i$$

14-napos rolling window volatilitás: a 14 elemű ablakokban számított szórások átlaga.

Empirikus szórás: Bessel-korrekciós (n-1 nevező) mintaszórás a napi hozamokra.

**Hír + ár kombináció** (`RareEarthMetalPredictor`):

$$score_{combined} = 0{,}4 \cdot score_{sentiment} + 0{,}6 \cdot score_{impact}$$

$$\Delta\%_{predicted} = \sigma_{14d} \times (1 + 0{,}8 \cdot score_{combined}) \times \text{sign}(score_{combined})$$

### 2.3.5 Load – előrejelzések megjelenítése

Két kimeneti JSON fájl az `output/` mappában:

- `price-data-YYYY-MM-DD.json` – ár pipeline eredménye (fémenkénti sorozatok, kosárár, statisztikák)
- `aggregate-summary-YYYY-MM-DD.json` – hír pipeline eredménye (elemzés + predikció)

Mindkettőt a dashboard REST API-n keresztül olvassa be és jeleníti meg.

---

## 2.4 Microservice alapú rendszer megvalósítása

### 2.4.1 Microservice architektúra

- Skálázhatóság és moduláris fejlesztés
- Független komponensek (ETL pipeline, webszerver, predikció)
- Konfigurációvezérelt működés (`.env` fájl)

### 2.4.2 ETL microservice

**Technológiai stack:**

| Réteg | Technológia | Szerep |
|-------|-------------|--------|
| Runtime | Node.js 24+ | Futtatókörnyezet |
| Nyelv | TypeScript 5.6 | Típusbiztos implementáció |
| AI | OpenAI `gpt-4o-mini` | Szemantikai elemzés |
| Hírek | NewsAPI REST | Extract – hírek |
| Árak | Metals-API / seed JSON | Extract – árfolyamok |
| Tárolás | JSON fájlok (`output/`) | Load – perzisztencia |

Főbb osztályok és felelősségeik:

- `NewsApiFetcher` – hír lekérés és deduplikáció
- `MetalPriceFetcher` – árfolyam lekérés, seed fallback
- `IronNewsAnalyzer` – sentiment osztályozás (OpenAI + naív baseline)
- `RareEarthMetalAnalyzer` – árhatás becslés
- `RareEarthMetalPredictor` – predikció generálás (hír + ár kombináció)
- `priceStatistics` – statisztikai számítások (szórás, volatilitás, hozamok)

### 2.4.3 UI microservice

**Technológiai stack:** Vanilla HTML5 + Chart.js + Express.js statikus szerver (nem React)

- `src/server.ts`: Express REST API (`/api/summary` endpoint)
- `public/index.html`: Single-page dashboard, Chart.js vizualizációk
- 28-napos árgrafikon (14 historikus + 14 predikált)
- Sentiment eloszlás, árhatás eloszlás, domináns driverek megjelenítése

### 2.4.4 Futtatási módok

| Mód | Env változók | Leírás |
|-----|-------------|--------|
| Teljes futtatás | `SKIP_FETCH=false`, `SKIP_PRICE_FETCH=false` | Mindkét pipeline fut (~2-5 perc) |
| Csak predikció | `SKIP_FETCH=true`, `SKIP_PRICE_FETCH=true` | Meglévő JSON-ökből számol (másodpercek) |
| Friss ár, cached hír | `SKIP_FETCH=true`, `SKIP_PRICE_FETCH=false` | Új árfolyam, régi hírelemzés |

### 2.4.5 Kódrészletek

A fejezetben bemutatható például:

- ETL pipeline főfolyamata (`src/index.ts`)
- OpenAI prompt engineering (relevancia, sentiment, árhatás)
- Statisztikai számítások (`src/statistics/priceStatistics.ts`)
- REST API endpoint (`src/server.ts`)

---

## 2.5 Jövőbeni fejlesztési lehetőségek és felhasználási területek

Lehetséges fejlesztések:

- Gépi tanulás integráció (ARIMA, SARIMA idősor modellek)
- Deep learning alapú NLP (fine-tuned transformer modellek)
- Real-time adatfeldolgozás (WebSocket, SSE)
- Relációs adatbázis integráció (PostgreSQL) backtesting-hez
- World Bank API integráció (Li, Co ingyenes havi adatok)
- Backtesting keretrendszer (walk-forward validáció, MAE, RMSE metrikák)

Felhasználási területek:

- Pénzügyi elemzés és befektetési döntéstámogatás
- Gazdasági monitoring és vállalati kockázatelemzés
- Nyersanyag ellátási lánc menedzsment
- Geopolitikai kockázatelemzés

---

# 3. Összefoglalás

- A dolgozat bemutatta a híralapú szemantikai elemzés alkalmazását ETL architektúrával.
- Két párhuzamos ETL pipeline kerül bemutatásra: egy hír- és egy árfolyam-pipeline, amelyek kimenete kombinálódik a predikció generálásához.
- A szemantikai elemzés LLM-alapú megközelítéssel (OpenAI gpt-4o-mini) valósul meg, három lépésben: relevanciaszűrés, sentiment osztályozás, árhatás becslés.
- A statisztikai réteg empirikus szórást és rolling volatilitást számít a historikus árfolyamokból.
- Egy konkrét példán keresztül bemutatásra kerül a ritka földfémek (Nd, Pr, Li, Co) autóipari kosárárának elemzése.
- A rendszer microservice szemléletű, TypeScript/Node.js alapú implementációval valósul meg.

---

# 4. Irodalomjegyzék

- Tan, Steinbach, Kumar – *Introduction to Data Mining*
- Jurafsky & Martin – *Speech and Language Processing*
- Kimball, Ross – *The Data Warehouse Toolkit*
- Manning, Schütze – *Foundations of Statistical Natural Language Processing*
- USGS – *Mineral Commodity Summaries* (éves kiadások)
- OpenAI – *GPT-4o technical report*

---

# 5. Függelék

Lehetséges tartalom:

- Teljes adatstruktúrák (`types.ts` interfészek)
- API végpontok leírása
- Teljes kódrészletek (ETL pipeline, prompts)
- Adatmodell diagramok (ETL flow, osztálydiagram)
- Backtesting eredmények (ha elkészül)
- Seed adatok forrásleírása (USGS referencia)

---

# 6. Köszönetnyilvánítás

- Témavezető
- Egyetem
- Család és támogatók
