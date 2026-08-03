// v1.0
// ble-shared.js — SPA version of the old ble-ui.js. Same connect button +
// status pill, same auto-reconnect attempt on load, BUT it is created ONCE
// for the whole app lifetime and lives in the persistent app shell.
//
// This is the entire reason the SPA exists: because the document is never
// reloaded, this single GPP101 instance keeps its GATT connection alive
// while the user moves Dashboard -> Sections -> Learning and back.
//
// Exposes:
//   window.PianoBle.ready   -> Promise resolving to the GPP101 instance
//   window.PianoBle.get()   -> the instance (may be null before ready)
//   window.PianoBle.attach({ onNoteOn, onNoteOff })  -> gameplay hooks
//   window.PianoBle.detach()                        -> drop those hooks
//
// attach/detach exist because only the Learning view wants key presses to
// drive gameplay; when you leave that view its handlers must stop firing,
// but the CONNECTION must not be touched.

window.PianoBle = (function () {
  let ble = null;
  let handlers = null;

  function renderWidget(container, instance) {
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

    function watchDevice() {
      if (instance.device) {
        instance.device.addEventListener("gattserverdisconnected", () => setDisconnected());
      }
    }

    btn.addEventListener("click", async () => {
      if (instance.connected) {
        instance.disconnect();
        setDisconnected();
        return;
      }
      try {
        btn.disabled = true;
        setPending("Connecting…");
        const name = await instance.connect();
        watchDevice();
        setConnected(name);
      } catch (err) {
        setDisconnected();
      }
    });

    return { setConnected, setDisconnected, setPending, watchDevice };
  }

  const ready = (async function init() {
    const container = document.getElementById("ble-widget");
    ble = new GPP101();

    // Single permanent dispatch point: whatever the physical keyboard
    // sends is forwarded to the currently attached view, if any.
    ble.onNoteOn = (note) => { if (handlers && handlers.onNoteOn) handlers.onNoteOn(note); };
    ble.onNoteOff = (note) => { if (handlers && handlers.onNoteOff) handlers.onNoteOff(note); };

    if (!container) return ble;

    if (!navigator.bluetooth) {
      container.innerHTML = `<span class="ble-widget-pill disconnected">Bluetooth not supported</span>`;
      return ble;
    }

    const ui = renderWidget(container, ble);

    if (!navigator.bluetooth.getDevices) {
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
        // Wrong device, or off/asleep/out of range — try the next one.
      }
    }

    ui.setDisconnected("Keyboard not reachable — click Connect");
    return ble;
  })();

  return {
    ready,
    get: () => ble,
    attach: (h) => { handlers = h; },
    detach: () => { handlers = null; },
  };
})();
