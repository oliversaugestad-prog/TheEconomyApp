# Bankintegrasjon og veien til produksjon

Saldo kan hente ekte bankdata via **Enable Banking** i deres gratis «restricted»-modus, som bare gir tilgang til kontoer eieren selv har koblet til. Det er ment for privat, ikke-kommersiell bruk. Demodata, manuelle kontoer og CSV-import fungerer fortsatt.

## Slik er det satt opp

```
Nettleser (GitHub Pages)  ──innlogging──▶  Supabase Auth (e-postlenke, PKCE)
        │                                        │
        │  bruker-JWT                            ▼
        ├──────────────▶  Edge Function «bank»  ──JWT signert med privat nøkkel──▶  Enable Banking API
        │                   │   (supabase/functions/bank)                              │
        │                   │                                                          ▼
        │                   ├─ Vault: privat nøkkel (kryptert)                    Bankens BankID
        │                   └─ eb_sessions: samtykker (kun server)                      │
        │                                                                              │
        ◀──────── tilbake til appen (#/kontoer?bank=ok) ◀── GET /functions/v1/bank ◀───┘
        │
        └─ user_state (radnivåsikkerhet: bare eieren)  ◀── Saldo-data (kontoer, transaksjoner, regler)
```

- **Innlogging:** engangslenke på e-post. Bare adresser i tabellen `allowed_users` får bruke bankfunksjonene.
- **Nøkkel:** .pem-filen lastes opp i Innstillinger → Banktilkobling. Serveren tester den mot Enable Banking og lagrer den i Supabase Vault. Den sendes aldri tilbake til nettleseren.
- **Samtykker:** sesjons-ID-er fra Enable Banking lagres bare i `eb_sessions`, som nettleseren ikke kan lese.
- **Henting:** brukeren trykker «Oppdater». Serveren henter saldo og transaksjoner (første gang 90 dager tilbake, deretter fra 14 dager før forrige henting) og sender dem til appen. Appen bruker de samme reglene for duplikater, reservasjoner, overføringer og refusjoner som ellers.
- **Frakobling:** samtykket slettes hos Enable Banking. Lagrede data kan beholdes eller slettes.
- **Database:** oppsettet ligger i `supabase/migrations/`.

Engangsoppsett (gjøres av eieren):

1. Registrer en Production-applikasjon hos Enable Banking og koble til egne kontoer.
2. Legg til `https://yxkzcnduisekbugqvgwk.supabase.co/functions/v1/bank` som tillatt redirect URL i applikasjonen.
3. I Supabase: Authentication → URL Configuration → Site URL = `https://oliversaugestad-prog.github.io/TheEconomyApp/`.
4. Logg inn i Saldo og last opp .pem-filen under Innstillinger.

**Ikke verifisert ennå:** hvordan hver enkelt bank oppgir saldo på kredittkort (fortegn) og om den leverer reserverte transaksjoner. Dette sees først ved første ekte henting.

## Hva som er undersøkt (september 2026)

Direkte oppslag i tilbydernes offisielle dokumentasjon (enablebanking.com, docs.tink.com, docs.neonomics.io) var **blokkert av nettverket i utviklingsmiljøet**. Punktene under bygger derfor på søkeresultater som gjengir disse kildene, og må kontrolleres mot oppdatert offisiell dokumentasjon før en tilbyder velges.

