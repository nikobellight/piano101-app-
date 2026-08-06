// v1.3
// v1.3: added logAvailableServices() — a diagnostic that checks a
// handful of standard BLE service UUIDs (battery, device info, generic
// access/attribute) after connecting and logs to the console which ones
// the GPP-101 actually responds to, plus their characteristics. Web
// Bluetooth can't list "everything" blindly (privacy restriction) — this
// only tests named candidates, so it's a lead-gathering tool, not a full
// inventory.
//
// v1.2  
// v1.2: battery test — tries reading the standard BLE Battery Service
// (0x180F/0x2A19) after connecting, since the GPP-101's own proprietary
// protocol has nothing battery-related in it that's been reverse
// -engineered so far. Fails silently if unsupported (this.batteryLevel
// stays null) — see tryReadBattery(). Subscribes to notifications too,
// if the characteristic supports it, so the % stays live.
// v1.1
// ble.js — Web Bluetooth wrapper for the GPP-101, using the protocol we
// v1.1: sendLedOn/Off now use writeValueWithoutResponse when available —
// no per-command BLE ack means a chord's LEDs can fire almost together
// instead of visibly lighting one at a time on a chord. Falls back to the
// acked write if the device doesn't support it. Note on/off (actual
// sound-triggering commands) are untouched, still acked.
// reverse-engineered and validated earlier (service/characteristic UUIDs,
// frame format, LED command). Reused as-is, not re-derived.
//
// Exposes: connect(), sendNoteOn/Off(), sendLedOn/Off(), and callbacks
// (onNoteOn / onNoteOff) fired when a REAL physical key is pressed —
// this is what powers Wait Mode.

const GPP101_SERVICE_UUID = "03b80e5a-ede8-4b33-a751-6ce34ec4c700";
const GPP101_CHARACTERISTIC_UUID = "7772e5db-3868-4112-a1a9-f2669d106bf3";

// Diagnostic only (see logAvailableServices()) — a handful of STANDARD
// BLE service UUIDs to test for. Web Bluetooth only allows accessing
// services listed here in advance (a privacy restriction on the API) —
// there is no way to ask a device to "list everything" blindly, so this
// can only report on candidates we already suspect, not a true inventory
// of whatever the GPP-101 actually exposes.
const DIAGNOSTIC_SERVICE_CANDIDATES = [
  "battery_service",
  "device_information",
  "generic_access",
  "generic_attribute",
];

class GPP101 {
  constructor() {
    this.device = null;
    this.characteristic = null;
    this.connected = false;
    this.onNoteOn = null;   // (note) => {}
    this.onNoteOff = null;  // (note) => {}
    this.onDisconnected = null;
    this.batteryLevel = null;   // 0-100, or null if unavailable
    this.onBatteryLevel = null; // (percent) => {}
  }

  buildFrame(bytes) {
    return new Uint8Array([0x80, 0x80, ...bytes, 0xf7]);
  }

  async connect() {
    this.device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [GPP101_SERVICE_UUID] }],
      optionalServices: DIAGNOSTIC_SERVICE_CANDIDATES,
    });

    this.device.addEventListener("gattserverdisconnected", () => {
      this.connected = false;
      if (this.onDisconnected) this.onDisconnected();
    });

    const server = await this.device.gatt.connect();
    const service = await server.getPrimaryService(GPP101_SERVICE_UUID);
    this.characteristic = await service.getCharacteristic(GPP101_CHARACTERISTIC_UUID);

    await this.characteristic.startNotifications();
    this.characteristic.addEventListener("characteristicvaluechanged", (event) => {
      this.handleNotification(event.target.value);
    });

    this.connected = true;
    await this.tryReadBattery(server);
    await this.logAvailableServices(server);
    return this.device.name || "GPP-101";
  }

  // Diagnostic — logs to the browser console which of the standard
  // service candidates above the GPP-101 actually responds to, and
  // their characteristics, so we have something concrete to look at
  // if tryReadBattery() comes up empty. Open the console (F12 on
  // desktop, or remote-debug the tablet) right after connecting to see
  // the results.
  async logAvailableServices(server) {
    console.log("[GPP101] Checking standard service candidates…");
    for (const uuid of DIAGNOSTIC_SERVICE_CANDIDATES) {
      try {
        const service = await server.getPrimaryService(uuid);
        const chars = await service.getCharacteristics();
        console.log(
          `[GPP101] FOUND "${uuid}" — characteristics:`,
          chars.map((c) => c.uuid)
        );
      } catch (err) {
        console.log(`[GPP101] not present: "${uuid}"`);
      }
    }
  }

  // Test: the GPP-101's own proprietary protocol has no battery info in
  // anything reverse-engineered so far — this tries the STANDARD BLE
  // Battery Service (0x180F / battery_level 0x2A19) instead, which many
  // devices expose as a secondary service alongside their own. Fails
  // silently (this.batteryLevel stays null) if the GPP-101 doesn't have
  // it — that's the answer to "does this work at all", not an error.
  async tryReadBattery(server) {
    this.batteryLevel = null;
    try {
      const batteryService = await server.getPrimaryService("battery_service");
      const batteryChar = await batteryService.getCharacteristic("battery_level");
      const value = await batteryChar.readValue();
      this.batteryLevel = value.getUint8(0);
      if (this.onBatteryLevel) this.onBatteryLevel(this.batteryLevel);

      if (batteryChar.properties && batteryChar.properties.notify) {
        await batteryChar.startNotifications();
        batteryChar.addEventListener("characteristicvaluechanged", (event) => {
          this.batteryLevel = event.target.value.getUint8(0);
          if (this.onBatteryLevel) this.onBatteryLevel(this.batteryLevel);
        });
      }
    } catch (err) {
      this.batteryLevel = null;
    }
  }

  disconnect() {
    if (this.device && this.device.gatt.connected) {
      this.device.gatt.disconnect();
    }
    this.connected = false;
  }

  handleNotification(dataView) {
    const bytes = new Uint8Array(dataView.buffer);
    if (bytes[0] !== 0x80 || bytes[1] !== 0x80) return;

    const opcode = bytes[2];
    const note = bytes[3];

    if (opcode === 0x90 && this.onNoteOn) {
      this.onNoteOn(note);
    } else if (opcode === 0x80 && this.onNoteOff) {
      this.onNoteOff(note);
    }
  }

  async write(bytes, { noResponse = false } = {}) {
    if (!this.characteristic) return;
    const frame = this.buildFrame(bytes);
    // LED commands use writeValueWithoutResponse when the device supports
    // it: no round-trip ack means several LEDs can be fired back-to-back
    // without each one waiting on the last, instead of visibly lighting
    // up one at a time on a chord. Falls back to the acked write if the
    // characteristic doesn't support it.
    if (noResponse && this.characteristic.writeValueWithoutResponse) {
      await this.characteristic.writeValueWithoutResponse(frame);
    } else {
      await this.characteristic.writeValueWithResponse(frame);
    }
  }

  sendNoteOn(note) {
    return this.write([0x90, note, 0x50]);
  }

  sendNoteOff(note) {
    return this.write([0x80, note, 0x00]);
  }

  sendLedOn(note) {
    return this.write([0xf0, 0x4d, 0x4c, 0x4e, 0x45, note, 0x02, 0x00], { noResponse: true });
  }

  sendLedOff(note) {
    return this.write([0xf0, 0x4d, 0x4c, 0x4e, 0x45, note, 0x00, 0x00], { noResponse: true });
  }
}

window.GPP101 = GPP101;
