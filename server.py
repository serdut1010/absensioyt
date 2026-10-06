import json
import sqlite3
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
DATABASE = ROOT / "attendance.db"


def initialize_database():
    with sqlite3.connect(DATABASE) as connection:
        connection.execute(
            """CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT NOT NULL,
                locationName TEXT NOT NULL,
                latitude REAL,
                longitude REAL,
                status TEXT NOT NULL,
                time TEXT NOT NULL,
                date TEXT NOT NULL,
                month INTEGER,
                year INTEGER
            )"""
        )


class AttendanceHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def allowed_origin(self):
        origin = self.headers.get("Origin")
        request_host = urlsplit(f"//{self.headers.get('Host', '')}").hostname
        origin_host = urlsplit(origin).hostname if origin else None
        if origin_host and origin_host == request_host:
            return origin
        return None

    def send_json(self, status, payload):
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        origin = self.allowed_origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        self.end_headers()
        self.wfile.write(body)

    def do_OPTIONS(self):
        if urlsplit(self.path).path != "/api/attendance" or not self.allowed_origin():
            self.send_json(403, {"error": "Origin tidak diizinkan"})
            return
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", self.allowed_origin())
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Access-Control-Max-Age", "600")
        self.send_header("Vary", "Origin")
        self.end_headers()

    def do_GET(self):
        if urlsplit(self.path).path != "/api/attendance":
            return super().do_GET()

        with sqlite3.connect(DATABASE) as connection:
            connection.row_factory = sqlite3.Row
            rows = connection.execute(
                "SELECT * FROM attendance ORDER BY date DESC, id DESC"
            ).fetchall()
        self.send_json(200, [dict(row) for row in rows])

    def do_POST(self):
        if urlsplit(self.path).path != "/api/attendance":
            self.send_json(404, {"error": "Endpoint tidak ditemukan"})
            return

        try:
            content_length = int(self.headers.get("Content-Length", "0"))
            if content_length < 1 or content_length > 65536:
                raise ValueError("Ukuran data tidak valid")
            record = json.loads(self.rfile.read(content_length))
            required = ("name", "locationName", "status", "time", "date")
            if any(not str(record.get(field, "")).strip() for field in required):
                raise ValueError("Data absensi belum lengkap")
            if record["status"] not in ("Hadir", "Terlambat"):
                raise ValueError("Status absensi tidak valid")
        except (ValueError, TypeError, json.JSONDecodeError) as error:
            self.send_json(400, {"error": str(error)})
            return

        with sqlite3.connect(DATABASE) as connection:
            cursor = connection.execute(
                """INSERT INTO attendance
                   (name, locationName, latitude, longitude, status, time, date, month, year)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (
                    str(record["name"]).strip(),
                    str(record["locationName"]).strip(),
                    record.get("latitude"),
                    record.get("longitude"),
                    record["status"],
                    str(record["time"]),
                    str(record["date"]),
                    record.get("month"),
                    record.get("year"),
                ),
            )
            record_id = cursor.lastrowid
        self.send_json(201, {"id": record_id, "saved": True})


if __name__ == "__main__":
    initialize_database()
    server = ThreadingHTTPServer(("0.0.0.0", 8080), AttendanceHandler)
    print("Absensi OYITOK GROUP berjalan di http://localhost:8080")
    print("Perangkat lain di Wi-Fi yang sama dapat membuka http://IP-LAPTOP:8080")
    server.serve_forever()
