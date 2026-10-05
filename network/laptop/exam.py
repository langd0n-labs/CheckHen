"""Transient exam network policy and connection evidence for the laptop AP."""
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import signal
import socket
import subprocess
import time
import urllib.request

STATE = Path("/run/checkhen")
EXAM = STATE / "exam.json"
DNS_SERVERS = STATE / "exam-servers"
CLASS_STATE = STATE / "state.json"
DOMAIN = re.compile(r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")


def validate_domains(value: object) -> list[str]:
    if not isinstance(value, list) or not value or len(value) > 50:
        raise ValueError("Exam requires 1-50 allowlisted domains")
    domains = [entry.lower().strip().rstrip(".") for entry in value if isinstance(entry, str)]
    if len(domains) != len(value) or any(not DOMAIN.fullmatch(name) for name in domains):
        raise ValueError("Invalid exam allowlist domain")
    return list(dict.fromkeys(domains))


def resolve_domains(domains: list[str]) -> tuple[list[str], list[str]]:
    addresses: set[str] = set()
    for domain in domains:
        try:
            results = socket.getaddrinfo(domain, None, type=socket.SOCK_STREAM)
        except socket.gaierror as error:
            raise OSError(f"Could not resolve exam domain {domain}") from error
        found = {str(ipaddress.ip_address(result[4][0])) for result in results
                 if ipaddress.ip_address(result[4][0]).is_global}
        if not found:
            raise OSError(f"Exam domain {domain} has no public address")
        addresses.update(found)
    return (sorted(address for address in addresses if ipaddress.ip_address(address).version == 4),
            sorted(address for address in addresses if ipaddress.ip_address(address).version == 6))


def apply_policy(ipv4: list[str], ipv6: list[str], active: bool, uplink: str) -> None:
    # nft -f is one transaction: a refresh cannot expose an empty allowlist.
    commands = ["flush set ip checkhen exam4", "flush set ip6 checkhen6 exam6",
                "flush chain ip checkhen exam_gate", "flush chain ip6 checkhen6 exam_gate"]
    if active:
        if ipv4:
            commands.append("add element ip checkhen exam4 { " + ", ".join(ipv4) + " }")
        if ipv6:
            commands.append("add element ip6 checkhen6 exam6 { " + ", ".join(ipv6) + " }")
        commands.extend([
            f'add rule ip checkhen exam_gate ip saddr . ether saddr @authorized4 ip daddr @exam4 oifname "{uplink}" accept',
            'add rule ip checkhen exam_gate counter drop',
            f'add rule ip6 checkhen6 exam_gate ether saddr @authorized6 ip6 daddr @exam6 oifname "{uplink}" accept',
            'add rule ip6 checkhen6 exam_gate counter drop',
        ])
    subprocess.run(["nft", "-f", "-"], input="\n".join(commands) + "\n", text=True,
                   check=True, capture_output=True)


def write_dns(domains: list[str], dnsmasq_pid: int) -> None:
    # server=/#/ makes all other names local; specific domains use the uplink resolvers.
    lines = ["server=/#/"] if domains else []
    for domain in domains:
        lines.extend((f"server=/{domain}/1.1.1.1", f"server=/{domain}/9.9.9.9"))
    temporary = DNS_SERVERS.with_suffix(".tmp")
    temporary.write_text("\n".join(lines) + "\n")
    temporary.replace(DNS_SERVERS)
    Path(DNS_SERVERS).chmod(0o644)
    # dnsmasq re-reads servers-file and clears its cache on SIGHUP.
    os.kill(dnsmasq_pid, signal.SIGHUP)


def save(state: dict) -> None:
    temporary = EXAM.with_suffix(".tmp")
    temporary.write_text(json.dumps(state, sort_keys=True))
    temporary.chmod(0o600)
    temporary.replace(EXAM)


def read() -> dict | None:
    return json.loads(EXAM.read_text()) if EXAM.exists() else None


def start(scope: dict, exam_id: str, domains: list[str], clients: list[dict],
          threshold_seconds: int, now: float | None = None) -> dict:
    if read():
        raise ValueError("Exam mode is already active")
    domains = validate_domains(domains)
    if not isinstance(threshold_seconds, int) or not 1 <= threshold_seconds <= 3600:
        raise ValueError("Invalid exam fail threshold")
    if not isinstance(clients, list) or not clients or any(not isinstance(client, dict) or
                          not isinstance(client.get("userId"), str) or not client["userId"] or
                          not isinstance(client.get("mac"), str) or
                          not re.fullmatch(r"[0-9a-f]{2}(?::[0-9a-f]{2}){5}", client["mac"], re.I)
                          for client in clients):
        raise ValueError("Exam clients need signed-in device MACs")
    if len({client["userId"] for client in clients}) != len(clients):
        raise ValueError("Duplicate exam client")
    classroom = json.loads(CLASS_STATE.read_text())
    ipv4, ipv6 = resolve_domains(domains)
    clock = time.time() if now is None else now
    state = {**scope, "examId": exam_id, "domains": domains, "thresholdSeconds": threshold_seconds,
             "uplink": classroom["uplink"], "dnsmasqPid": classroom["processes"]["dnsmasq"],
             "ipv4": ipv4, "ipv6": ipv6, "refreshedAt": clock,
             "clients": {client["userId"]: {"mac": client["mac"].lower(), "lastHeartbeat": clock,
                        "lastStation": clock, "stationSeen": False, "failedAt": None,
                        "reported": False} for client in clients}}
    apply_policy(ipv4, ipv6, True, state["uplink"])
    try:
        write_dns(domains, state["dnsmasqPid"])
        save(state)
    except Exception:
        try:
            write_dns([], state["dnsmasqPid"])
        except OSError:
            pass
        apply_policy([], [], False, state["uplink"])
        raise
    return state


def stop(scope: dict) -> None:
    state = read()
    if not state:
        return
    if any(state[key] != scope[key] for key in ("courseId", "classId")):
        raise PermissionError("Wrong exam session")
    apply_policy([], [], False, state["uplink"])
    write_dns([], state["dnsmasqPid"])
    EXAM.unlink(missing_ok=True)


def refresh(state: dict, now: float) -> dict:
    if now - state["refreshedAt"] < 30:
        return state
    ipv4, ipv6 = resolve_domains(state["domains"])
    apply_policy(ipv4, ipv6, True, state["uplink"])
    state.update(ipv4=ipv4, ipv6=ipv6, refreshedAt=now)
    save(state)
    return state


def heartbeat(scope: dict, user_id: str, now: float | None = None) -> None:
    state = read()
    if not state or any(state[key] != scope[key] for key in ("courseId", "classId")):
        return
    client = state["clients"].get(user_id)
    if client:
        client["lastHeartbeat"] = time.time() if now is None else now
        save(state)


def connection_status(state: dict, stations: set[str] | None, now: float) -> list[dict]:
    result = []
    stations = stations or set()
    for user_id, client in state["clients"].items():
        if client["mac"] in stations:
            client["lastStation"] = now
            client["stationSeen"] = True
        # A station can leave between five-second nl80211 polls; allow that gap.
        station_last_seen = client["lastStation"] + (5 if client.get("stationSeen") else 0)
        last_seen = max(client["lastHeartbeat"], station_last_seen)
        connected = client["mac"] in stations or now - client["lastHeartbeat"] <= 8
        if not connected and now - last_seen > state["thresholdSeconds"] and client.get("failedAt") is None:
            client["failedAt"] = now
        result.append({"userId": user_id, "connected": connected,
                       "disconnectedAt": None if connected else last_seen,
                       "failed": client["reported"] or client.get("failedAt") is not None})
    return result


def notify_fail(state: dict, user_id: str, secret: str, url: str) -> bool:
    raw = json.dumps({"courseId": state["courseId"], "classId": state["classId"],
                      "examId": state["examId"], "userId": user_id,
                      "timestamp": int(time.time() * 1000)}).encode()
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    request = urllib.request.Request(url, raw, {"Content-Type": "application/json",
                                               "X-CheckHen-Signature": signature})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status == 200
    except OSError:
        return False


def monitor(stations: set[str] | None, secret: str, callback_url: str,
            now: float | None = None) -> list[dict]:
    state = read()
    if not state:
        return []
    clock = time.time() if now is None else now
    try:
        state = refresh(state, clock)
    except (OSError, subprocess.CalledProcessError):
        # Keep the last successful IP sets; retry on the next agent poll.
        pass
    statuses = connection_status(state, stations, clock)
    for status in statuses:
        client = state["clients"][status["userId"]]
        if status["failed"] and not client["reported"]:
            client["reported"] = notify_fail(state, status["userId"], secret, callback_url)
    save(state)
    return statuses
