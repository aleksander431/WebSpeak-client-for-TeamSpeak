# WebSpeak desktop (Windows)

A small Electron shell around the WebSpeak site of your server:

- opens the configured server (default `https://webts.afire-server.space`, changeable in Settings);
- keeps running in the tray, starts with Windows (minimized), one instance only;
- global hotkeys for microphone, sound and screen sharing that also work inside games
  (a game running as administrator needs WebSpeak started as administrator too);
- its own window/screen picker for sharing, optionally with system sound;
- updates itself from the GitHub releases of this repository (`latest.yml` + installer).

```sh
npm ci
npm start          # run from source
npm run dist       # Windows installer in release/ (build on Windows)
```

Tests run with the repository's `npm test` (`desktop/src/*.test.ts`).
The installer is not code-signed, so Windows SmartScreen asks once to confirm ("More info" → "Run anyway").
