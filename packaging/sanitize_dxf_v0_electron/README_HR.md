# sanitize_dxf_v0 Electron packaging scaffold

Ovaj folder je **Windows packaging shell** za `sanitize_dxf_v0`.

Ne sadrži poslovnu logiku sanitize enginea, nego samo desktop delivery sloj:

- pokretanje embedded lokalnog sanitize servera
- otvaranje vlastitog prozora
- build targete za:
  - `portable`
  - `nsis installer`

## Što očekujemo na Windows build stroju

- Windows 11 x64
- Node.js 24.x
- lokalna kopija ovog foldera i potrebnih source fajlova iz repoa

## Build komande

### Dev proba
```bat
npm install
npm start
```

### Portable build
```bat
npm install
npm run dist:win-portable
```

### Installer build
```bat
npm install
npm run dist:win-installer
```

## Očekivani output

U `dist/` folderu:

- portable `.exe`
- NSIS installer `.exe`

## Važna napomena

Ovaj scaffold radi s `extraResources` kopiranjem odabranih source fajlova iz glavnog repoa.
To znači da build treba raditi iz lokalne kopije repoa ili iz lokalno prenesenog packaging workspacea, ne idealno direktno sa sporog mrežnog sharea.
