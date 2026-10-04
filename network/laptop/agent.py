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
import urllib.error
import urllib.request

from settings import read_env


STATE = Path("/run/checkhen")
LEASES = STATE / "dnsmasq/leases"
BINDINGS = STATE / "bindings.json"
PENDING = STATE / "pending-checkouts.json"
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


def lease_ip_for_mac(mac: str) -> str | None:
    if not LEASES.exists():
        return None
    now = time.time()
    for line in LEASES.read_text().splitlines():
        fields = line.split()
        if len(fields) >= 3 and fields[1].lower() == mac and MAC.fullmatch(mac):
            try:
                if int(fields[0]) > now:
                    return str(ipaddress.IPv4Address(fields[2]))
            except ValueError:
                pass
    return None


def neighbor_mac(ip: str, interface: str) -> str | None:
    result = subprocess.run(["ip", "-j", "-6", "neigh", "show", "to", ip, "dev", interface],
                            text=True, capture_output=True, check=True)
    for neighbor in json.loads(result.stdout):
        mac = neighbor.get("lladdr", "").lower()
        if neighbor.get("dst") == ip and MAC.fullmatch(mac):
            return mac
    return None


def nft(action: str, ip: str, mac: str) -> None:
    if action not in {"add", "delete"}:
        raise ValueError("Invalid nft action")
    ipaddress.IPv4Address(ip)
    if not MAC.fullmatch(mac):
        raise ValueError("Invalid MAC")
    verb = "destroy" if action == "delete" else "add"
    command = f"{verb} element ip checkhen authorized4 {{ {ip} . {mac} }}\n"
    subprocess.run(["nft", "-f", "-"], input=command, text=True,
                   check=True, capture_output=True)


def nft6(action: str, mac: str) -> None:
    if action not in {"add", "delete"} or not MAC.fullmatch(mac):
        raise ValueError("Invalid IPv6 nft element")
    verb = "destroy" if action == "delete" else "add"
    subprocess.run(["nft", "-f", "-"],
                   input=f"{verb} element ip6 checkhen6 authorized6 {{ {mac} }}\n",
                   text=True, check=True, capture_output=True)


def save(bindings: dict[str, dict]) -> None:
    temporary = BINDINGS.with_suffix(".tmp")
    temporary.write_text(json.dumps(bindings, sort_keys=True))
    temporary.chmod(0o600)
    temporary.replace(BINDINGS)


def read_pending() -> list[dict]:
    if not PENDING.exists():
        return []
    try:
        pending = json.loads(PENDING.read_text())
        if isinstance(pending, list) and all(isinstance(item, dict) and all(
            isinstance(item.get(key), str) and item[key] for key in ("userId", "courseId", "classId")
        ) for item in pending):
            return pending
    except json.JSONDecodeError:
        pass
    PENDING.rename(PENDING.with_suffix(".corrupt"))
    return []


def queue_checkout(binding: dict) -> None:
    pending = read_pending()
    scope = {key: binding[key] for key in ("userId", "courseId", "classId")}
    if scope not in pending:
        pending.append(scope)
        temporary = PENDING.with_suffix(".tmp")
        temporary.write_text(json.dumps(pending))
        temporary.chmod(0o600)
        temporary.replace(PENDING)


def flush_checkout_notifications(secret: str, url: str, bindings: dict[str, dict]) -> None:
    if not PENDING.exists():
        return
    pending = read_pending()
    remaining = []
    for scope in pending:
        if any(all(binding.get(key) == value for key, value in scope.items())
               for binding in bindings.values()):
            continue
        raw = json.dumps({**scope, "timestamp": int(time.time() * 1000)}).encode()
        signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
        request = urllib.request.Request(url, raw, {"Content-Type": "application/json",
                                                  "X-CheckHen-Signature": signature})
        try:
            with urllib.request.urlopen(request, timeout=3) as response:
                if response.status != 200:
                    remaining.append(scope)
        except (OSError, urllib.error.HTTPError):
            remaining.append(scope)
    PENDING.write_text(json.dumps(remaining))
    PENDING.chmod(0o600)


def ap_client_ip(value: str, subnet: ipaddress.IPv4Network,
                 ipv6_subnet: ipaddress.IPv6Network) -> str:
    address = ipaddress.ip_address(value)
    if address not in (subnet if address.version == 4 else ipv6_subnet):
        raise PermissionError("Outside AP subnet")
    return str(address)


