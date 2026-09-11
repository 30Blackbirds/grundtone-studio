// grundtone-studio · parallel-tilstand mod KlangHaus/jenkins-library
//
// 🔴 DENNE FIL MAA IKKE VOKSE. Repo-specifik pipeline-logik hoerer i
//    biblioteket som en parametreret facilitet — en PR til [quality] —
//    ALDRIG her. Ellers faar vi ni fortolkninger af "som vi anbefaler det".
//
// 🔴 PARALLEL, IKKE FLIP. `checksPrefix` goer at navnene publiceres som
//    `jenkins/Test` ved siden af Actions' `Test`. Uden praefikset ville de
//    ikke staa VED SIDEN AF, men ERSTATTE: GitHub tager det SENESTE check-run
//    pr. navn uanset app, og Jenkins rapporterer efter Actions — hver PR
//    ville blive blokeret af et roedt check fra en agent uden vaerktoej.
//    (Maalt af [taktart] paa deres main `0e1a214`.)
//
//    FLIP er ÉN operation med tre led i DENNE raekkefoelge:
//      fjern praefikset -> verificér at navnene landede -> SLUK Actions SIDST.
//    Aldrig omvendt: et manglende required check kan ikke ses fejle — det
//    staar bare "Expected" i det uendelige.
//
// 🔴 GATEN LIGGER I PROTECTION, IKKE I ET RULESET. Maalt paa begge flader
//    2026-09-11: `branches/main/protection` har 14 contexts,
//    `rules/branches/main` har ingen. (grundtone er omvendt — dér ligger den
//    i rulesettet. De to repos kan altsaa ikke maales med samme kald.)
//    `Test` herunder er det EKSAKTE required navn; praefikset paasaettes af
//    biblioteket, saa ved flip fjernes én linje og navnet er allerede rigtigt.
//
// ⛔ KUN `Test` ER PORTET. De oevrige 13 required contexts bliver paa Actions
//    indtil hver er maalt for sig. En tynd start er ikke en delvis port: det
//    er ét navn ad gangen, hvor uenigheder kan tilskrives.
//
// ⚠️ EN ERKLAERET FORSKEL, saa en uenighed i parallel-ugen ikke tilskrives
//    porteringen: Actions koerer postgres med `grundtone/grundtone_ci` og
//    databasen `grundtone_studio`. Bibliotekets katalog er en LUKKET maengde
//    — et repo deklarerer en NOEGLE, aldrig et image eller dets `env` — saa
//    her er det `postgres/postgres` mod default-databasen. Skemaet og
//    testene er de samme; kun brugernavn og db-navn adskiller sig. Skulle en
//    test en dag afhaenge af db-NAVNET, er dette stedet uenigheden kommer fra.
//
// 🔴 HVIS KATALOGET IKKE DAEKKER en fremtidig stak: aaben en PR til
//    jenkins-library med image OG digest. Det er den ENESTE vej.
//    Fristelsen — at `docker run` sit eget image fra `cmd` herunder — er
//    lukket med vilje: agenten har ikke docker, og havde den det, ville det
//    forudsaette socket-adgang, altsaa root-aekvivalens for fremmed kode.
//    [sikkerheds] votum: sondringen er EVNEN, ikke hensigten. At flytte
//    eksekveringen uden at flytte specifikationen flytter syscallet, ikke
//    tillidsgraensen. Derfor bor image og digest paa troet side, og et repo
//    deklarerer en NOEGLE fra en lukket maengde.
//    Skrevet her frem for kun i et riff, fordi riffet lukkes og filen bliver
//    — og fordi det naeste hul ellers bliver "kataloget daekkede ikke",
//    opdaget under tidspres af en der ikke kender begrundelsen.

@Library('klanghaus') _

