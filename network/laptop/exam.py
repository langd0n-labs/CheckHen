"""Transient exam network policy and connection evidence for the laptop AP."""
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import re
import secrets
import signal
import socket
import struct
import subprocess
import time
import urllib.request

STATE = Path("/run/checkhen")
EXAM = STATE / "exam.json"
DNS_SERVERS = STATE / "exam-servers"
CLASS_STATE = STATE / "state.json"
DOMAIN = re.compile(r"^(?=.{1,253}$)[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$")
# Evidence this recent shows a client as connected. A reported fail re-arms after it.
CONNECTED_SECONDS = 8
# dnsmasq applies a servers-file on SIGHUP; wait before the sets are flushed.
DNS_RELOAD_SECONDS = 1
# Seeding repeats often, so a refreshed or rotating answer reaches the sets quickly.
SEED_SECONDS = 10
IDLE_FLUSH_SECONDS = 60
# hostapd checks an idle station only after ap_max_inactivity plus up to 19 s of
# random delay, so a present, idle device can look gone for about 29 s. The agent
# sends idle exam devices a packet instead; the device's reply or 802.11 ACK resets
# its inactive time.
PROBE_AFTER_SECONDS = 3
PROBE_EVERY_SECONDS = 2
# The shortest disconnect limit: heartbeats are 5 s apart.
MIN_THRESHOLD_SECONDS = 10
_probed: dict[str, float] = {}
# Station evidence shows a gap only when the polls around it were this close: after a
# longer stall, a station's latest activity says nothing about the time in between.
STATION_POLL_GAP_SECONDS = 2.0
# Socket heartbeats arrive between monitor passes; the monitor folds them into exam.json.
# Each entry is keyed by the sending device's MAC and keeps the first and last arrival
# since the last fold.
HEARTBEATS: dict[tuple[str, str, str, str], tuple[float, float]] = {}
_idle_flushed_at = 0.0


def validate_domains(value: object) -> list[str]:
    if not isinstance(value, list) or not value or len(value) > 50:
        raise ValueError("Exam requires 1-50 allowlisted domains")
    domains = [entry.lower().strip().rstrip(".") for entry in value if isinstance(entry, str)]
    if len(domains) != len(value) or any(not DOMAIN.fullmatch(name) for name in domains):
        raise ValueError("Invalid exam allowlist domain")
    return list(dict.fromkeys(domains))


def covered(domain: str, names: list[str]) -> bool:
    return any(domain == name or domain.endswith("." + name) for name in names)


def apply_policy(active: bool, uplink: str) -> None:
    # dnsmasq nftset=/#/ fills exam4 and exam6 with the answers that clients receive.
    # nft -f is one transaction: the gate never runs against a partial update.
    commands = ["flush set ip checkhen exam4", "flush set ip6 checkhen6 exam6",
                "flush chain ip checkhen exam_gate", "flush chain ip6 checkhen6 exam_gate"]
    if active:
        # The gate runs before the private-range drop, so it excludes those ranges
        # itself: an allowlisted name that resolves to a LAN address stays blocked.
        commands.extend([
            f'add rule ip checkhen exam_gate ip saddr . ether saddr @authorized4 ip daddr @exam4 ip daddr != @private4 oifname "{uplink}" accept',
            'add rule ip checkhen exam_gate counter drop',
            f'add rule ip6 checkhen6 exam_gate ether saddr @authorized6 ip6 daddr @exam6 ip6 daddr != @private6 oifname "{uplink}" accept',
            'add rule ip6 checkhen6 exam_gate counter drop',
        ])
    subprocess.run(["nft", "-f", "-"], input="\n".join(commands) + "\n", text=True,
                   check=True, capture_output=True)


def add_addresses(addresses: list[str]) -> None:
    ipv4 = [value for value in addresses if ipaddress.ip_address(value).version == 4]
    ipv6 = [value for value in addresses if ipaddress.ip_address(value).version == 6]
    commands = []
    if ipv4:
        commands.append("add element ip checkhen exam4 { " + ", ".join(ipv4) + " }")
    if ipv6:
        commands.append("add element ip6 checkhen6 exam6 { " + ", ".join(ipv6) + " }")
    if commands:
        subprocess.run(["nft", "-f", "-"], input="\n".join(commands) + "\n", text=True,
                       check=True, capture_output=True)


def flush_idle(now: float) -> None:
    """Outside an exam, dnsmasq adds every answer to the exam sets. Keep them small."""
    global _idle_flushed_at
    if now - _idle_flushed_at >= IDLE_FLUSH_SECONDS:
        subprocess.run(["nft", "-f", "-"], input="flush set ip checkhen exam4\nflush set ip6 checkhen6 exam6\n",
                       text=True, check=True, capture_output=True)
        _idle_flushed_at = now


