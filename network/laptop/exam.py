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
# Evidence this recent shows a client as connected.
CONNECTED_SECONDS = 8
# Socket heartbeats arrive between monitor passes; the monitor folds them into exam.json.
HEARTBEATS: dict[tuple[str, str, str], float] = {}
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
                        "lastStation": clock, "failedAt": None,
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
    # In memory: a heartbeat must not cost a file write on the request path.
    HEARTBEATS[(scope["courseId"], scope["classId"], user_id)] = time.time() if now is None else now


def connection_status(state: dict, stations: dict[str, float] | None, now: float) -> list[dict]:
    """Stations map each associated MAC to seconds since the AP last heard it.

    A listed station counts only from its last activity, so a device that vanished
    without leaving the list is not connected. None means station data is
    unavailable; then no new fail is recorded.
    """
    result = []
    for user_id, client in state["clients"].items():
        heard = HEARTBEATS.pop((state["courseId"], state["classId"], user_id), None)
        if heard is not None:
            client["lastHeartbeat"] = max(client["lastHeartbeat"], heard)
        if stations and client["mac"] in stations:
            client["lastStation"] = max(client["lastStation"], now - stations[client["mac"]])
        last_seen = max(client["lastHeartbeat"], client["lastStation"])
        connected = now - last_seen <= min(CONNECTED_SECONDS, state["thresholdSeconds"])
        if (stations is not None and client.get("failedAt") is None and
                now - last_seen > state["thresholdSeconds"]):
            client["failedAt"] = now
        result.append({"userId": user_id, "connected": connected,
                       "disconnectedAt": None if connected else last_seen,
                       "failed": client["reported"] or client.get("failedAt") is not None})
    return result


def unreported(state: dict) -> list[dict]:
    scope = {key: state[key] for key in ("courseId", "classId", "examId")}
    return [{**scope, "userId": user_id} for user_id, client in state["clients"].items()
            if client.get("failedAt") is not None and not client["reported"]]


def mark_reported(exam_id: str, user_id: str) -> None:
    state = read()
    if state and state["examId"] == exam_id and user_id in state["clients"]:
        state["clients"][user_id]["reported"] = True
        save(state)


def notify_fail(fail: dict, secret: str, url: str) -> bool:
    raw = json.dumps({"courseId": fail["courseId"], "classId": fail["classId"],
                      "examId": fail["examId"], "userId": fail["userId"],
                      "timestamp": int(time.time() * 1000)}).encode()
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    request = urllib.request.Request(url, raw, {"Content-Type": "application/json",
                                               "X-CheckHen-Signature": signature})
    try:
        with urllib.request.urlopen(request, timeout=3) as response:
            return response.status == 200
    except OSError:
        return False


def monitor(stations: dict[str, float] | None, now: float | None = None) -> list[dict]:
    """Update connection evidence. Returns the fails that still need a callback."""
    state = read()
    if not state:
        HEARTBEATS.clear()
        return []
    clock = time.time() if now is None else now
    try:
        state = refresh(state, clock)
    except (OSError, subprocess.CalledProcessError):
        # Keep the last successful IP sets; retry on the next monitor pass.
        pass
    connection_status(state, stations, clock)
    save(state)
    return unreported(state)
