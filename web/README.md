# 3D-карта с едущей машиной

- `index.html` + `main.js` — сцена на three.js (вращение мышью/пальцем, колесо — масштаб).
- `data/scene.json` — карта, сконвертированная из DXF (`python3 -I tools/export_dxf.py in.dxf web/data/scene.json`, нужен `pip install ezdxf`).
- Машина: `web/models/car.stl` (из parametric-model.stl; Z вверх, длина по X). Масштабируется под ширину дороги. Если едет задом наперёд, переключите `CAR_FLIP` в `main.js`. Вместо STL можно положить `car.glb`.

Запуск: `cd web && python3 -m http.server 8765` → http://localhost:8765
