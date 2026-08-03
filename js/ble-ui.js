// v1.0
// ble-ui.js — Shared BLE connect button + status pill, dropped into any
// page that has a <div id="ble-widget"></div>. Renders the button, tries
// a SILENT reconnect on load (Chrome/Edge only, via
// navigator.bluetooth.getDevices() — no picker shown, works only if this
// origin was already granted access to the keyboard before), and exposes
// window.bleReady (a Promise resolving to the GPP101 instance) so
// learning.js can attach its own onNoteOn/onNoteOff for gameplay.
//
// Note: Web Bluetooth has no real "stay connected across pages" — each
// page load is a fresh GATT connection. This is the closest practical
// equivalent: reconnect automatically and silently, so the person doesn't
// have to pick the device from the browser dialog again on every page.

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

  function setDisconnected() {
    pill.textContent = "Disconnected";
    pill.className = "ble-widget-pill disconnected";
    btn.textContent = "Connect Keyboard";
    btn.disabled = false;
  }

  // Own listener on the device itself (separate from ble.onDisconnected,
  // which learning.js uses for gameplay) so the pill always reflects
  // reality regardless of what else is listening.
  function watchDevice() {
    if (ble.device) {
      ble.device.addEventListener("gattserverdisconnected", setDisconnected);
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
      pill.textContent = "Connecting…";
      const name = await ble.connect();
      watchDevice();
      setConnected(name);
    } catch (err) {
      setDisconnected();
    }
  });

  return { setConnected, setDisconnected, watchDevice };
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

  // Silent auto-reconnect to a previously authorized device, if the
  // browser remembers one and it's currently reachable.
  if (navigator.bluetooth.getDevices) {
    try {
      const known = await navigator.bluetooth.getDevices();
      for (const device of known) {
        try {
          const name = await ble.reconnect(device);
          ui.watchDevice();
          ui.setConnected(name);
          break;
        } catch (err) {
          // Not the right device, or it's off/out of range — try the next one.
        }
      }
    } catch (err) {
      // getDevices() itself failed — stays disconnected, Connect button still works.
    }
  }

  return ble;
})();
