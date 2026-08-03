// v1.1
// ble.js — Web Bluetooth wrapper for the GPP-101, using the protocol we
// reverse-engineered and validated earlier (service/characteristic UUIDs,
// frame format, LED command). Reused as-is, not re-derived.
//
// Exposes: connect(), reconnect(device), sendNoteOn/Off(), sendLedOn/Off(),
// and callbacks (onNoteOn / onNoteOff) fired when a REAL physical key is
// pressed — this is what powers Wait Mode.
//
// v1.1: added reconnect(device) — binds to a device the browser already
// granted access to (via navigator.bluetooth.getDevices()) without
// showing the picker again. Used by ble-ui.js for silent reconnection on
// every page load.

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
  }

  buildFrame(bytes) {
    return new Uint8Array([0x80, 0x80, ...bytes, 0xf7]);
  }

  // Opens the browser's device picker — first-time pairing.
  async connect() {
    const device = await navigator.bluetooth.requestDevice({
      filters: [{ services: [GPP101_SERVICE_UUID] }],
    });
    return this.bindDevice(device);
  }

  // Binds directly to a device object already granted to this origin
  // (e.g. from navigator.bluetooth.getDevices()) — no picker shown.
  async reconnect(device) {
    return this.bindDevice(device);
  }

  async bindDevice(device) {
    this.device = device;

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
    return this.device.name || "GPP-101";
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

  async write(bytes) {
    if (!this.characteristic) return;
    await this.characteristic.writeValueWithResponse(this.buildFrame(bytes));
  }

  sendNoteOn(note) {
    return this.write([0x90, note, 0x50]);
  }

  sendNoteOff(note) {
    return this.write([0x80, note, 0x00]);
  }

  sendLedOn(note) {
    return this.write([0xf0, 0x4d, 0x4c, 0x4e, 0x45, note, 0x02, 0x00]);
  }

  sendLedOff(note) {
    return this.write([0xf0, 0x4d, 0x4c, 0x4e, 0x45, note, 0x00, 0x00]);
  }
}

window.GPP101 = GPP101;
