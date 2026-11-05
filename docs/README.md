# 3D-карта с едущей машиной

Две страницы на одном ядре (`world.js`: карта, машина, маршрут, езда):
- `index.html` + `main.js` — интерактивная сцена (вращение мышью).
- `portfolio.html` + `portfolio.js` — сцена для портфолио: вид строго сверху (камеру менять нельзя), карта обрезана по прямоугольнику `#map-rect`.
  Когда прямоугольник целиком на экране, машина влетает с правого края экрана, въезжает на дорогу, камера плавно отдаляется до всей карты
  (тайминг и масштабы — константы в начале `portfolio.js`). Встраивание: `<div id="map-rect">`, `<canvas id="map-overlay">` и `<script type="module" src="portfolio.js">`
  (плюс `world.js`, `data/scene.json`, `models/car.glb` и importmap из `portfolio.html`).

- `index.html` + `main.js` — сцена на three.js (вращение мышью/пальцем, колесо — масштаб, кнопка «Следить за машиной»).
- `data/scene.json` — карта из DXF: `pip install ezdxf shapely` и `python3 -I tools/export_dxf.py in.dxf docs/data/scene.json`.
  Экспорт опускает рельеф под водой (чтобы не было полос посередине реки) и помечает мосты.
- Машина: `models/car.glb` (Tesla Cybertruck из .blend через Blender/bpy). Цвет кузова — `YELLOW`, масштаб — `CAR_SCALE` (0.5), в `main.js`.
- Едет по заданному маршруту `ROUTE` в `main.js` (куски осей дорог по их номерам в `data.roadGraph.edges`): со стрелки на востоке на запад, затем на юг и на запад. По правой полосе; колёса вращаются и поворачиваются, в поворотах машина тормозит и загораются задние огни; на концах разворачивается и едет обратно.
- Палитра — словарь `PAL` в `main.js`.

Запуск: `cd docs && python3 -m http.server 8765` → http://localhost:8765