def skip_name(data: bytes, offset: int) -> int:
    while True:
        length = data[offset]
        if length & 0xC0 == 0xC0:
            return offset + 2
        offset += 1 + length
        if length == 0:
            return offset


def query(server: str, name: str, record_type: int, timeout: float = 2) -> list[str]:
    """Ask the AP's dnsmasq, so the answer matches what clients receive."""
    ident = secrets.randbits(16)
    question = b"".join(bytes([len(label)]) + label.encode() for label in name.split("."))
    question += b"\0" + struct.pack("!HH", record_type, 1)
    family = socket.AF_INET6 if ipaddress.ip_address(server).version == 6 else socket.AF_INET
    with socket.socket(family, socket.SOCK_DGRAM) as connection:
        connection.settimeout(timeout)
        connection.sendto(struct.pack("!HHHHHH", ident, 0x0100, 1, 0, 0, 0) + question, (server, 53))
        data = connection.recv(4096)
    response_id, flags, _, answers = struct.unpack("!HHHH", data[:8])
    if response_id != ident or flags & 0x000F:
        return []
    offset = skip_name(data, 12) + 4
    addresses = []
    for _ in range(answers):
        offset = skip_name(data, offset)
        kind, _, _, length = struct.unpack("!HHIH", data[offset:offset + 10])
        offset += 10
        value = data[offset:offset + length]
        offset += length
        if (kind, length) in {(1, 4), (28, 16)}:
            address = ipaddress.ip_address(value)
            if address.is_global:
                addresses.append(str(address))
    return addresses


def resolve(server: str, domain: str) -> list[str]:
    addresses = []
    for record_type in (1, 28):
        try:
            addresses.extend(query(server, domain, record_type))
        except (OSError, struct.error, IndexError):
            continue
    return addresses


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
          threshold_seconds: int, preauth: list[str] | None = None, now: float | None = None) -> dict:
    if read():
        raise ValueError("Exam mode is already active")
    domains = validate_domains(domains)
    if (not isinstance(threshold_seconds, int) or
            not MIN_THRESHOLD_SECONDS <= threshold_seconds <= 3600):
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
    clock = time.time() if now is None else now
    state = {**scope, "examId": exam_id, "domains": domains, "thresholdSeconds": threshold_seconds,
             "uplink": classroom["uplink"], "dnsmasqPid": classroom["processes"]["dnsmasq"],
             # Seeding puts each allowlisted name's addresses in the exam sets as soon as
             # the gate starts, for clients that resolved them before the exam. It also
             # covers sign-in names, which dnsmasq sends to the preauth sets only: both
             # sign-in names under an allowlisted name (google.com covers
             # accounts.google.com) and allowlisted names under a sign-in name.
             "seedDomains": domains + [name for name in preauth or []
                                       if covered(name, domains) and name not in domains],
             "seededAt": 0,
             "clients": {client["userId"]: {"mac": client["mac"].lower(), "lastHeartbeat": clock,
                        "lastStation": clock, "failedAt": None, "failId": None,
                        "reported": False} for client in clients}}
    try:
        write_dns(domains, state["dnsmasqPid"])
        time.sleep(DNS_RELOAD_SECONDS)
        apply_policy(True, state["uplink"])
        save(state)
    except Exception:
        try:
            write_dns([], state["dnsmasqPid"])
        except OSError:
            pass
        apply_policy(False, state["uplink"])
        raise
    return state


def stop(scope: dict) -> None:
    state = read()
    if not state:
        return
    if any(state[key] != scope[key] for key in ("courseId", "classId")):
        raise PermissionError("Wrong exam session")
    apply_policy(False, state["uplink"])
    write_dns([], state["dnsmasqPid"])
    EXAM.unlink(missing_ok=True)
    for key in [key for key in HEARTBEATS if key[:2] == (scope["courseId"], scope["classId"])]:
        del HEARTBEATS[key]


def seed_due(state: dict, now: float) -> list[str]:
    if not state.get("seedDomains") or now - state.get("seededAt", 0) < SEED_SECONDS:
        return []
    state["seededAt"] = now
    save(state)
    return state["seedDomains"]


def heartbeat(scope: dict, user_id: str, mac: str, now: float | None = None) -> None:
    # In memory: a heartbeat must not cost a file write on the request path.
    clock = time.time() if now is None else now
    key = (scope["courseId"], scope["classId"], user_id, mac.lower())
    first = HEARTBEATS[key][0] if key in HEARTBEATS else clock
    HEARTBEATS[key] = (first, clock)


def client_status(client: dict, threshold: int, now: float) -> dict:
    last_seen = max(client["lastHeartbeat"], client["lastStation"])
    connected = now - last_seen <= min(CONNECTED_SECONDS, threshold)
    return {"connected": connected, "disconnectedAt": None if connected else last_seen,
            "failed": bool(client.get("reported")) or client.get("failedAt") is not None}