def read_bindings() -> dict[str, dict]:
    if not BINDINGS.exists():
        return {}
    try:
        bindings = json.loads(BINDINGS.read_text())
        if not isinstance(bindings, dict):
            raise ValueError("Invalid bindings file")
        for ip, binding in bindings.items():
            ipaddress.ip_address(ip)
            if not isinstance(binding, dict) or not isinstance(binding.get("mac"), str) or not MAC.fullmatch(binding["mac"]) or any(
                not isinstance(binding.get(key), str) for key in ("userId", "courseId", "classId")
            ):
                raise ValueError("Invalid binding")
        return bindings
    except (ValueError, json.JSONDecodeError):
        BINDINGS.rename(BINDINGS.with_suffix(".corrupt"))
        return {}


def reconcile_bindings() -> None:
    # The agent may restart while nftables survives. Rebuild the set from live leases.
    subprocess.run(["nft", "flush", "set", "ip", "checkhen", "authorized4"],
                   check=True, capture_output=True)
    subprocess.run(["nft", "flush", "set", "ip6", "checkhen6", "authorized6"],
                   check=True, capture_output=True)
    current = {}
    for ip, binding in read_bindings().items():
        lease = lease_mac(ip) if ipaddress.ip_address(ip).version == 4 else None
        if ipaddress.ip_address(ip).version == 4 and lease is None:
            time.sleep(0.1)
            lease = lease_mac(ip)
        valid = (lease == binding.get("mac") if ipaddress.ip_address(ip).version == 4
                 else binding.get("expiresAt", 0) > time.time())
        if valid:
            if ipaddress.ip_address(ip).version == 4:
                nft("add", ip, binding["mac"])
            nft6("add", binding["mac"])
            current[ip] = binding
    save(current)


def station_macs(interface: str) -> set[str] | None:
    result = subprocess.run(["iw", "dev", interface, "station", "dump"],
                            text=True, capture_output=True)
    if result.returncode:
        return None
    return {line.split()[1].lower() for line in result.stdout.splitlines()
            if line.startswith("Station ") and len(line.split()) >= 2}


def prune_bindings(interface: str | None) -> None:
    bindings = read_bindings()
    for ip, binding in list(bindings.items()):
        # A station may reconnect within M5's grace period. The nft key includes
        # its MAC, so departure alone never transfers access to another device.
        if ipaddress.ip_address(ip).version == 4:
            lease = lease_mac(ip)
            if lease is None:
                if "leaseMissedAt" not in binding:
                    binding["leaseMissedAt"] = time.time()
                    binding["leaseMisses"] = 1
                elif time.time() - binding["leaseMissedAt"] >= 1:
                    binding["leaseMisses"] = 2
                save(bindings)
                expired = binding["leaseMisses"] >= 2
            else:
                if binding.pop("leaseMisses", None) is not None:
                    binding.pop("leaseMissedAt", None)
                    save(bindings)
                expired = lease != binding.get("mac")
        else:
            expired = binding.get("expiresAt", 0) <= time.time()
        if expired:
            try:
                remove_binding(bindings, ip, notify=True)
            except (OSError, subprocess.CalledProcessError):
                print("Portal binding cleanup failed; continuing", file=sys.stderr)
                continue


def remove_binding(bindings: dict[str, dict], ip: str, notify: bool = False) -> None:
    binding = bindings[ip]
    last_for_student = not any(other_ip != ip and all(other.get(key) == binding[key] for key in
                               ("userId", "courseId", "classId"))
                               for other_ip, other in bindings.items())
    if notify and last_for_student:
        queue_checkout(binding)
    if ipaddress.ip_address(ip).version == 4:
        nft("delete", ip, binding["mac"])
    if not any(other_ip != ip and other.get("mac") == binding["mac"]
               for other_ip, other in bindings.items()):
        nft6("delete", binding["mac"])
    del bindings[ip]
    save(bindings)


def revoke_matching(bindings: dict[str, dict], scope: dict, keys: tuple[str, ...]) -> None:
    failed = False
    for ip, binding in list(bindings.items()):
        if all(binding.get(key) == scope[key] for key in keys):
            try:
                remove_binding(bindings, ip)
            except (OSError, subprocess.CalledProcessError):
                failed = True
                continue
    if failed:
        raise OSError("One or more bindings could not be revoked")