| Tilbyder | Funn | Kilde | Bekreftet? |
| --- | --- | --- | --- |
| **Enable Banking** | Oppgir dekning av de store norske bankene (DNB, SpareBank 1, Nordea, Handelsbanken, Danske Bank) og flere mindre. Innlogging via omdirigering med BankID. Nordea har sandkasse. Egne «brands», blant annet for Nordea First Card. | [Open Banking Specifics in Norway – Enable Banking Docs](https://enablebanking.com/docs/markets/no/) (via søk) | Delvis. Søkesammendrag, ikke lest i sin helhet. |
| **GoCardless Bank Account Data** (tidl. Nordigen) | Tar ikke imot nye registreringer siden juli 2025. | [bankaccountdata.gocardless.com/new-signups-disabled](https://bankaccountdata.gocardless.com/new-signups-disabled) | Ja, flere uavhengige kilder sier det samme. **Uaktuell for nye prosjekter.** |
| **Tink**, **Neonomics** | Kjente AISP-er med nordisk dekning. | Dokumentasjonen var blokkert | **Ikke bekreftet.** |

**Ikke bekreftet**, og må undersøkes før valg av tilbyder:

- Om norske **kredittkort** er tilgjengelige via PSD2-kontoinformasjon. Mange kort utstedes av egne selskaper eller via kortplattformer, og har ikke alltid et PSD2-grensesnitt. Fakturabeløp, forfall og minstebeløp finnes ofte ikke i PSD2-data. Saldo viser derfor «Ikke tilgjengelig» og lar brukeren registrere dem manuelt.
- Om «tilgjengelig saldo» (f.eks. `interimAvailable`) og reserverte transaksjoner (`pending`) leveres av hver bank.
- Hvor ofte data kan hentes uten at brukeren er til stede. PSD2 begrenser dette typisk til noen få ganger per døgn per konto. Saldo lover derfor ikke sanntidsdata, og viser tidspunkt for siste vellykkede oppdatering.
- Hvor lenge et samtykke varer i Norge (typisk 90–180 dager, avhengig av bank og regelverk) og hvordan det fornyes.
- Pris, avtalevilkår og krav til lisens eller agentavtale.

## Hva som kreves for ekte integrasjon

1. **Avtale med en lisensiert kontoinformasjonstilbyder (AISP)**, eller egen AISP-lisens fra Finanstilsynet. Registrert applikasjon med produksjonstilgang.
2. **Serverkomponent (backend)**
   - Holder API-nøkler og private nøkler, for eksempel i en hemmelighetstjeneste. Aldri i nettleseren.
   - Starter samtykkeflyten og tar imot tilbakekall fra banken (redirect/callback).
   - Lagrer tilgangstokener kryptert og knytter dem til riktig bruker.
   - Henter kontoer, saldoer og transaksjoner på en tidsplan innenfor tilbyderens grenser, og mapper dem til Saldos domenemodell (`Account`, `Transaction`). Pass på å skille `booked` fra `pending` og ta vare på transaksjons-ID for duplikatkontroll.
   - Implementerer `BankDataProvider` (`src/providers/types.ts`) mot eget API, slik at grensesnittet ikke endres.
3. **Autentisering og tilgangskontroll:** Innlogging for Saldo-brukeren, for eksempel via OIDC. Hver forespørsel sjekker at brukeren bare får egne data.
4. **Lagring:** Database med kryptering av data som lagres (at-rest), TLS for data i transport, sikkerhetskopiering og sletting på forespørsel. Lagringen i localStorage erstattes med et API-basert `Repository`.
5. **Logging uten sensitive data:** Ingen beløp, kontonumre, mottakere eller tokener i logger.
6. **Frakobling:** Trekk tilbake samtykket hos tilbyderen, og tilby separat sletting av lagrede data. Grensesnittet skiller allerede mellom disse to valgene.
7. **Personvern:** Behandlingsgrunnlag og personvernerklæring etter GDPR, databehandleravtale med tilbyderen, og oversikt over hvilke data som hentes og hvor lenge de lagres.
8. **Sikkerhetsgjennomgang** og penetrasjonstest før ekte data tas i bruk.

## Samtykkeflyt (planlagt)

1. Brukeren velger bank i Saldo.
2. Backend oppretter en autorisasjonsforespørsel hos tilbyderen og sender brukeren videre til bankens innlogging (BankID).
3. Brukeren godkjenner lesetilgang. Banken sender brukeren tilbake med en kode.
4. Backend bytter koden mot en sesjon eller et token, og henter kontoer.
5. Saldo viser tilkoblingen med status, siste oppdatering og utløpsdato for samtykket. Ved utløp vises «Må kobles til på nytt», og tidligere data beholdes, merket som utdaterte.

Saldo ber aldri om bankpassord eller BankID-opplysninger, og kan ikke gjennomføre betalinger.
