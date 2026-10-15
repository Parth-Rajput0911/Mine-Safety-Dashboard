# MineGuard AI Dashboard

## Files
- `index.html` — page structure
- `style.css` — visual design and responsive layout
- `script.js` — Supabase query, cards, history table and Chart.js graphs

## Setup
1. Keep all three files in the same folder.
2. Open `script.js`.
3. Replace `YOUR_SUPABASE_PUBLISHABLE_KEY` with your Supabase **publishable/anon key**.
   Never use the service-role/secret key or the ESP32 device token in browser code.
4. Confirm the table is named `sensor_readings` and has the columns queried in `script.js`.
5. In VS Code, use the Live Server extension and open `index.html`.
6. If the dashboard reports permission denied, configure a suitable SELECT policy for the intended audience. Do not disable Row Level Security just to make the dashboard work.

## Notes
- It refreshes every 5 seconds and charts the most recent 20 rows.
- Chart.js and Supabase JS load from CDNs, so internet access is required.
- MQ-2/MQ-4/MQ-7 values are shown as raw ADC values, not calibrated gas concentrations in ppm.
- This is a student project prototype, not certified mine-safety equipment.
