#!/usr/bin/env python3
"""Root-owned bridge from a signed check-in to a DHCP lease and nftables."""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import ipaddress
import json
from pathlib import Path
import re
import subprocess
import sys
import time

from settings import read_env


STATE = Path("/run/checkhen")
LEASES = STATE / "dnsmasq/leases"
BINDINGS = STATE / "bindings.json"
MAC = re.compile(r"^[0-9a-f]{2}(?::[0-9a-f]{2}){5}$", re.IGNORECASE)


def lease_mac(ip: str) -> str | None:
    now = time.time()
    if not LEASES.exists():
        return None
    for line in LEASES.read_text().splitlines():
        fields = line.split()
        if len(fields) < 3 or fields[2] != ip:
            continue
        try:
            if int(fields[0]) <= now:
                continue
        except ValueError:
            continue
        mac = fields[1].lower()
        if MAC.fullmatch(mac):
            return mac
    return None


def nft(action: str, ip: str, mac: str) -> None:
    if action not in {"add", "delete"}:
        raise ValueError("Invalid nft action")
    ipaddress.IPv4Address(ip)
    if not MAC.fullmatch(mac):
        raise ValueError("Invalid MAC")
    command = f"{action} element ip checkhen authorized4 {{ {ip} . {mac} }}\n"
    subprocess.run(["nft", "-f", "-"], input=command, text=True,
                   check=True, capture_output=True)


def save(bindings: dict[str, dict]) -> None:
    temporary = BINDINGS.with_suffix(".tmp")
    temporary.write_text(json.dumps(bindings, sort_keys=True))
    temporary.chmod(0o600)
    temporary.replace(BINDINGS)


def ap_client_ip(value: str, subnet: ipaddress.IPv4Network) -> str:
    address = ipaddress.IPv4Address(value)
    if address not in subnet:
        raise PermissionError("Outside AP subnet")
    return str(address)


class Handler(BaseHTTPRequestHandler):
    secret = ""
    subnet = ipaddress.IPv4Network("172.16.77.0/24")

    def do_POST(self) -> None:
        if self.path not in {"/bind", "/revoke"}:
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length < 4096:
                raise ValueError("Invalid request length")
            raw = self.rfile.read(length)
            expected = hmac.new(self.secret.encode(), raw, hashlib.sha256).hexdigest()
            if not hmac.compare_digest(self.headers.get("X-CheckHen-Signature", ""), expected):
                raise PermissionError("Invalid signature")
            data = json.loads(raw)
            if abs(time.time() * 1000 - data["timestamp"]) > 30000:
                raise PermissionError("Expired request")
            ip = ap_client_ip(data["ip"], self.subnet)
            if not all(isinstance(data.get(key), str) and data[key]
                       for key in ("userId", "courseId", "classId")):
                raise ValueError("Missing scope")
            bindings = json.loads(BINDINGS.read_text()) if BINDINGS.exists() else {}
            if self.path == "/bind":
                mac = lease_mac(ip)
                if not mac:
                    raise PermissionError("No active DHCP lease")
                previous = bindings.get(ip)
                if previous and previous["mac"] != mac:
                    nft("delete", ip, previous["mac"])
                if not previous or previous["mac"] != mac:
                    nft("add", ip, mac)
                bindings[ip] = {"mac": mac, "userId": data["userId"],
                                "courseId": data["courseId"], "classId": data["classId"]}
                save(bindings)
            else:
                previous = bindings.get(ip)
                if not previous or any(previous[key] != data[key]
                                       for key in ("userId", "courseId", "classId")):
                    raise PermissionError("Binding not found")
                mac = previous["mac"]
                nft("delete", ip, mac)
                del bindings[ip]
                save(bindings)
            body = json.dumps({"ip": ip, "mac": mac}).encode()
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except PermissionError:
            self.send_error(403)
        except (KeyError, TypeError, ValueError, json.JSONDecodeError):
            self.send_error(400)
        except (OSError, subprocess.CalledProcessError):
            self.send_error(503)

    def log_message(self, format: str, *args) -> None:
        # Do not log student identifiers or signed request bodies.
        pass


def main() -> None:
    settings = read_env(Path(sys.argv[1]) if len(sys.argv) > 1 else None)
    Handler.secret = settings["PORTAL_CONTROL_SECRET"]
    Handler.subnet = ipaddress.IPv4Network(settings.get("AP_SUBNET", "172.16.77.0/24"))
    address = settings.get("AP_ADDRESS", "172.16.77.1")
    HTTPServer((address, 7878), Handler).serve_forever()


if __name__ == "__main__":
    main()
