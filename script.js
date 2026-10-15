// MineGuard AI dashboard
// Replace the publishable key below with your Supabase project's publishable/anon key.
// NEVER put a service_role/secret key or your ESP32 device token in browser code.

const SUPABASE_URL = "https://pfrxeihyzzzmixoqzacn.supabase.co";
const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_VJR4vnkOIZRFQ9toWWWsiw_AonOTPVT";
const TABLE_NAME = "sensor_readings";
const REFRESH_INTERVAL_MS = 5000;
const HISTORY_LIMIT = 20;

const $ = (id) => document.getElementById(id);
let supabaseClient = null;
let trendChart = null;
let motionChart = null;
let historyRows = [];
let lastRecordTimestamp = null;
let toastTimer = null;

function showToast(message, isError = false) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.toggle("error", isError);
  toast.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove("show"), 4200);
}

function setConnectionState(kind, message, state) {
  const map = {
    database: ["dbStatus", "dbState", "dbDot"],
    device: ["deviceStatus", "deviceState", "deviceDot"]
  };
  const [statusId, stateId, dotId] = map[kind];
  $(statusId).textContent = message;
  $(stateId).textContent = state;
  $(dotId).classList.remove("good", "bad");
  if (state === "ONLINE" || state === "FRESH") $(dotId).classList.add("good");
  else if (state === "ERROR" || state === "STALE") $(dotId).classList.add("bad");
  if (kind === "database") $("sideConnection").textContent = message;
}

function num(value, decimals = 1) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return Number(value).toFixed(decimals);
}
function raw(value) {
  if (value === null || value === undefined || value === "" || !Number.isFinite(Number(value))) return "—";
  return Math.round(Number(value)).toLocaleString();
}
function timestamp(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
function fullTimestamp(value) {
  if (!value) return "—";
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : d.toLocaleString();
}
function setText(id, value) { $(id).textContent = value; }
function clampPercent(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(100, (n / 4095) * 100));
}

function initializeCharts() {
  if (!window.Chart) {
    showToast("Chart.js could not load. Check your internet connection.", true);
    return;
  }
  const commonOptions = {
    responsive: true, maintainAspectRatio: false, animation: { duration: 350 },
    interaction: { intersect: false, mode: "index" },
    plugins: {
      legend: { display: false },
      tooltip: { backgroundColor: "#111a2e", titleColor: "#f2f5ff", bodyColor: "#d5e0f6", borderColor: "#35425c", borderWidth: 1, padding: 10 }
    },
    scales: {
      x: { grid: { display: false }, ticks: { color: "#7585a4", maxTicksLimit: 6, font: { size: 9 } }, border: { display: false } },
      y: { grid: { color: "rgba(160,180,220,.09)" }, ticks: { color: "#7585a4", font: { size: 9 } }, border: { display: false } }
    }
  };
  const trendCtx = $("trendChart").getContext("2d");
  const gradient = trendCtx.createLinearGradient(0, 0, 0, 250);
  gradient.addColorStop(0, "rgba(56,217,245,.28)");
  gradient.addColorStop(1, "rgba(56,217,245,0)");
  trendChart = new Chart(trendCtx, {
    type: "line",
    data: { labels: [], datasets: [{ label: "Reading", data: [], borderColor: "#38d9f5", backgroundColor: gradient, fill: true, tension: .38, borderWidth: 2.5, pointRadius: 2, pointHoverRadius: 5, pointBackgroundColor: "#38d9f5" }] },
    options: { ...commonOptions, scales: { ...commonOptions.scales, y: { ...commonOptions.scales.y, beginAtZero: false } } }
  });
  motionChart = new Chart($("motionChart").getContext("2d"), {
    type: "line",
    data: { labels: [], datasets: [
      { label: "AX", data: [], borderColor: "#38d9f5", tension: .35, borderWidth: 2, pointRadius: 0 },
      { label: "AY", data: [], borderColor: "#9a7bff", tension: .35, borderWidth: 2, pointRadius: 0 },
      { label: "AZ", data: [], borderColor: "#ffb15e", tension: .35, borderWidth: 2, pointRadius: 0 }
    ] },
    options: { ...commonOptions, plugins: { ...commonOptions.plugins, legend: { display: false } } }
  });
}

