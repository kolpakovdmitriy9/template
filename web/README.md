# 3D-карта с едущей машиной

- `index.html` + `main.js` — сцена на three.js (вращение мышью/пальцем, колесо — масштаб).
- `data/scene.json` — карта, сконвертированная из DXF (`python3 -I tools/export_dxf.py in.dxf web/data/scene.json`, нужен `pip install ezdxf`).
- Машина: положите свою модель в `web/models/car.glb` — она сама масштабируется под ширину дороги. Без файла показывается простая модель-заглушка.

Запуск: `cd web && python3 -m http.server 8765` → http://localhost:8765
