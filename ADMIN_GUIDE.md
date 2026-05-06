# 🛰️ GPS Tracking Platform: Master Admin Guide

Welcome to the Administrator Master Guide. This document contains everything you need to know to run, manage, and scale your premium GPS tracking SaaS.

---

## 🚀 1. Starting the Infrastructure

### A. Starting the Main Server
The server is the "Brain" of the operation. it handles the Web Dashboard (Port 3000) and the GPS Hardware connections (Port 8080).
1. Open a terminal in the project folder.
2. Run the command:
   ```bash
   node server.js
   ```
3. **Success Check:** You should see `[HTTP] Web Interface listening on http://localhost:3000` and `[TCP] GPS Tracker Server listening on port 8080`.

### B. Starting the Simulator (For Testing)
If you don't have a real device connected and want to test features:
1. Open a *second* terminal.
2. Run the command:
   ```bash
   node simulator.js
   ```

---

## 🔌 2. Connecting Real GPS Hardware

The system is built on the **Bharat-101 (iTriangle)** protocol.

### Device Configuration
To connect a physical GPS tracker, configure it with the following settings using SMS or Configuration Tool:
- **IP/Host:** Your Server's Public IP (e.g., `122.160.x.x` or `localhost` for local tests).
- **Port:** `8080`
- **Protocol:** `Bharat-101` or `iTriangle TS101`.
- **APN:** Your SIM card's APN (e.g., `airtelgprs.com`).

---

## 👮 3. Admin Dashboard Capabilities

Log in to the **Admin Dashboard** (`http://localhost:3000/admin.html`) to manage the platform.

### A. Approving New Devices
When a customer requests a device via its IMEI, it appears in your "Pending Requests" list.
- **Approve:** Moves the device into the active tracking pool.
- **Reject:** Removes the request.

### B. Real-Time Raw Logs
The Admin Dashboard features a **Live Console**. This shows the raw hex data coming from the hardware. If a device isn't showing up on the map, check these logs to see if the server is receiving its "Heartbeat."

---

## 📂 4. Data Management (The Source of Truth)

All data (Users, Devices, History, Geofences) is stored in a single file:
- **File:** `data.json`

### Important Rules:
1. **Backups:** Periodically copy this file to a safe location. If the file is deleted, all tracking history and user accounts are lost.
2. **Manual Edits:** You can edit this file manually while the server is **STOPPED**. Do not edit it while the server is running, as the server might overwrite your changes.

---

## 🚨 5. Handling Emergencies (Panic Button)

The system is hardwired to detect the **`EA` (Emergency Alert)** packet.
- **Automatic Broadcast:** The server identifies an SOS signal and pushes it to the specific owner's dashboard instantly.
- **Admin Visibility:** Admins can see SOS alerts in the server console: `[ALARM] PANIC BUTTON PRESSED`.

---

## 🔧 6. Troubleshooting

| Issue | Solution |
| :--- | :--- |
| **Port 3000/8080 already in use** | Another app is using these ports. Close other Node.js windows or restart your computer. |
| **Device not moving on map** | Check the **Live Log**. Ensure the device has a "GPS Fix" (indicated by "3D Fix" in the telemetry). |
| **"Connection Failed" on Save** | Restart the server. The server needs a reboot to apply any code changes made to `server.js`. |
| **Browser doesn't show updates** | Hard Refresh (**Ctrl + F5**) to clear the browser cache. |

---

*Manual version: 1.2*  
*Status: Production Ready*  
