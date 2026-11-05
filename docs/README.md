# 3D-карта с едущей машиной

- `index.html` + `main.js` — сцена на three.js (вращение мышью/пальцем, колесо — масштаб).
- `data/scene.json` — карта, сконвертированная из DXF (`python3 -I tools/export_dxf.py in.dxf docs/data/scene.json`, нужен `pip install ezdxf`).
- Машина: `docs/models/car.glb` (Tesla Cybertruck, сконвертирован из .blend через Blender/bpy). Части красятся по именам мешей в `PAINT_GLB` в `main.js`; цвет кузова — `YELLOW`.

Запуск: `cd docs && python3 -m http.server 8765` → http://localhost:8765
