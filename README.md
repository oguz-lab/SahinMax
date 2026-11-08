# SahinMax – Einrichtung

Private Film- und Serienverwaltung als Web-App für Handy, Tablet und PC.
**Kosten: 0 €.** GitHub Pages hostet die App, Firebase (kostenloser „Spark“-Tarif, ohne Kreditkarte) speichert die Daten, TMDb liefert Filminfos und Poster.

Dauer: etwa 15 Minuten. Du brauchst nur einen Browser.

---

## Schritt 1 – Firebase-Projekt anlegen (Datenbank + Login)

1. Öffne <https://console.firebase.google.com> und melde dich mit deinem Google-Konto an.
2. **Projekt erstellen** → Name `SahinMax` → Google Analytics **deaktivieren** → Projekt erstellen.
3. **Login einrichten**
   - Links: **Build → Authentication → Jetzt starten**
   - Reiter **Sign-in method** → **E-Mail/Passwort** → aktivieren → Speichern
   - Reiter **Users** → **Nutzer hinzufügen** → **deine E-Mail-Adresse** + ein Passwort → Nutzer hinzufügen.
   - Reiter **Einstellungen** → **Nutzeraktionen** → Haken bei **„Erstellen (Registrierung) aktivieren“ entfernen**. So kann sich niemand Fremdes ein Konto anlegen.
4. **Datenbank einrichten**
   - Links: **Build → Firestore Database → Datenbank erstellen**
   - Standort: `eur3 (europe-west)` → **Im Produktionsmodus starten** → Erstellen
   - Reiter **Regeln**: Ersetze den Inhalt durch den Inhalt der Datei [`firestore.rules`](firestore.rules). **Ersetze dort `deine-email@example.com` durch deine E-Mail-Adresse** (kleingeschrieben, genau wie in Schritt 3). Dann klicke auf **Veröffentlichen**.
5. **Web-App registrieren**
   - In der **Projektübersicht** unter dem Projektnamen auf **„+ App hinzufügen“** → **Web** (Symbol `</>`)
   - App-Spitzname `SahinMax` → **App registrieren** (Firebase Hosting **nicht** anhaken)
   - Du siehst einen Block `const firebaseConfig = { apiKey: "...", ... }`. Kopiere ihn und trage die Werte in `firebase-config.js` ein → **Weiter zur Konsole**.
   - ✅ *Erledigt – die Werte für das Projekt `sahinmax` sind bereits eingetragen.*

## Schritt 2 – App auf GitHub veröffentlichen

1. Lege auf <https://github.com> ein Konto an, falls du noch keins hast.
2. Oben rechts **+ → New repository** → Name `SahinMax` → **Public** → Create repository.
3. Klicke auf **„uploading an existing file“** und ziehe **den Inhalt** dieses Ordners hinein: `index.html`, `sw.js`, `manifest.webmanifest`, `firebase-config.js`, `.nojekyll` und die Ordner `css`, `js`, `icons`, `data`. → **Commit changes**.
   *`firebase-config.js` enthält bereits deine Firebase-Werte. Die sind nicht geheim, geschützt sind die Daten durch Login und Regeln.*
4. **Settings → Pages** → Source: **Deploy from a branch** → Branch `main`, Ordner `/ (root)` → Save.
   Nach ca. 1 Minute ist die App erreichbar unter `https://DEIN-NAME.github.io/SahinMax/`.
5. Zurück in Firebase: **Authentication → Einstellungen → Autorisierte Domains → Domain hinzufügen** → `DEIN-NAME.github.io`.

## Schritt 3 – Sammlung übernehmen

1. Öffne die App und melde dich an.
2. Die Datenbank ist noch leer. Klicke auf der Startseite auf **„Meine Sammlung übernehmen“**. Damit werden deine Filme aus `data/startdaten.json` geladen (55 Franchises, 225 Filme, 9 Serien).
3. **Danach:** Lösche im GitHub-Repository die Datei `data/startdaten.json`. Das Repository ist öffentlich, und deine Sammlung liegt dann sicher nur noch in der geschützten Datenbank.

## Schritt 4 – Filminfos & Poster (TMDb)

1. Konto anlegen auf <https://www.themoviedb.org/signup>
2. Profil → **Einstellungen → API** → API-Schlüssel beantragen (Typ „Developer“, private Nutzung)
3. Kopiere den **API-Schlüssel** oder den **Lesezugriffs-Token** und trage ihn in der App unter **⚙ Einstellungen** ein → Speichern → „Verbindung testen“.
   Er gilt danach automatisch für alle Zugänge.
4. *Optional:* Für echte IMDb-Bewertungen gibt es einen kostenlosen OMDb-Schlüssel auf <https://www.omdbapi.com/apikey.aspx>.

## Schritt 5 – Auf den Home-Bildschirm

- **iPhone (Safari):** App öffnen → Teilen-Symbol → **„Zum Home-Bildschirm“**
- **Android (Chrome):** App öffnen → Menü ⋮ → **„App installieren“** bzw. „Zum Startbildschirm hinzufügen“

## Später: zweiten Zugang hinzufügen (optional)

Wenn du die App mit jemandem teilen willst, geht das jederzeit, auch ohne E-Mail-Adresse für die andere Person:

1. Firebase → **Authentication → Users → Nutzer hinzufügen** → als E-Mail **`benutzername@sahinmax.local`** eintragen (z. B. `lena@sahinmax.local`, kleingeschrieben, ohne Leerzeichen) + Passwort.
   Diese Adresse muss nicht existieren, es wird nie eine E-Mail verschickt.
2. Firebase → **Firestore Database → Regeln** → die Adresse in die Liste eintragen, z. B.
   `['deine@email.de', 'lena@sahinmax.local']` → **Veröffentlichen**.
3. Der Person den Link geben. Sie meldet sich nur mit **`lena`** und dem Passwort an. Änderungen erscheinen bei beiden **sofort**.

Vergessenes Passwort bei einem Benutzernamen: Nutzer in Firebase löschen (⋮ → **Konto löschen**) und mit gleichem Namen und neuem Passwort neu anlegen. Die Sammlung bleibt dabei erhalten.

---

## Gut zu wissen

- **Backups:** Unter ⚙ Einstellungen kannst du jederzeit ein JSON-Backup exportieren und wieder importieren. Die App erinnert dich, wenn das letzte Backup älter als 30 Tage ist. Gelöschte Einträge landen zuerst im **Papierkorb**.
- **Offline:** Die App startet auch ohne Internet. Änderungen werden übertragen, sobald du wieder online bist.
- **Updates:** Geänderte Dateien einfach erneut auf GitHub hochladen. Die App lädt beim nächsten Öffnen die neue Version.
- **Kostenlose Grenzen (Firebase Spark):** 50.000 Lesevorgänge, 20.000 Schreibvorgänge und 1 GB Speicher pro Tag bzw. insgesamt. Für private Nutzung reicht das bei Weitem. Ohne hinterlegte Kreditkarte können keine Kosten entstehen.
- **Eigene Bilder** werden verkleinert direkt in der Datenbank gespeichert. Am besten nutzt du TMDb-Poster oder Bild-URLs.
- **Demo-Modus:** Solange `firebase-config.js` leer ist, kannst du die App lokal im Demo-Modus ansehen. Die Daten liegen dann nur in diesem Browser.
