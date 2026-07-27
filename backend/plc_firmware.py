"""Flash a new firmware image onto the ATmega2560 based PLC.

Unlike the chimera - an ESP32 that receives a byte stream and rewrites its own
flash - the PLC has no self-update path. It is programmed the way the Arduino
toolchain programs it: the host runs avrdude, which drives the board's wiring
(STK500v2) bootloader over the same serial line. So "OTA" here means the server
runs avrdude against the PLC's port and reports progress.
"""

import glob
import os
import pty
import re
import select
import shutil
import subprocess
import time
from typing import Callable, List, Optional, Tuple

# Matches an Intel HEX record: ':' then hex, which is what a compiled sketch
# (.hex) looks like. The bootloader expects this, not a raw .bin.
_HEX_LINE = re.compile(rb'^:[0-9A-Fa-f]{8,}[\r\n]*$')

# avrdude draws its progress bars to stderr, updated in place with carriage
# returns: "Writing | ####      | 45% 0.00s". Two phases matter - the flash
# write and the verify read back.
_PROGRESS = re.compile(r'(Reading|Writing)\s*\|.*\|\s*(\d+)%')


def is_intel_hex(data: bytes) -> bool:
    """Cheap check that an upload is an Intel HEX file before flashing it."""
    if not data or data[0:1] != b':':
        return False
    # Validate the first few records rather than the whole file.
    checked = 0
    for line in data.splitlines():
        if not line.strip():
            continue
        if not _HEX_LINE.match(line):
            return False
        checked += 1
        if checked >= 5:
            break
    return checked > 0


def locate_avrdude() -> Tuple[Optional[str], Optional[str]]:
    """Find an avrdude to flash with, plus its config if one is needed.

    Prefers a system avrdude (apt install avrdude on the Pi) because it finds
    its own avrdude.conf; falls back to the copy bundled with the Arduino AVR
    cores, which must be pointed at its packaged config.
    """
    system = shutil.which('avrdude')
    if system:
        return system, None  # system avrdude locates its own conf

    home = os.path.expanduser('~')
    roots = [
        os.path.join(home, 'Library', 'Arduino15', 'packages'),   # macOS
        os.path.join(home, '.arduino15', 'packages'),             # Linux / Pi
    ]
    for root in roots:
        for binary in sorted(glob.glob(os.path.join(root, '*', 'tools', 'avrdude', '*', 'bin', 'avrdude'))):
            conf = None
            base = os.path.dirname(os.path.dirname(binary))
            for candidate in (os.path.join(base, 'etc', 'avrdude.conf'),
                              os.path.join(base, 'avrdude.conf')):
                if os.path.exists(candidate):
                    conf = candidate
                    break
            return binary, conf

    return None, None


def flash(port: str, hex_path: str,
          progress_cb: Optional[Callable[[str, int], None]] = None,
          timeout: float = 180.0) -> Tuple[bool, str]:
    """Flash hex_path onto the PLC on `port`.

    The caller must have already released the serial port - avrdude needs
    exclusive access. progress_cb(phase, percent) is called as avrdude works,
    with phase "writing" or "verifying".
    """
    avrdude, conf = locate_avrdude()
    if not avrdude:
        return False, ("avrdude is not installed on the server. Install it "
                       "(on the Pi: sudo apt install avrdude) and try again.")

    if not os.path.exists(hex_path):
        return False, "Firmware file is missing"

    args: List[str] = [avrdude]
    if conf:
        args += ['-C', conf]
    args += [
        '-p', 'atmega2560',
        '-c', 'wiring',            # the M-Duino's serial bootloader protocol
        '-P', port,
        '-b', '115200',
        '-D',                      # do not chip-erase; the bootloader handles it
        '-U', f'flash:w:{hex_path}:i',
    ]

    # avrdude block-buffers its progress bars when stdout is a pipe, so nothing
    # appears until it exits. Give it a pseudo-terminal instead and it flushes
    # each in-place '\r' update live, which is what drives the progress bar.
    master, slave = pty.openpty()
    try:
        proc = subprocess.Popen(args, stdout=slave, stderr=slave, close_fds=True)
    except Exception as e:
        os.close(master)
        os.close(slave)
        return False, f"Could not start avrdude: {e}"
    os.close(slave)

    phase = 'writing'
    seen_write = False
    deadline = time.time() + timeout
    buffer = ''
    tail = []  # last lines, for the error message

    def handle_line(line):
        nonlocal phase, seen_write
        line = line.strip()
        if not line:
            return
        tail.append(line)
        if len(tail) > 8:
            tail.pop(0)
        m = _PROGRESS.search(line)
        if not m:
            return
        kind, pct = m.group(1), int(m.group(2))
        # The first "Reading" is the signature check; the flash write comes next,
        # and a "Reading" after a write is the verify pass.
        if kind == 'Writing':
            seen_write = True
            phase = 'writing'
        elif kind == 'Reading' and seen_write:
            phase = 'verifying'
        else:
            return
        if progress_cb:
            try:
                progress_cb(phase, pct)
            except Exception:
                pass

    timed_out = False
    while True:
        if time.time() > deadline:
            proc.kill()
            timed_out = True
            break
        try:
            ready, _, _ = select.select([master], [], [], 0.2)
        except (OSError, ValueError):
            break
        if master in ready:
            try:
                chunk = os.read(master, 1024).decode('utf-8', 'ignore')
            except OSError:
                break  # EIO once the child closes the slave side
            if not chunk:
                break
            buffer += chunk
            parts = re.split(r'[\r\n]', buffer)
            buffer = parts.pop()
            for part in parts:
                handle_line(part)
        elif proc.poll() is not None:
            break

    if buffer:
        handle_line(buffer)

    try:
        os.close(master)
    except OSError:
        pass

    if timed_out:
        return False, "Flashing timed out - is the PLC still connected?"

    proc.wait()
    if proc.returncode == 0:
        return True, "Firmware flashed and verified"

    detail = '; '.join(tail[-3:]) if tail else f"avrdude exited {proc.returncode}"
    return False, f"Flashing failed: {detail}"
