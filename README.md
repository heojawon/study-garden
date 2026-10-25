# Study Garden

Study Garden is a study-time tracking app for learners. It combines subject-based
sessions, focus timers, goals, study history, statistics, and customizable garden
themes. The web and mobile apps are developed as separate clients and use Firebase
for account identity and cross-device data.

## Web app

### Requirements

- Node.js 20 or later
- npm
- Firebase CLI for emulator and deployment commands

### Run locally

```bash
npm install
npm run dev
```

Copy `.env.example` to `.env.local` and add the Firebase web app configuration
before testing cloud authentication and Firestore. Without these values, the app
uses browser-local storage; local-only data does not sync to another device.
Do not commit `.env.local` or service-account credentials.

### Firebase project

The Firebase project is `study-garden-web-2026`; `.firebaserc` selects it as the
default project for Firebase CLI commands. Its web app is registered, and the
Firestore database is provisioned in `asia-northeast3` (Seoul) with the rules in
`firestore.rules`.

In the Firebase console, enable **Anonymous** and **Email/Password** sign-in under
Authentication. Add the Firebase web app configuration to `.env.local` using the
variable names in `.env.example`. Deploy rule changes with:

```bash
firebase deploy --only firestore:rules
```

Firebase web configuration is client-side configuration, not a service-account
credential. Never put private keys or service-account JSON in the web app.

### Firebase emulators

Start the local Auth and Firestore emulators:

```bash
npm run emulators
```

Set `VITE_USE_FIREBASE_EMULATOR=true` in `.env.local` and start the Vite server in
a second terminal. Firestore rules tests run with:

```bash
npm run test:rules
```

### Checks

```bash
npm test
npm run typecheck
npm run build
```

## Data and privacy

The app stores study records under the authenticated user's Firestore path.
Firestore offline persistence is enabled in the web client. Local timer recovery
state remains on the device and is not uploaded. Firestore security rules restrict
records to their owner. Account linking preserves the anonymous account, and
account deletion removes the user's stored data.
