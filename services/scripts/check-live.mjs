// Live check of the real forecast source (no key). Usage: node scripts/check-live.mjs [lat] [lon]
const lat = process.argv[2] ?? "26.18";
const lon = process.argv[3] ?? "91.75";
const url = `https://flood-api.open-meteo.com/v1/flood?latitude=${lat}&longitude=${lon}&daily=river_discharge&forecast_days=7`;
const res = await fetch(url);
if (!res.ok) throw new Error(`HTTP ${res.status}`);
const j = await res.json();
console.log("source:", url);
console.log("grid cell:", j.latitude, j.longitude);
console.log(j.daily.time.map((t, i) => `${t}: ${j.daily.river_discharge[i]} m3/s`).join("\n"));