def connection_status(state: dict, stations: dict[str, float] | None, now: float) -> list[dict]:
    """Fold one station poll, taken at `now`, and the heartbeats since the last fold.

    Stations map each associated MAC to seconds since the AP last heard it. A listed
    station counts only from its last activity, so a device that vanished without
    leaving the list is not connected. None means station data is unavailable; then
    no new fail is recorded.

    A drop fails in either of two ways: evidence is missing for longer than the
    threshold now, or evidence returns after a gap longer than the threshold. The
    second catches a drop that ended between two passes.
    """
    previous_poll = state.get("stationObservedAt")
    trusted = (stations is not None and previous_poll is not None and
               now - previous_poll <= STATION_POLL_GAP_SECONDS)
    if stations is not None:
        state["stationObservedAt"] = now
    threshold = state["thresholdSeconds"]
    result = []
    for user_id, client in state["clients"].items():
        previous = max(client["lastHeartbeat"], client["lastStation"])
        arrivals = []
        # Only the exam device's heartbeats count: another device of the same student
        # (a phone with the class page open) must not cover the exam device leaving.
        heard = HEARTBEATS.pop((state["courseId"], state["classId"], user_id, client["mac"]), None)
        if heard is not None:
            if heard[0] > previous:
                arrivals.append(heard[0])
            client["lastHeartbeat"] = max(client["lastHeartbeat"], heard[1])
        if stations and client["mac"] in stations:
            seen = now - stations[client["mac"]]
            if seen > previous:
                arrivals.append(seen)
            client["lastStation"] = max(client["lastStation"], seen)
        if client.get("failedAt") is not None and not client.get("failId"):
            # A fail saved before fail IDs existed gets one, so it can be reported.
            client["failId"] = secrets.token_hex(16)
        last_seen = max(client["lastHeartbeat"], client["lastStation"])
        if now - last_seen <= min(CONNECTED_SECONDS, threshold) and client.get("reported"):
            # The reported drop has ended. A later drop is a separate fail, even after
            # the instructor excused this one.
            client.update(failedAt=None, failId=None, reported=False)
        missing = now - last_seen > threshold
        returned_after_gap = trusted and bool(arrivals) and min(arrivals) - previous > threshold
        if (stations is not None and client.get("failedAt") is None and
                (missing or returned_after_gap)):
            client.update(failedAt=now, failId=secrets.token_hex(16))
        result.append({"userId": user_id, **client_status(client, threshold, now)})
    for key in [key for key in HEARTBEATS if key[:2] == (state["courseId"], state["classId"])]:
        del HEARTBEATS[key]
    return result


def probe_due(state: dict, stations: dict[str, float] | None, now: float) -> list[str]:
    """Exam device MACs that have been idle long enough to need a probe."""
    if not stations:
        return []
    due = []
    for client in state["clients"].values():
        mac = client["mac"]
        idle = stations.get(mac)
        if idle is not None and idle >= PROBE_AFTER_SECONDS and \
                now - _probed.get(mac, 0) >= PROBE_EVERY_SECONDS:
            _probed[mac] = now
            due.append(mac)
    return due


def probe(addresses: list[str]) -> None:
    """Send each address one UDP datagram to the discard port. It never blocks."""
    for address in addresses:
        family = socket.AF_INET6 if ipaddress.ip_address(address).version == 6 else socket.AF_INET
        try:
            with socket.socket(family, socket.SOCK_DGRAM) as connection:
                connection.setblocking(False)
                connection.sendto(b"", (address, 9))
        except OSError:
            continue


def status(state: dict, now: float) -> list[dict]:
    """Read-only view of the evidence the monitor last folded, for /exam-status."""
    return [{"userId": user_id, **client_status(client, state["thresholdSeconds"], now)}
            for user_id, client in state["clients"].items()]


def unreported(state: dict) -> list[dict]:
    scope = {key: state[key] for key in ("courseId", "classId", "examId")}
    return [{**scope, "userId": user_id, "failId": client.get("failId")}
            for user_id, client in state["clients"].items()
            if client.get("failedAt") is not None and not client.get("reported")]


def mark_reported(exam_id: str, user_id: str, fail_id: str) -> None:
    state = read()
    if state and state["examId"] == exam_id:
        client = state["clients"].get(user_id)
        if client and client.get("failId") == fail_id:
            client["reported"] = True
            save(state)


def notify_fail(fail: dict, secret: str, url: str) -> bool:
    raw = json.dumps({"courseId": fail["courseId"], "classId": fail["classId"],
                      "examId": fail["examId"], "userId": fail["userId"],
                      "failId": fail["failId"], "action": "exam-failed",
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
        _probed.clear()
        return []
    clock = time.time() if now is None else now
    connection_status(state, stations, clock)
    save(state)
    return unreported(state)
