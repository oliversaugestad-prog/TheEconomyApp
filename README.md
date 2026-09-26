# Saldo

Saldo er en privatøkonomi-app som samler kontoer, transaksjoner, abonnementer og kredittkort på ett sted. Den er laget for en privatperson i Norge med kontoer i flere banker. Appen er på norsk bokmål og bruker NOK og norske tall- og datoformater (`24 850,50 kr`).

> **Status:** Dette er en fungerende prototype med **syntetiske demodata**. Ingen ekte bank er koblet til. Appen er ikke sikkerhetsrevidert og ikke klar for ekte bankdata i produksjon. Se [docs/BANKINTEGRASJON.md](docs/BANKINTEGRASJON.md).

## Kom i gang

```bash
npm install
npm run dev          # utviklingsserver på http://localhost:5173
npm run build        # produksjonsbygg i dist/ (statiske filer)
npm run preview      # server bygget lokalt på http://localhost:4173
```

Appen bruker hash-ruting, så `dist/` kan legges på hvilken som helst statisk vert.

### Tester

```bash
npm test             # Vitest: beregningslogikk, lagring og brukerflyter (78 tester)
npm run typecheck    # TypeScript
npm run test:e2e     # Playwright i Chromium, mobil og desktop
```

Hvis Playwright-versjonen ikke passer til nettleseren som er installert, sett `PLAYWRIGHT_CHROMIUM_PATH` til en lokal Chromium.

## Hva appen gjør

| Side | Innhold |
| --- | --- |
| **Oversikt** | Samlet kontosaldo, tilgjengelig saldo, kredittkortgjeld, saldo minus kortgjeld, månedens inntekter og utgifter, abonnementer per måned, kommende betalinger, «estimert igjen», siste transaksjoner, varsler og tilkoblingsstatus. Trykk på et nøkkeltall for å se hvilke kontoer som inngår og hvordan det er regnet ut. Øye-ikonet skjuler alle beløp. |
| **Kontoer** | Kontoer gruppert per bank med sum, bokført og tilgjengelig saldo, reservasjoner, synkstatus og valg av hvilke kontoer som inngår i oversikten. Du kan legge til manuelle kontoer, importere CSV, oppdatere, fornye samtykke (demo) og koble fra med eller uten sletting av lagrede data. |
| **Transaksjoner** | Søk på mottaker, tekst og beløp. Filtre for dato, bank, konto, kategori, type og status. Du kan endre kategori og lagre regler, og markere interne overføringer, kortbetalinger og refusjoner. Analysevisning med utgifter per kategori og inntekter mot utgifter. Liste, summer og diagrammer bruker samme filtrerte datasett. |
| **Abonnementer** | Forslag fra gjentakende betalinger som du kan bekrefte eller avvise, pluss manuell oppretting og redigering. Abonnementer holdes adskilt fra faste betalinger. Viser månedlig og årlig kostnad (årsabonnementer fordelt over 12 måneder), estimert neste trekk, mulige prisendringer og markering som avsluttet. |
| **Kredittkort** | Gjeld nå, reserverte kjøp, periodens kortkjøp, siste faktura (eller «Ikke tilgjengelig», som du kan registrere manuelt), kredittgrense, tilgjengelig kreditt og transaksjoner. |
| **Innstillinger** | Demomodus eller egne data, banktilkoblinger, blå eller korall aksent, standardvaluta og valutakurser, varsler i appen, kategoriseringsregler, eksport til JSON og sletting av alle data. |

## Økonomiske regler (implementert og testet)

