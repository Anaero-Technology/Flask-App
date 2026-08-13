# Bundled Black Box firmware

Place the PlatformIO build output here as `firmware.bin`
(from the Black-Box_Firmware repo: `.pio/build/esp32dev/firmware.bin`).

The web app compares the SHA-256 digest esptool appends to this file
(its last 32 bytes) against the running firmware's `firmwareHash` reply,
and offers a one-click update in Settings -> System Tools when they differ.
Committing a new `firmware.bin` here means every logger fleet-wide sees
"Firmware update available" after its next software update.

The device must be running firmware that implements `startUpdate` and
`firmwareHash`; builds predating those commands report no hash, so the app
shows "cannot report its firmware version" and offers upload-only flashing,
which will also fail until the device has been reflashed over USB once.
