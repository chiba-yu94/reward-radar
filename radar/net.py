"""Bounded HTTPS requests to exactly reviewed URLs, with DNS pinning."""
import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urlsplit

LIMIT = 256_000
GLOBAL_IPV6 = ipaddress.ip_network("2000::/3")


def public_ip(address):
    ip = ipaddress.ip_address(address)
    return ((ip.version == 4 or ip in GLOBAL_IPV6) and ip.is_global and not ip.is_multicast and not ip.is_reserved
            and not ip.is_loopback and not ip.is_link_local
            and not getattr(ip, "ipv4_mapped", None)
            and not getattr(ip, "sixtofour", None)
            and not getattr(ip, "teredo", None))


def https_url(value):
    if not isinstance(value, str) or not value.isascii() or any(
        ord(char) <= 32 or ord(char) >= 127 or char == "\\" for char in value
    ):
        raise ValueError("Invalid URL characters")
    url = urlsplit(value)
    host = url.hostname
    if (url.scheme != "https" or not host or url.netloc != host or "." not in host
            or host.endswith((".local", ".localhost", ".internal", ".test"))
            or not all(label and label[0] != "-" and label[-1] != "-"
                       and all(c.isalnum() or c == "-" for c in label)
                       for label in host.split("."))
            or not host.split(".")[-1].isalpha()):
        raise ValueError("Expected HTTPS with a public DNS hostname")
    return url


class PinnedHTTPS(http.client.HTTPSConnection):
    def connect(self):
        addresses = socket.getaddrinfo(self.host, self.port, type=socket.SOCK_STREAM)
        if not addresses or not all(public_ip(item[4][0]) for item in addresses):
            raise ValueError("DNS contains a prohibited address")
        family, socktype, protocol, _, destination = addresses[0]
        raw = socket.socket(family, socktype, protocol)
        try:
            raw.settimeout(self.timeout)
            raw.connect(destination)
            self.sock = self._context.wrap_socket(raw, server_hostname=self.host)
        except BaseException:
            raw.close()
            raise


def fetch_json(url, allowed_url):
    return fetch_document(url, allowed_url, ("application/json",), {
        "Accept": "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
    })


def fetch_document(url, allowed_url, media_types, request_headers=None):
    parts = https_url(url)
    if url != allowed_url or parts.fragment:
        raise ValueError("Unreviewed fetch URL")
    connection = PinnedHTTPS(parts.hostname, timeout=12, context=ssl.create_default_context())
    try:
        target = parts.path or "/"
        if parts.query:
            target += "?" + parts.query
        connection.request("GET", target, headers={
            "User-Agent": "RewardRadar/1.0",
            "Accept-Encoding": "identity",
            **(request_headers or {}),
        })
        response = connection.getresponse()
        if 300 <= response.status < 400:
            raise ValueError("Redirect requires review")
        if response.status != 200:
            raise ValueError(f"Upstream HTTP {response.status}")
        if response.getheader("Content-Type", "").partition(";")[0].strip().lower() not in media_types:
            raise ValueError("Unexpected content type")
        body = response.read(LIMIT + 1)
        if len(body) > LIMIT:
            raise ValueError("Response too large")
        return body
    finally:
        connection.close()
