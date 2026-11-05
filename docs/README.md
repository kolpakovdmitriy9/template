# 3D-карта с едущей машиной

- `index.html` + `main.js` — сцена на three.js (вращение мышью/пальцем, колесо — масштаб).
- `data/scene.json` — карта, сконвертированная из DXF (`python3 -I tools/export_dxf.py in.dxf docs/data/scene.json`, нужен `pip install ezdxf`).
- Машина: `docs/models/car.obj` (toycar1.obj), части красятся по именам в `PAINT` в `main.js`; цвет кузова — `YELLOW`. Запасные варианты: `car.stl`, `car.glb`.

Запуск: `cd docs && python3 -m http.server 8765` → http://localhost:8765
