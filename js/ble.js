// v1.4
// v1.4: real battery reading, from a fresh BLE capture of POP Piano
// (analyzed byte-by-byte — see chat). The GPP-101's GATT structure has
// only 2 services total (Generic Access + our one proprietary service),
// confirmed by 3 independent captures — no separate battery service
// exists. But POP Piano queries battery through the SAME proprietary
// characteristic we already use for notes/LEDs: a literal "get" command
// (requestBatteryLevel()), replied to with an f0 0d <value> notification
// (now parsed in handleNotification()). <value> was 0x64 (100) in every
// capture — consistent with a full battery, though never seen at any
// other level yet to fully confirm the byte position. Replaces v1.2/v1.3's
// standard-BLE-service attempt, which found nothing (removed).
//
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
    await this.requestBatteryLevel();
    return this.device.name || "GPP-101";
  }

  // Reverse-engineered from a fresh BLE capture of POP Piano (see chat):
  // right after connecting, the app writes a literal "get" command
  // (ASCII bytes, params 01 06 00) — UNLIKE every other frame we know,
  // this one is NOT wrapped in the usual 0x80 0x80 prefix, captured
  // exactly as sent. The keyboard immediately replies with a
  // notification whose payload is f0 0d <value> — <value> was 0x64
  // (100) in every single capture taken so far, which strongly suggests
  // a full battery reading, though it's never been seen at any other
  // level yet to confirm the byte position for certain.
  async requestBatteryLevel() {
    if (!this.characteristic) return;
    try {
      await this.characteristic.writeValueWithResponse(
        new Uint8Array([0xf0, 0x00, 0x67, 0x65, 0x74, 0x01, 0x06, 0x00, 0xf7])
      );
    } catch (err) {
      // Nothing to do — battery level just stays whatever it last was
      // (null if this is the first attempt).
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
    } else if (opcode === 0xf0 && bytes[3] === 0x0d) {
      // Reply to requestBatteryLevel()'s "get" command — see its comment.
      this.batteryLevel = bytes[4];
      if (this.onBatteryLevel) this.onBatteryLevel(this.batteryLevel);
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