function renderLatest(row) {
  setText("temperature", num(row.temperature));
  setText("humidity", num(row.humidity));
  setText("mq2", raw(row.mq2));
  setText("mq4", raw(row.mq4));
  setText("mq7", raw(row.mq7));
  setText("distance", num(row.distance));
  setText("az", raw(row.az));

  const temp = Number(row.temperature);
  setText("tempStatus", Number.isFinite(temp) ? (temp >= 35 ? "Elevated temperature — review" : "Environmental reading received") : "No value received");
  setText("humidityStatus", Number.isFinite(Number(row.humidity)) ? "Humidity reading received" : "No value received");
  $("humidityBar").style.width = `${Math.max(0, Math.min(100, Number(row.humidity) || 0))}%`;
  $("mq4Bar").style.width = `${clampPercent(row.mq4)}%`;
  $("mq7Bar").style.width = `${clampPercent(row.mq7)}%`;
  setText("mq2Status", row.mq2 == null ? "No value received" : "Raw ADC signal · not ppm");
  setText("mq4Status", row.mq4 == null ? "No value received" : "Raw ADC signal · not ppm");
  setText("mq7Status", row.mq7 == null ? "No value received" : "Raw ADC signal · not ppm");
  setText("distanceStatus", Number.isFinite(Number(row.distance)) ? "Distance measurement received" : "No value received");

  const flameDetected = row.flame_detected === true || row.flame_detected === 1 ||
    (typeof row.flame_detected === "string" && ["true", "1", "detected", "yes"].includes(row.flame_detected.toLowerCase()));
  const flameKnown = row.flame_detected !== null && row.flame_detected !== undefined;
  setText("flameState", !flameKnown ? "Awaiting reading" : flameDetected ? "Flame signal detected" : "No flame signal reported");
  setText("flameDetail", !flameKnown ? "Check the flame sensor field in your data." : flameDetected ? "Treat as a prototype warning; verify the physical situation." : "The latest record reports no flame signal.");
  $("flameBadge").textContent = !flameKnown ? "UNKNOWN" : flameDetected ? "CHECK NOW" : "NO SIGNAL";
  $("flameBadge").className = `alert-badge ${!flameKnown ? "neutral" : flameDetected ? "danger" : "good"}`;

  setText("motionBadge", "RAW DATA");
  setText("lastUpdated", timestamp(row.created_at));
  setConnectionState("device", `Latest record: ${fullTimestamp(row.created_at)}`, "FRESH");
}

function renderHistory(rows) {
  const body = $("historyBody");
  $("historyCount").textContent = `${rows.length} record${rows.length === 1 ? "" : "s"}`;
  if (!rows.length) {
    body.innerHTML = '<tr><td colspan="7" class="empty-cell">No sensor records found.</td></tr>';
    return;
  }
  body.innerHTML = rows.slice(0, 8).map(row => {
    const flameDetected = row.flame_detected === true || row.flame_detected === 1 ||
      (typeof row.flame_detected === "string" && ["true", "1", "detected", "yes"].includes(row.flame_detected.toLowerCase()));
    const flameKnown = row.flame_detected !== null && row.flame_detected !== undefined;
    const flameLabel = !flameKnown ? "UNKNOWN" : flameDetected ? "DETECTED" : "CLEAR";
    return `<tr>
      <td>${timestamp(row.created_at)}</td><td>${num(row.temperature)}°</td><td>${num(row.humidity)}%</td>
      <td>${raw(row.mq2)}</td><td>${raw(row.mq4)}</td><td>${raw(row.mq7)}</td>
      <td><span class="table-flame ${flameDetected ? "detected" : ""}">${flameLabel}</span></td>
    </tr>`;
  }).join("");
}

