# Bundled Chimera firmware

Place the PlatformIO build output here as `firmware.bin`
(from the Chimera_Firmware repo: `.pio/build/esp32-s3/firmware.bin`).

The web app compares the SHA-256 digest esptool appends to this file
(its last 32 bytes) against the running firmware's `firmwarehash` reply,
and offers a one-click update in Settings -> System Tools when they differ.
Committing a new `firmware.bin` here means every device fleet-wide sees
"Firmware update available" after its next software update.