klanghausPipeline(
  repo: 'KlangHaus/grundtone-studio',

  // Kraevet af bibliotekets sonar-gate og af `schedule`-assertionen.
  // Maalt, ikke antaget: studios default er `main` (grundtones er `develop`).
  defaultBranch: 'main',

  // Default er 20. Actions' Test-job bruger ~1m28 med varm cache; en kold
  // foerste koersel her goer install + migrate + test dyrere, og en timeout
  // midt i parallel-ugen ville blive laest som en uenighed mellem
  // instrumenterne frem for som en graense vi selv satte.
  timeoutMinutes: 30,

  checksPrefix: 'jenkins/',

  pnpmCache: true,

  checks: [
    [
      // Det eksakte required navn. Se noten om praefikset ovenfor.
      context: 'Test',

      // 🔴 Tokenet er SCOPET til dette check, ikke ambient. studios .npmrc
      // peger @klanghaus-scopet mod npm.pkg.github.com via ${NODE_AUTH_TOKEN};
      // uden bindingen faar `pnpm install` 401 paa @klanghaus/permissions-client.
      npmAuth: true,

      // Biblioteket DEKLARERER; [infra]s cloud-mekanik har startet sidecaren
      // foer agenten. Nooglen er digest-pinnet i kataloget — `postgres17`
      // svarer til det `postgres:17-alpine` Actions koerer.
      services: ['postgres17'],

      cmd: '''
        set -euo pipefail

        # 🔴 POSITIV KONTROL FOER MAALINGEN. Uden den kan "testene bestod" ikke
        # skelnes fra "sidecaren blev aldrig startet, og intet roerte en
        # database". Biblioteket eksponerer HOST/PORT praecis for at den her
        # kan skrives; en manglende sidecar skal fejle LARMENDE, ikke give en
        # groen der maalte ingenting.
        : "${KH_SVC_POSTGRES17_HOST:?sidecaren postgres17 er ikke deklareret}"
        : "${KH_SVC_POSTGRES17_PORT:?sidecaren postgres17 mangler port}"
        for i in $(seq 1 30); do
          if (exec 3<>"/dev/tcp/${KH_SVC_POSTGRES17_HOST}/${KH_SVC_POSTGRES17_PORT}") 2>/dev/null; then
            exec 3<&- 2>/dev/null || true
            break
          fi
          [ "$i" = 30 ] && { echo "🔴 postgres17 svarer ikke paa ${KH_SVC_POSTGRES17_HOST}:${KH_SVC_POSTGRES17_PORT} efter 30 forsoeg"; exit 1; }
          sleep 1
        done
        echo "postgres17 naaet paa ${KH_SVC_POSTGRES17_HOST}:${KH_SVC_POSTGRES17_PORT}"

        # Se den erklaerede forskel oeverst: katalogets legitimation er fast.
        export DATABASE_URL="postgresql://postgres:postgres@${KH_SVC_POSTGRES17_HOST}:${KH_SVC_POSTGRES17_PORT}/postgres"

        # Samme vaerdier som Actions' test-job. De er CI-attrapper, ikke
        # hemmeligheder — de staar i klartekst i ci.yml af samme grund.
        export BETTER_AUTH_SECRET='ci-secret-not-for-production-use-only'
        export BETTER_AUTH_URL='http://localhost:3000'
        export S3_ENDPOINT='http://127.0.0.1:9000'
        export S3_REGION='us-east-1'
        export S3_BUCKET='grundtone-studio'
        export S3_ACCESS_KEY_ID='ci'
        export S3_SECRET_ACCESS_KEY='ci-secret'
        export TURBO_TELEMETRY_DISABLED=1

        # `klanghausPipeline` har kun checkout og checks — ingen build-fase, og
        # alle checks deler ét workspace. Derfor er hvert `cmd` selvbaerende;
        # Actions' artefakt-overlevering (setup uploader, fire jobs henter)
        # findes ikke her.
        pnpm install --frozen-lockfile
        pnpm --filter @grundtone-studio/studio db:migrate
        pnpm test
      ''',
    ],
  ],
)
