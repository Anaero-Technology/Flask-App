#!/usr/bin/env python3
"""PLC platform detection, network transport and ESP32 firmware updates.

No hardware: a real PlcHandler talks over a socket pair to a fake PLC thread
that answers the way the firmware does (serial.md in the PLC repositories). The
same socket wrapper the network listener uses carries the traffic, so these
cover the network path end to end, short of an actual ESP32.

Run from backend/: venv/bin/python tests/test_plc_platform_network.py
"""

import hashlib
import os
import socket
import sys
import threading
import time

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), '..'))
os.environ["DISABLE_AUTO_CONNECT"] = "1"

from plc_handler import PlcHandler
from plc_network import SocketConnection, is_network_port

MAC = "44:17:93:DC:EE:3F"


class FakePlc(threading.Thread):
    """Answers like the firmware. platform is 'esp32' or 'avr'."""

    def __init__(self, sock, platform="esp32", image_hash="ab" * 32):
        super().__init__(daemon=True)
        self.sock = sock
        self.platform = platform
        self.image_hash = image_hash
        self.received = []
        self.image = None
        self.running = True

    def send(self, line):
        self.sock.sendall((line + "\n").encode())

    def run(self):
        buffer = b""
        try:
            while self.running:
                data = self.sock.recv(4096)
                if not data:
                    return
                buffer += data
                while b"\n" in buffer:
                    raw, buffer = buffer.split(b"\n", 1)
                    line = raw.decode().strip()
                    self.received.append(line)
                    buffer = self.answer(line, buffer)
        except OSError:
            return

    def answer(self, line, buffer):
        word, _, rest = line.partition(" ")
        if word == "info":
            self.send(f"info 0 none bench plc {MAC}")
        elif word == "firmwarehash":
            if self.platform == "esp32":
                self.send(f"firmwarehash {self.image_hash}")
            else:
                self.send("failed firmwarehash unknown")
        elif word == "systemget":
            self.send("system medusa 6 0 1 10 2")
        elif word == "configload":
            self.send("failed configload nocard")
        elif word == "nameset":
            self.send("done nameset")
        elif word == "networkget":
            self.send("network connected 192.168.1.50 -61 LabNet 192.168.1.109 6001 up")
        elif word in ("wifissidset", "wifipassset", "wifipassadd", "wificonnect",
                      "wifireset", "hostset", "hostreset"):
            self.send(f"done {word}")
        elif word == "startupdate":
            size = int(rest)
            self.send("done startupdate")
            while len(buffer) < size:
                buffer += self.sock.recv(65536)
            self.image, buffer = buffer[:size], buffer[size:]
            verified = hashlib.sha256(self.image[:-32]).digest() == self.image[-32:]
            self.send("done update" if verified else "failed update")
        else:
            self.send(f"failed {word} unknown")
        return buffer


def network_pair(platform="esp32"):
    host_side, plc_side = socket.socketpair()
    fake = FakePlc(plc_side, platform)
    fake.start()
    handler = PlcHandler("net://192.168.1.50")
    connected = handler.connect_network(SocketConnection(host_side, "net://192.168.1.50"))
    return handler, fake, connected


def test_socket_connection_reports_peer_close():
    a, b = socket.socketpair()
    conn = SocketConnection(a, "net://test")
    b.sendall(b"hello\n")
    deadline = time.time() + 2
    while conn.in_waiting < 6 and time.time() < deadline:
        time.sleep(0.01)
    assert conn.read(6) == b"hello\n"
    b.close()
    try:
        while True:
            conn.in_waiting
            time.sleep(0.01)
    except OSError:
        pass
    assert not conn.is_open
    conn.close()                      # idempotent
    print("  socket connection reports a closed peer as OSError")


def test_network_port_naming():
    assert is_network_port("net://10.0.0.5")
    assert not is_network_port("/dev/ttyUSB0")
    assert not is_network_port(None)
    assert PlcHandler("net://10.0.0.5").transport == "network"
    assert PlcHandler("/dev/ttyAMA0").transport == "rs232"
    assert PlcHandler("/dev/ttyUSB0").transport == "usb"
    print("  transport derived from the port name")


def test_esp32_detected_over_network():
    handler, fake, connected = network_pair("esp32")
    try:
        assert connected, "handler failed to adopt the network connection"
        assert handler.mac_address == MAC
        assert handler.platform == "esp32"
        assert handler.firmware_hash == "ab" * 32
        assert handler.machine_type == "medusa"
        info = handler.get_info()
        assert info["platform"] == "esp32" and info["transport"] == "network"
        print("  ESP32 PLC adopted over the network and identified")
    finally:
        handler.disconnect()


def test_avr_detected():
    handler, fake, connected = network_pair("avr")
    try:
        assert connected
        assert handler.platform == "avr"
        assert handler.firmware_hash is None
        ok, message = handler.update_firmware(b"\xe9" + b"\0" * 1000)
        assert not ok and "ESP32" in message
        ok, _ = handler.configure_network("LabNet", "secret", "192.168.1.109", 6001)
        assert not ok
        print("  M-Duino identified, and refused ESP32-only operations")
    finally:
        handler.disconnect()


def test_network_configuration_chunks_password():
    handler, fake, connected = network_pair("esp32")
    try:
        password = "p" * 63                     # longest WPA passphrase
        ok, message = handler.configure_network("LabNet", password, "192.168.1.109", 6001)
        assert ok, message
        sent = [l for l in fake.received if l.split()[0].startswith(("wifi", "host"))]
        assert sent[0] == "wifissidset LabNet"
        pieces = [l.split(" ", 1)[1] for l in sent if l.startswith(("wifipassset", "wifipassadd"))]
        assert "".join(pieces) == password
        assert all(len(l) <= 63 for l in fake.received), "a line exceeded the PLC's 63 byte limit"
        assert sent[-2:] == ["wificonnect", "hostset 192.168.1.109 6001"]

        bad, _ = handler.configure_network("Lab Net", "x", "192.168.1.109", 6001)
        assert not bad, "an SSID with a space cannot travel in the protocol"

        status = handler.get_network()
        assert status == {"wifi": "connected", "ip": "192.168.1.50", "rssi": -61,
                          "ssid": "LabNet", "host": "192.168.1.109", "port": 6001,
                          "link": "up"}
        print("  network settings sent within the line limit and read back")
    finally:
        handler.disconnect()


def test_firmware_update_over_network():
    handler, fake, connected = network_pair("esp32")
    try:
        body = os.urandom(10 * 1024)
        body = b"\xe9" + body[1:]
        image = body + hashlib.sha256(body).digest()

        progress = []
        ok, message = handler.update_firmware(image, progress_cb=lambda s, t: progress.append((s, t)))
        assert ok, message
        assert fake.image == image, "the PLC did not receive the exact image"
        assert progress[-1] == (len(image), len(image))
        assert not handler.firmware_update_in_progress

        corrupt = image[:-1] + bytes([image[-1] ^ 1])
        ok, message = handler.update_firmware(corrupt)
        assert not ok and "rejected" in message
        print("  firmware streamed whole; a corrupt image is reported as rejected")
    finally:
        handler.disconnect()


if __name__ == "__main__":
    tests = [
        test_socket_connection_reports_peer_close,
        test_network_port_naming,
        test_esp32_detected_over_network,
        test_avr_detected,
        test_network_configuration_chunks_password,
        test_firmware_update_over_network,
    ]
    for test in tests:
        test()
    print("All PLC platform/network tests passed")
