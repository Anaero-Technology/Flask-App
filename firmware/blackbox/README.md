# Bundled Black Box firmware

Place the PlatformIO build output here as `firmware.bin`
(from the Black-Box_Firmware repo: `.pio/build/esp32dev/firmware.bin`).

Currently bundled: **V1.0.1**, sha256 `687afe3225ee3fac12f4957aa270be22a78d862bb3a0633aa68cfe4090d05b87`.
That digest is the one esptool appended to the image, so it is also what a
device running this build reports back from `firmwareHash`.

The web app compares the SHA-256 digest esptool appends to this file
(its last 32 bytes) against the running firmware's `firmwareHash` reply,
and offers a one-click update in Settings -> System Tools when they differ.
Committing a new `firmware.bin` here means every logger fleet-wide sees
"Firmware update available" after its next software update.

The device must be running firmware that implements `startUpdate` and
`firmwareHash`; builds predating those commands report no hash, so the app
shows "cannot report its firmware version" and offers upload-only flashing,
which will also fail until the device has been reflashed over USB once.
