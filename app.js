const DB_NAME = "hadirin-db";
const STORE_NAME = "attendance";
const PERSONAL_BARCODES = {
  MARIA: "OYITOK-MARIA-001",
  SHERLY: "OYITOK-SHERLY-001",
  SAVINA: "OYITOK-SAVINA-001"
};
let selectedLocation = null;
let scannedBarcode = "";
let scannedPerson = "";
let cameraStream = null;
let barcodeDetector = null;
let scannerControls = null;
let locationMap = null;
let locationMarker = null;
let locationWatchId = null;

const $ = (selector) => document.querySelector(selector);
const formatDate = (date) => new Intl.DateTimeFormat("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(date);
const formatTime = (date) => new Intl.DateTimeFormat("id-ID", { hour: "2-digit", minute: "2-digit" }).format(date);

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE_NAME, { keyPath: "id", autoIncrement: true });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function saveRecord(record) {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).add(record);
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
}

function showNotice(message, type = "error") {
  const notice = $("#notice");
  notice.textContent = message;
  notice.className = `notice show ${type}`;
}

function initializeMap() {
  if (!window.L || locationMap) return;
  locationMap = L.map("locationMap", { zoomControl: true }).setView([-6.2, 106.816666], 12);
  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", { maxZoom: 19, subdomains: "abcd", attribution: "© OpenStreetMap © CARTO" }).addTo(locationMap);
}

function updateMap(latitude, longitude) {
  if (!locationMap) initializeMap();
  if (!locationMap) return;
  const coordinates = [latitude, longitude];
  if (!locationMarker) locationMarker = L.marker(coordinates).addTo(locationMap).bindPopup("Lokasi absensi kamu");
  else locationMarker.setLatLng(coordinates);
  locationMap.setView(coordinates, 17);
}

function applyLocation(position) {
  const { latitude, longitude } = position.coords;
  selectedLocation = { latitude, longitude, name: "Lokasi GPS perangkat" };
  $("#locationStatus").textContent = "Lokasi terdeteksi otomatis";
  $("#locationDetail").textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)}`;
  const mapsLink = $("#mapsLink");
  mapsLink.href = `https://www.google.com/maps?q=${latitude},${longitude}`;
  mapsLink.hidden = false;
  updateMap(latitude, longitude);
}

function takeLocation(showError = true) {
  const status = $("#locationStatus");
  const detail = $("#locationDetail");
  if (!navigator.geolocation) { status.textContent = "GPS tidak tersedia"; detail.textContent = "Perangkat ini tidak menyediakan lokasi."; return; }
  status.textContent = "Mencari lokasi...";
  navigator.geolocation.getCurrentPosition((position) => {
    applyLocation(position);
  }, () => { status.textContent = "Lokasi belum diizinkan"; detail.textContent = "Aktifkan izin lokasi pada browser."; if (showError) showNotice("Lokasi wajib diizinkan agar absensi dapat disimpan."); });
}

function watchLocation() {
  if (!navigator.geolocation || locationWatchId !== null) return;
  locationWatchId = navigator.geolocation.watchPosition(applyLocation, () => {}, { enableHighAccuracy: true, maximumAge: 10000, timeout: 15000 });
}

function updateClock() { const now = new Date(); $("#currentTime").textContent = formatTime(now); $("#currentDate").textContent = formatDate(now); }

function stopCamera() {
  if (scannerControls) scannerControls.stop();
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  scannerControls = null;
  cameraStream = null;
  $("#cameraPreview").srcObject = null;
  $("#cameraModal").classList.remove("open");
  $("#cameraModal").setAttribute("aria-hidden", "true");
}

function acceptScan(value) {
  if (!Object.values(PERSONAL_BARCODES).includes(value)) return false;
  scannedBarcode = value;
  scannedPerson = Object.keys(PERSONAL_BARCODES).find((person) => PERSONAL_BARCODES[person] === value);
  stopCamera();
  $("#scanStatus").textContent = `Barcode terverifikasi atas nama ${scannedPerson}.`;
  showNotice(`Barcode ${scannedPerson} berhasil dipindai.`, "success");
  return true;
}

async function scanWithCamera() {
  if (!navigator.mediaDevices?.getUserMedia) { showNotice("Kamera tidak tersedia. Buka aplikasi melalui HTTPS atau localhost."); return; }
  try {
    $("#cameraModal").classList.add("open");
    $("#cameraModal").setAttribute("aria-hidden", "false");
    if (!("BarcodeDetector" in window)) {
      if (!window.ZXing) { $("#cameraMessage").textContent = "Pembaca QR belum tersedia. Periksa koneksi internet lalu coba lagi."; return; }
      $("#cameraMessage").textContent = "Kamera aktif. Arahkan ke QR code personal.";
      const reader = new ZXing.BrowserMultiFormatReader();
      scannerControls = await reader.decodeFromConstraints({ video: { facingMode: { ideal: "environment" } } }, $("#cameraPreview"), (result) => {
        if (result) acceptScan(result.getText());
      });
      return;
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false });
    $("#cameraPreview").srcObject = cameraStream;
    barcodeDetector = new BarcodeDetector({ formats: ["code_128", "code_39", "ean_13", "qr_code"] });
    const scanFrame = async () => {
      if (!cameraStream) return;
      try {
        const results = await barcodeDetector.detect($("#cameraPreview"));
        const result = results.find((item) => Object.values(PERSONAL_BARCODES).includes(item.rawValue));
        if (result && acceptScan(result.rawValue)) return;
      } catch { /* Kamera masih mencari gambar yang terbaca. */ }
      requestAnimationFrame(scanFrame);
    };
    requestAnimationFrame(scanFrame);
  } catch { showNotice("Akses kamera ditolak. Izinkan kamera di browser untuk scan barcode."); }
}

$("#scanButton").addEventListener("click", scanWithCamera);
$("#closeCamera").addEventListener("click", stopCamera);
$("#attendanceForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  const now = new Date();
  if (!Object.values(PERSONAL_BARCODES).includes(scannedBarcode)) { showNotice("Scan salah satu barcode Maria, Sherly, atau Savina terlebih dahulu."); return; }
  if (!selectedLocation) { showNotice("Tambahkan lokasi GPS terlebih dahulu."); return; }
  const isPresent = now.getHours() < 7 || (now.getHours() === 7 && now.getMinutes() <= 45);
  const record = { name: scannedPerson, locationName: selectedLocation.name, latitude: selectedLocation.latitude, longitude: selectedLocation.longitude, status: isPresent ? "Hadir" : "Terlambat", time: formatTime(now), date: now.toISOString(), month: now.getMonth() + 1, year: now.getFullYear() };
  if (!record.name) { showNotice("Scan QR code personal terlebih dahulu."); return; }
  try { await saveRecord(record); showNotice(`Absensi ${record.status.toLowerCase()} berhasil disimpan.`, "success"); $("#attendanceForm").reset(); selectedLocation = null; scannedBarcode = ""; scannedPerson = ""; $("#scanStatus").textContent = "Belum ada barcode yang dipindai."; $("#locationStatus").textContent = "Mendeteksi lokasi otomatis..."; $("#locationDetail").textContent = "Izinkan akses GPS saat browser memintanya. Lokasi akan diperbarui otomatis."; takeLocation(false); } catch { showNotice("Database lokal tidak dapat diakses. Coba muat ulang halaman."); }
});

initializeMap();
watchLocation();
takeLocation(false);
updateClock(); setInterval(updateClock, 1000);