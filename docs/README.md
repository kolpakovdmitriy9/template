# 3D-карта с едущей машиной

- `index.html` + `main.js` — сцена на three.js (вращение мышью/пальцем, колесо — масштаб, кнопка «Следить за машиной»).
- `data/scene.json` — карта из DXF: `pip install ezdxf shapely` и `python3 -I tools/export_dxf.py in.dxf docs/data/scene.json`.
  Экспорт опускает рельеф под водой (чтобы не было полос посередине реки) и помечает мосты.
- Машина: `models/car.glb` (Tesla Cybertruck из .blend через Blender/bpy). Цвет кузова — `YELLOW`, масштаб — `CAR_SCALE` (0.5), в `main.js`.
- Едет только по проезжим дорогам (`MIN_W`, по умолчанию 6 м, включая мосты), по правой полосе; колёса вращаются и поворачиваются,
  в поворотах машина тормозит и загораются задние огни; на тупиках разворачивается.
- Палитра — словарь `PAL` в `main.js`.

Запуск: `cd docs && python3 -m http.server 8765` → http://localhost:8765