function updateCharts(rows) {
  if (!trendChart || !motionChart) return;
  const ordered = [...rows].reverse();
  const labels = ordered.map(r => timestamp(r.created_at));
  const metric = $("chartMetric").value;
  const metricNames = { temperature: "Temperature (°C)", humidity: "Humidity (%)", mq2: "MQ-2 raw ADC", mq4: "MQ-4 raw ADC", mq7: "MQ-7 raw ADC", distance: "Distance (cm)" };
  const colorMap = { temperature: "#ffb15e", humidity: "#38d9f5", mq2: "#ff6fae", mq4: "#9a7bff", mq7: "#48e0a4", distance: "#6ca9ff" };
  trendChart.data.labels = labels;
  trendChart.data.datasets[0].label = metricNames[metric] || metric;
  trendChart.data.datasets[0].data = ordered.map(r => r[metric] == null ? null : Number(r[metric]));
  trendChart.data.datasets[0].borderColor = colorMap[metric] || "#38d9f5";
  trendChart.data.datasets[0].pointBackgroundColor = colorMap[metric] || "#38d9f5";
  const ctx = $("trendChart").getContext("2d");
  const grad = ctx.createLinearGradient(0, 0, 0, 250);
  grad.addColorStop(0, `${colorMap[metric] || "#38d9f5"}45`);
  grad.addColorStop(1, `${colorMap[metric] || "#38d9f5"}00`);
  trendChart.data.datasets[0].backgroundColor = grad;
  trendChart.update("none");

  motionChart.data.labels = labels;
  for (const [index, key] of ["ax", "ay", "az"].entries()) {
    motionChart.data.datasets[index].data = ordered.map(r => r[key] == null ? null : Number(r[key]));
  }
  motionChart.update("none");
}

async function fetchSensorData(showMessage = false) {
  if (!supabaseClient) return;
  const refresh = $("refreshBtn");
  refresh.disabled = true;
  refresh.style.opacity = ".7";
  try {
    const { data, error } = await supabaseClient
      .from("sensor_readings")
      .select("created_at,temperature,humidity,mq2,mq4,mq7,distance,ax,ay,az,flame_detected")
      .order("created_at", { ascending: false })
      .limit(HISTORY_LIMIT);
    if (error) throw error;
    if (!data || data.length === 0) {
      setConnectionState("database", "Connected; no rows returned", "ONLINE");
      setConnectionState("device", "No sensor records found", "STALE");
      renderHistory([]);
      if (showMessage) showToast("Connected to Supabase, but the table returned no visible rows.");
      return;
    }
    historyRows = data;
    setConnectionState("database", "Database query successful", "ONLINE");
    renderLatest(data[0]);
    renderHistory(data);
    updateCharts(data);
    const newest = data[0].created_at || "";
    if (showMessage) showToast(newest === lastRecordTimestamp ? "Dashboard refreshed. No newer record yet." : "Dashboard updated with the latest sensor data.");
    lastRecordTimestamp = newest;
  } catch (error) {
    console.error("Supabase query error:", error);
    setConnectionState("database", error.message || "Query failed", "ERROR");
    setConnectionState("device", "Could not read latest data", "STALE");
    if (showMessage) showToast(`Could not load data: ${error.message || "Unknown error"}`, true);
  } finally {
    refresh.disabled = false;
    refresh.style.opacity = "1";
  }
}

function updateClock() {
  setText("currentTime", new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }));
}

function startDashboard() {
  updateClock();
  setInterval(updateClock, 1000);
  initializeCharts();

  if (SUPABASE_PUBLISHABLE_KEY === "YOUR_SUPABASE_PUBLISHABLE_KEY" || !SUPABASE_PUBLISHABLE_KEY.trim()) {
    setConnectionState("database", "Add your publishable key in script.js", "ERROR");
    showToast("Open script.js and add your Supabase publishable key first.", true);
    return;
  }
  if (!window.supabase) {
    setConnectionState("database", "Supabase library failed to load", "ERROR");
    showToast("Supabase library did not load. Check your internet connection.", true);
    return;
  }
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
  $("refreshBtn").addEventListener("click", () => fetchSensorData(true));
  $("chartMetric").addEventListener("change", () => updateCharts(historyRows));
  fetchSensorData();
  setInterval(() => fetchSensorData(false), REFRESH_INTERVAL_MS);
}

document.addEventListener("DOMContentLoaded", startDashboard);
