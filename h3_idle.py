"""Measures how long a DoH server keeps an idle HTTP/3 connection open.

Sends one DoH query over HTTP/3, then idles with a long local idle timeout
(as Firefox does with network.http.http3.idle_timeout raised) until the
connection ends, and prints a JSON result.

Usage: python3 h3_idle.py <doh-url> [max-seconds]
"""

import asyncio
import base64
import json
import sys
import time
from urllib.parse import urlparse

from aioquic.asyncio import connect
from aioquic.asyncio.protocol import QuicConnectionProtocol
from aioquic.h3.connection import H3_ALPN, H3Connection
from aioquic.h3.events import DataReceived, HeadersReceived
from aioquic.quic.configuration import QuicConfiguration
from aioquic.quic.events import ConnectionTerminated


def dns_query(name):
    q = bytes([0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0])
    for part in name.split("."):
        q += bytes([len(part)]) + part.encode()
    q += bytes([0, 0, 1, 0, 1])
    return base64.urlsafe_b64encode(q).rstrip(b"=").decode()


class Client(QuicConnectionProtocol):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.h3 = H3Connection(self._quic)
        self.response = asyncio.get_running_loop().create_future()
        self.status = None
        self.ended = asyncio.get_running_loop().create_future()

    def quic_event_received(self, event):
        if isinstance(event, ConnectionTerminated) and not self.ended.done():
            self.ended.set_result(event)
        for e in self.h3.handle_event(event):
            if isinstance(e, HeadersReceived):
                self.status = dict(e.headers).get(b":status", b"").decode()
            if getattr(e, "stream_ended", False) and not self.response.done():
                self.response.set_result(self.status)

    def query(self, url):
        u = urlparse(url)
        stream = self._quic.get_next_available_stream_id()
        self.h3.send_headers(
            stream,
            [
                (b":method", b"GET"),
                (b":scheme", b"https"),
                (b":authority", u.hostname.encode()),
                (b":path", f"{u.path}?dns={dns_query('example.com')}".encode()),
                (b"accept", b"application/dns-message"),
            ],
            end_stream=True,
        )
        self.transmit()


async def main(url, max_seconds):
    config = QuicConfiguration(
        is_client=True, alpn_protocols=H3_ALPN, idle_timeout=3600
    )
    host = urlparse(url).hostname
    result = {"ok": False}
    try:
        async with connect(
            host, 443, configuration=config, create_protocol=Client
        ) as client:
            client.query(url)
            status = await asyncio.wait_for(client.response, 10)
            result["ok"] = status == "200"
            peer_idle = getattr(client._quic, "_remote_max_idle_timeout", None)
            result["peerMaxIdleSeconds"] = peer_idle
            start = time.monotonic()
            try:
                event = await asyncio.wait_for(client.ended, max_seconds)
                result["seconds"] = round(time.monotonic() - start)
                result["end"] = (
                    f"close-{event.error_code}"
                    if event.reason_phrase != "Idle timeout"
                    else "idle-timeout"
                )
            except asyncio.TimeoutError:
                result["seconds"] = max_seconds
                result["end"] = "cap"
    except Exception as e:
        result["error"] = type(e).__name__
    print(json.dumps(result))


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], int(sys.argv[2]) if len(sys.argv) > 2 else 600))