- Pengebeløp lagres som **heltall i minste valutaenhet** (øre/cent). CSV-beløp tolkes som tekst, ikke som flyttall.
- **Kredittgrense og tilgjengelig kreditt** legges aldri til kontosaldoen.
- **Interne overføringer** telles ikke som inntekt eller forbruk. Det gjelder motsatte, like beløp mellom egne kontoer innen tre dager, der teksten ser ut som en overføring.
- **Betaling av kredittkort** reduserer gjelden, men telles ikke som utgift, fordi kortkjøpene allerede er telt. Dette gjelder også når kortsiden ikke er synkronisert ennå.
- **Reservasjoner** telles én gang. Når de bokføres, erstattes de, enten via ID fra kilden eller via samme konto, beløp og mottaker innen ti dager. Reservasjoner som er kansellert, fjernes.
- **Refusjoner** knyttes til kjøpet og kjøpets kategori, og reduserer utgiftene i den kategorien. De telles aldri som inntekt.
- **Duplikater:** Synkronisering bruker transaksjons-ID fra kilden. CSV-import bruker fingeravtrykk med telling, slik at to like kjøp samme dag kan importeres, mens gjentatt import av samme fil ikke gir duplikater.
- **Tilgjengelig saldo** brukes slik kilden oppgir den. Reservasjoner trekkes ikke fra på nytt.
- **Manglende saldo er ukjent, ikke 0.** Totalsummer merkes «Ufullstendig» og viser hva som mangler.
- **Ulike valutaer summeres ikke direkte.** De omregnes, og kurs, tidspunkt og kilde vises. Uten kurs holdes kontoen utenfor, og summen merkes som ufullstendig.
- **Datoer:** Bokføringsdato lagres som kalenderdato, tidspunkter som ISO 8601 i UTC. Visningen bruker brukerens tidssone.
- **Estimert igjen etter kommende betalinger** er et anslag for brukskontoer. Abonnementer som belastes kort, trekkes ikke separat, fordi de havner på kortfakturaen. Kortgjeld trekkes bare fra som kjent faktura. Forutsetningene vises i appen.
- Abonnementer som er oppdaget automatisk, og beregnede trekkdatoer, merkes som forslag og estimater.

## Arkitektur

```
src/
  domain/      Ren beregningslogikk uten UI-avhengigheter (penger, datoer, saldo,
               flyt, avstemming, abonnementer, kommende betalinger, CSV)
  providers/   Utskiftbare datatilbydere: demo (syntetisk) og en plassholder for
               ekte PSD2-integrasjon med samme grensesnitt
  storage/     Lagring (localStorage for prototypen, minnelager for tester)
  state/       SaldoStore: handlinger, synkronisering, persistens
  ui/          React-komponenter, sider, diagrammer og designsystem (styles.css)
e2e/           Playwright-tester
docs/          Bankintegrasjon og veien til produksjon
```

Brukergrensesnittet kaller aldri en bank direkte. Det går gjennom `SaldoStore`, som bruker en `BankDataProvider` og lagrer via et `Repository`. En ekte integrasjon kan derfor erstatte demotilbyderen uten endringer i grensesnittet eller beregningene.

**Teknologi:** Vite, React 19, TypeScript, React Router (hash) og lucide-ikoner. Valgt fordi prosjektet startet tomt, og dette er en moderne og vedlikeholdbar stakk for en responsiv webapp som senere kan få en backend eller pakkes som PWA. Diagrammene er egne SVG-komponenter med tabellvisning som tilgjengelig alternativ.

## Demodata

Ved første oppstart lastes syntetiske data, merket «DEMO» overalt:

- **Nordlys Bank:** brukskonto, sparekonto, valutakonto i EUR og Nordlys Visa. Kortet oppgir ikke faktura, så den vises som «Ikke tilgjengelig».
- **Fjordsparebanken:** felleskonto og BSU. BSU oppgir ikke tilgjengelig saldo, så totalen merkes som ufullstendig.
- **Vidde Kreditt:** Vidde Mastercard med faktura fra utsteder. Tilkoblingen krever ny innlogging, så dataene er tre dager gamle og merket som utdaterte.

Bankene er fiktive med vilje. Dataene dekker over tre måneder med lønn, husleie, dagligvarer, abonnementer (blant annet en prisøkning hos Netflix og et årsabonnement), interne overføringer, BSU-sparing, kredittkortbetalinger, reservasjoner, en full og en delvis refusjon, og kjøp i EUR. «Oppdater» simulerer synkronisering: samme transaksjoner hentes på nytt uten å gi duplikater, reservasjoner bokføres, og Vidde Kreditt svarer at samtykket må fornyes.

Demodata kan fjernes under Innstillinger. Egne manuelle kontoer og CSV-importer beholdes.

## Personvern og sikkerhet

- Saldo ber aldri om bankpassord, BankID-opplysninger eller komplette kort- eller kontonummer. Bare de siste sifrene lagres.
- Appen kan ikke gjennomføre betalinger.
- Prototypen lagrer alt **ukryptert i nettleserens localStorage**. Det er greit for demodata, men ikke for ekte bankdata. Brukeren får en advarsel ved manuelle data.
- Å koble fra og å slette er to separate valg.

Se [docs/BANKINTEGRASJON.md](docs/BANKINTEGRASJON.md) for hva som gjenstår før ekte bankdata og produksjon.
