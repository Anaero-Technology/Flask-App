"""Remote PLCs over the network.

An ESP32 PLC that has been given WiFi credentials and this host's address opens
a TCP connection to us - the same direction the black box uses - and from then
on speaks exactly the protocol it speaks on USB: newline terminated commands in,
replies and telemetry out.

So rather than a second driver, the accepted socket is wrapped to look like a
pyserial port and handed to an ordinary PlcHandler. Status, configuration,
maintenance, telemetry, automation and even firmware updates then work over the
network unchanged.

The listener has its own port: gunicorn already holds 6000 on the Pi.
"""

import os
import select
import socket
import threading
from typing import Optional

DEFAULT_PORT = 6001
NETWORK_PORT_PREFIX = "net://"


def listener_port() -> int:
    try:
        return int(os.environ.get("PLC_NETWORK_PORT", DEFAULT_PORT))
    except ValueError:
        return DEFAULT_PORT


def is_network_port(port: Optional[str]) -> bool:
    return bool(port) and port.startswith(NETWORK_PORT_PREFIX)


class SocketConnection:
    """The slice of the pyserial Serial interface SerialHandler relies on,
    over an accepted TCP socket.

    in_waiting pulls whatever has arrived without blocking, so the handler's
    reader loop polls it exactly as it polls a serial port. A peer that closes
    or resets raises OSError there, which the reader loop already treats as a
    disconnect.
    """

    def __init__(self, sock: socket.socket, port: str):
        self._sock = sock
        self._rx = bytearray()
        self._rx_lock = threading.Lock()
        self.port = port
        self.is_open = True
        self.timeout = 0.5
        self.write_timeout = 10.0

    @property
    def in_waiting(self) -> int:
        if not self.is_open:
            raise OSError("connection closed")
        with self._rx_lock:
            readable, _, _ = select.select([self._sock], [], [], 0)
            if readable:
                data = self._sock.recv(4096)
                if not data:
                    self.is_open = False
                    raise OSError("connection closed by the PLC")
                self._rx += data
            return len(self._rx)

    def read(self, size: int = 1) -> bytes:
        with self._rx_lock:
            data = bytes(self._rx[:size])
            del self._rx[:size]
            return data

    def write(self, data: bytes) -> int:
        if not self.is_open:
            raise OSError("connection closed")
        self._sock.settimeout(self.write_timeout)
        try:
            self._sock.sendall(data)
        except OSError:
            self.is_open = False
            raise
        return len(data)

    def flush(self):
        """sendall() has already handed everything to the kernel."""

    def reset_input_buffer(self):
        with self._rx_lock:
            self._rx.clear()

    def reset_output_buffer(self):
        pass

    def close(self):
        if not self.is_open and self._sock is None:
            return
        self.is_open = False
        sock, self._sock = self._sock, None
        if sock is None:
            return
        try:
            sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        try:
            sock.close()
        except OSError:
            pass


class PlcNetworkListener:
    """Accepts connections from network PLCs and registers them as devices."""

    def __init__(self, manager, port: Optional[int] = None):
        self.manager = manager
        self.port = port or listener_port()
        self._thread = None

    def start(self):
        self._thread = threading.Thread(target=self._serve, daemon=True, name="PlcNetworkListener")
        self._thread.start()

    def _serve(self):
        try:
            server = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
            server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            server.bind(("0.0.0.0", self.port))
            server.listen(8)
        except OSError as e:
            print(f"[PLC NETWORK] Cannot listen on port {self.port}: {e}")
            return

        print(f"[PLC NETWORK] Listening for network PLCs on port {self.port}")
        while True:
            try:
                sock, address = server.accept()
            except OSError as e:
                print(f"[PLC NETWORK] Accept failed: {e}")
                continue
            threading.Thread(target=self._adopt, args=(sock, address), daemon=True,
                             name=f"PlcNetworkAdopt-{address[0]}").start()

    def _adopt(self, sock: socket.socket, address):
        # Keepalive notices a PLC that vanished without closing (power cut,
        # WiFi dropout) even while nothing is being sent to it.
        try:
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_KEEPALIVE, 1)
            sock.setsockopt(socket.IPPROTO_TCP, socket.TCP_NODELAY, 1)
        except OSError:
            pass

        port = f"{NETWORK_PORT_PREFIX}{address[0]}"
        connection = SocketConnection(sock, port)
        try:
            adopted = self.manager.connect_network_plc(connection, port)
        except Exception as e:
            print(f"[PLC NETWORK] Could not adopt {address[0]}: {e}")
            adopted = False
        if adopted:
            print(f"[PLC NETWORK] PLC connected from {address[0]}")
        else:
            connection.close()
