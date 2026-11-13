# WebSpeak desktop (Windows)

A small Electron shell around the WebSpeak site of your server:

- asks for the server address on first start, remembers it and opens it from then on (changeable in Settings);
- keeps running in the tray, starts with Windows (minimized), one instance only;
- global hotkeys for microphone, sound and screen sharing that also work inside games — single keys such as F-keys, numpad or Pause and the mouse side buttons included (`native/hotkeys.cpp` for what Electron cannot register)
  (a game running as administrator needs WebSpeak started as administrator too);
- its own window/screen picker for sharing, optionally with the PC's sound — on Windows 10 2004+ without WebSpeak's own voices (`native/audio-capture.cpp`, process loopback);
- push-to-talk on any held key or mouse button, without taking the key from games;
- whisper on a held key or mouse button too: hold it to whisper to the members you chose;
- an optional in-game overlay (off by default; Settings or the tray) listing who is in your channel, who is talking and who is sharing a screen, click-through and always on top — position (a corner or the middle of a side), size, opacity, offset and "everyone / only talkers" are configurable; exclusive full-screen games hide it, borderless mode does not;
- updates itself from the GitHub releases of this repository (`latest.yml` + installer).

```sh
npm ci
npm start          # run from source
npm run native     # build native/bin/webspeak-audio-capture.exe (needs mingw-w64)
npm run dist       # Windows installer in release/ (build on Windows)
```

Tests run with the repository's `npm test` (`desktop/src/*.test.ts`).
The installer is not code-signed, so Windows SmartScreen asks once to confirm ("More info" → "Run anyway").