class Handler(BaseHTTPRequestHandler):
    secret = ""
    subnet = ipaddress.IPv4Network("172.16.77.0/24")
    ipv6_subnet = ipaddress.IPv6Network("fd9b:2f69:8c44::/64")
    interface = "wlan0"

    def do_POST(self) -> None:
        if self.path not in {"/bind", "/revoke", "/revoke-student", "/revoke-session"}:
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
            keys = ("courseId", "classId") if self.path == "/revoke-session" else ("userId", "courseId", "classId")
            if not all(isinstance(data.get(key), str) and data[key] for key in keys):
                raise ValueError("Missing scope")
            ip = ap_client_ip(data["ip"], self.subnet, self.ipv6_subnet) if self.path in {"/bind", "/revoke"} else None
            bindings = read_bindings()
            if self.path == "/bind":
                assert ip is not None
                mac = (lease_mac(ip) if ipaddress.ip_address(ip).version == 4
                       else neighbor_mac(ip, self.interface))
                if not mac:
                    raise PermissionError("No active AP neighbor or DHCP lease")
                previous = bindings.get(ip)
                identity = (data["userId"], data["courseId"], data["classId"])
                if any(binding.get("mac") == mac and
                       tuple(binding.get(key) for key in ("userId", "courseId", "classId")) != identity
                       for binding in bindings.values()):
                    raise PermissionError("Device is already bound to another student or session")
                if previous and tuple(previous.get(key) for key in ("userId", "courseId", "classId")) != identity:
                    raise PermissionError("Address is already bound to another student or session")
                if previous and previous["mac"] != mac:
                    remove_binding(bindings, ip)
                ipv4_added = None
                had_ipv4 = False
                if ipaddress.ip_address(ip).version == 4:
                    had_ipv4 = ip in bindings and bindings[ip]["mac"] == mac
                    nft("add", ip, mac)
                    ipv4_added = ip
                else:
                    leased_ip = lease_ip_for_mac(mac)
                    if leased_ip:
                        had_ipv4 = leased_ip in bindings and bindings[leased_ip]["mac"] == mac
                        nft("add", leased_ip, mac)
                        ipv4_added = leased_ip
                        bindings[leased_ip] = {"mac": mac, "userId": data["userId"],
                                               "courseId": data["courseId"], "classId": data["classId"]}
                try:
                    nft6("add", mac)
                except (OSError, subprocess.CalledProcessError):
                    if ipv4_added and not had_ipv4:
                        nft("delete", ipv4_added, mac)
                        bindings.pop(ipv4_added, None)
                    raise
                bindings[ip] = {"mac": mac, "userId": data["userId"],
                                "courseId": data["courseId"], "classId": data["classId"],
                                **({"expiresAt": time.time() + 43200} if ipaddress.ip_address(ip).version == 6 else {})}
                save(bindings)
            elif self.path == "/revoke":
                assert ip is not None
                previous = bindings.get(ip)
                if not previous or any(previous[key] != data[key]
                                       for key in ("userId", "courseId", "classId")):
                    raise PermissionError("Binding not found")
                mac = previous["mac"]
                for bound_ip, bound in list(bindings.items()):
                    if bound["mac"] == mac and all(bound[key] == data[key]
                                                     for key in ("userId", "courseId", "classId")):
                        remove_binding(bindings, bound_ip)
            else:
                revoke_matching(bindings, data, keys)
                mac = None
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
    Handler.ipv6_subnet = ipaddress.IPv6Network(settings.get("AP_IPV6_PREFIX", "fd9b:2f69:8c44::/64"))
    Handler.interface = settings["AP_INTERFACE"]
    address = settings.get("AP_ADDRESS", "172.16.77.1")
    reconcile_bindings()
    interface = None if settings.get("AP_TEST_MODE") == "1" else settings["AP_INTERFACE"]
    server = HTTPServer((address, 7878), Handler)
    server.timeout = 5
    while True:
        server.handle_request()
        try:
            prune_bindings(interface)
            flush_checkout_notifications(Handler.secret,
                settings.get("APP_CALLBACK_URL", "http://127.0.0.1:3000/api/internal/portal-expired"),
                read_bindings())
        except (OSError, subprocess.CalledProcessError):
            print("Portal binding cleanup failed; retrying", file=sys.stderr)


if __name__ == "__main__":
    main()
