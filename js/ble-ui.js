// v1.1
// ble-ui.js — Shared BLE connect button + status pill, dropped into any
// page that has a <div id="ble-widget"></div>. Renders the button, tries
// a SILENT reconnect on load (Chrome/Edge only, via
// navigator.bluetooth.getDevices() — no picker shown, works only if this
// origin was already granted access to the keyboard before), and exposes
// window.bleReady (a Promise resolving to the GPP101 instance) so
// learning.js can attach its own onNoteOn/onNoteOff for gameplay.
//
// v1.1: the auto-reconnect attempt is no longer silent when it fails —
// it now shows "Checking for keyboard…" while trying, then a specific
// reason if it doesn't succeed (unsupported browser, no remembered
// device, or found-but-unreachable), instead of just sitting on
// "Disconnected" with no explanation.
//
// Note: Web Bluetooth has no real "stay connected across pages" — each
// page load is a fresh GATT connection. This is the closest practical
// equivalent: reconnect automatically, so the person doesn't have to pick
// the device from the browser dialog again on every page.

function renderBleWidget(container, ble) {
  container.innerHTML = `
    <button id="ble-widget-btn" class="ble-widget-btn">Connect Keyboard</button>
    <span id="ble-widget-pill" class="ble-widget-pill disconnected">Disconnected</span>
  `;
  const btn = container.querySelector("#ble-widget-btn");
  const pill = container.querySelector("#ble-widget-pill");

  function setConnected(name) {
    pill.textContent = name ? `Connected: ${name}` : "Connected";
    pill.className = "ble-widget-pill connected";
    btn.textContent = "Disconnect";
    btn.disabled = false;
  }

  function setDisconnected(reason) {
    pill.textContent = reason || "Disconnected";
    pill.className = "ble-widget-pill disconnected";
    btn.textContent = "Connect Keyboard";
    btn.disabled = false;
  }

  function setPending(message) {
    pill.textContent = message;
    pill.className = "ble-widget-pill pending";
  }

  // Own listener on the device itself (separate from ble.onDisconnected,
  // which learning.js uses for gameplay) so the pill always reflects
  // reality regardless of what else is listening.
  function watchDevice() {
    if (ble.device) {
      ble.device.addEventListener("gattserverdisconnected", () => setDisconnected());
    }
  }

  btn.addEventListener("click", async () => {
    if (ble.connected) {
      ble.disconnect();
      setDisconnected();
      return;
    }
    try {
      btn.disabled = true;
      setPending("Connecting…");
      const name = await ble.connect();
      watchDevice();
      setConnected(name);
    } catch (err) {
      setDisconnected();
    }
  });

  return { setConnected, setDisconnected, setPending, watchDevice };
}

window.bleReady = (async function initBleWidget() {
  const container = document.getElementById("ble-widget");
  if (!container) return null;

  const ble = new GPP101();

  if (!navigator.bluetooth) {
    container.innerHTML = `<span class="ble-widget-pill disconnected">Bluetooth not supported</span>`;
    return ble;
  }

  const ui = renderBleWidget(container, ble);

  if (!navigator.bluetooth.getDevices) {
    // This Chrome/Edge build doesn't expose persistent-permission lookup —
    // auto-reconnect simply isn't possible here, so say so plainly instead
    // of quietly doing nothing.
    ui.setDisconnected("Auto-reconnect unsupported — click Connect");
    return ble;
  }

  ui.setPending("Checking for keyboard…");

  let known = [];
  try {
    known = await navigator.bluetooth.getDevices();
  } catch (err) {
    ui.setDisconnected("Couldn't check for a keyboard — click Connect");
    return ble;
  }

  if (known.length === 0) {
    ui.setDisconnected("No remembered keyboard — click Connect");
    return ble;
  }

  for (const device of known) {
    try {
      const name = await ble.reconnect(device);
      ui.watchDevice();
      ui.setConnected(name);
      return ble;
    } catch (err) {
      // Not the right device, or it's off/asleep/out of range — try the next one.
    }
  }

  ui.setDisconnected("Keyboard not reachable — click Connect");
  return ble;
})();
