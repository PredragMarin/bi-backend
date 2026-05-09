# SANITIZE DXF v0.1 - Deploy Notes (HR)

## Trenutno isporučeni oblik

`sanitize_dxf_v0` je sada isporučen kao:

- zaseban uzak runtime unutar postojećeg backenda
- posebna API ruta:
  - `/api/sanitize-dxf/v0/check`
- poseban UI:
  - `/ui/sanitize-dxf`

To znači:

- nema ERP ovisnosti
- nema DBR ovisnosti
- nema Mother DXF authoring workflow šume
- ali još **nije** zapakiran kao samostalni Windows `.exe`

## Što kolega može koristiti odmah

Ako kolega s drugog PC-a ima mrežni pristup backend stroju, dovoljno je:

1. otvoriti browser
2. otići na:
   - `http://<backend-host>:3000/ui/sanitize-dxf`
3. učitati DXF
4. pokrenuti `Run Sanitize Check`

## Što alat radi

- structural sanitize pass nad DXF-om
- geometry hygiene check
- vizualne markere na kanvasu
- listu grešaka i kratku dijagnozu
- XDATA context summary
- razlikovanje:
  - `degenerate_line`
  - `micro_line`
  - `collinear_overlap_cluster`
  - `expected_variant_overlap`

## Što alat ne radi

- ne sprema Mother DXF session
- ne radi TOPO authoring
- ne radi SEM authoring
- ne radi child generation
- ne radi ERP/DBR ingest

## Za puni autonomni Windows alat

Za pravi `double-click` alat na koleginom PC-u i dalje treba:

1. Windows packaging korak
2. portable build ili installer build
3. test na ciljnom Windows 11 x64 računalu

Najrealniji sljedeći packaging target:

- `portable zip + exe`

## Preporuka za sada

Za hitni timski rad:

- koristiti browser pristup novom `sanitize_dxf_v0` hostu
- paralelno pripremiti packaging korak za kasniji `portable zip + exe`
