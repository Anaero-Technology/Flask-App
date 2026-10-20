# Bundled ESP32 PLC firmware

The Kittiwake firmware for the Industrial Shields **ESP32 PLC 57R** (not the
M-Duino - its `.hex` lives under `firmware/plc/`), built from the
`PLC_Kittiwake_ESP` repo and placed here as `firmware.bin`: the
`Kittiwake_135.ino.bin` from `arduino-cli compile` (not the `.bootloader.` or
`.partitions.` files). Build settings are in that repo's README - board
`industrialshields:esp32:esp32plc:cpu=esp32plc57r,version=v3,PartitionScheme=default_16MB`.

Currently bundled: `PLC_Kittiwake_ESP` branch `plc_firmware_port` at `9c4122c`,
sha256 `941817e8b0d6a80cf22a185fef4ed7d1262e6aee525100c22615f3f57b786f64`.
That digest is the one esptool appended to the image, so it is also what a PLC
running this build reports back from `firmwarehash`.

Settings → PLC → Firmware compares that digest with the running PLC's
`firmwarehash` and offers "Install bundled firmware" when they differ. It is
sent over whatever link the PLC is attached by - USB, RS232 or WiFi - and the
PLC only switches to it once it has verified it.

A PLC must already run a build with `startupdate` and `firmwarehash` (this
branch from commit `3deed6f` on) to be updated from the app. Older ESP32 builds
have to be flashed over USB once - see the firmware repo's README.
