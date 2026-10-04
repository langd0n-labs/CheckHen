#!/usr/bin/env python3
"""Exercise DHCP, captive redirect, lease binding, and NAT with one namespace."""
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import urllib.request

from settings import ROOT, read_env


NAMESPACE = "checkhen-m2"
HOST_IF = "chveth0"
CLIENT_IF = "chpeer0"
RESOLV = Path("/etc/netns") / NAMESPACE
STATE = Path("/run/checkhen")


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, text=True, capture_output=True, check=check)


def namespace(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return run("ip", "netns", "exec", NAMESPACE, *args, check=check)


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run this namespace check with sudo")
    settings = read_env()
    if STATE.joinpath("state.json").exists():
        raise SystemExit("Stop class mode before running the namespace check")
    if run("ip", "link", "show", "dev", HOST_IF, check=False).returncode == 0:
        raise SystemExit("Test veth already exists; remove it before running this check")
    if NAMESPACE in run("ip", "netns", "list").stdout:
        raise SystemExit("Test namespace already exists; remove it before running this check")
    settings["AP_INTERFACE"] = HOST_IF
    settings["AP_TEST_MODE"] = "1"
    settings["PREAUTH_DISCOVERY"] = "0"
    settings["UPLINK_INTERFACE"] = json.loads(run("ip", "-j", "route", "get", "1.1.1.1").stdout)[0]["dev"]
    settings["AP_PASSPHRASE"] = "namespace-only"
    secret = settings["PORTAL_CONTROL_SECRET"]
    address = settings.get("AP_ADDRESS", "172.16.77.1")
    subnet = ipaddress.IPv4Network(settings.get("AP_SUBNET", "172.16.77.0/24"))
    config_path = None
    started = False
    created_namespace = False
    created_veth = False
    try:
        run("ip", "netns", "add", NAMESPACE)
        created_namespace = True
        run("ip", "link", "add", HOST_IF, "type", "veth", "peer", "name", CLIENT_IF)
        created_veth = True
        run("ip", "link", "set", CLIENT_IF, "netns", NAMESPACE)
        namespace("ip", "link", "set", "lo", "up")
        namespace("ip", "link", "set", CLIENT_IF, "up")
        RESOLV.mkdir(parents=True, exist_ok=True)
        (RESOLV / "resolv.conf").write_text(f"nameserver {address}\n")
        with tempfile.NamedTemporaryFile(mode="w", prefix="checkhen-test-", suffix=".env",
                                         delete=False) as file:
            config_path = Path(file.name)
            os.chmod(config_path, 0o600)
            for key, value in settings.items():
                file.write(f"{key}={value}\n")
        run(sys.executable, str(ROOT / "network/laptop/classroom.py"), "start", str(config_path))
        started = True
        lease_file = "/tmp/checkhen-m2-dhclient.leases"
        pid_file = "/tmp/checkhen-m2-dhclient.pid"
        namespace("dhclient", "-4", "-1", "-v", "-lf", lease_file,
                  "-pf", pid_file, CLIENT_IF)
        mac = json.loads(namespace("ip", "-j", "link", "show", "dev", CLIENT_IF).stdout)[0]["address"]
        addresses = json.loads(namespace("ip", "-j", "-4", "address", "show", "dev", CLIENT_IF).stdout)
        client_ips = [entry["local"] for entry in addresses[0].get("addr_info", [])]
        if len(client_ips) != 1 or ipaddress.IPv4Address(client_ips[0]) not in subnet:
            raise RuntimeError("DHCP did not configure the client address")
        lease_ip = client_ips[0]
        routes = json.loads(namespace("ip", "-j", "-4", "route", "show", "default").stdout)
        if not any(route.get("gateway") == address for route in routes):
            raise RuntimeError("DHCP did not configure the AP as the default gateway")
        recorded = False
        for line in (STATE / "dnsmasq/leases").read_text().splitlines():
            fields = line.split()
            if len(fields) >= 3 and fields[1].lower() == mac.lower() and fields[2] == lease_ip:
                recorded = True
        if not recorded:
            raise RuntimeError("dnsmasq did not record the configured DHCP address")
        resolved = namespace("getent", "ahostsv4", settings.get("AP_HOSTNAME", "checkhen.rfkill.dev"))
        if address not in resolved.stdout:
            raise RuntimeError("The namespace cannot resolve the portal through AP DNS")
        redirect = namespace("curl", "-4", "--noproxy", "*", "--max-time", "8", "-ksS",
                             "-o", "/dev/null", "-w", "%{http_code}", "http://example.com")
        if redirect.stdout != "302":
            raise RuntimeError("An unauthenticated HTTP request did not reach the captive portal")
        blocked = namespace("curl", "-4", "--noproxy", "*", "--max-time", "4", "-fsSI",
                            "https://example.com", check=False)
        if blocked.returncode == 0:
            raise RuntimeError("An unauthenticated client reached the Internet")
        payload = json.dumps({"courseId": "namespace-course", "classId": "namespace-session",
                              "userId": "namespace-student", "ip": lease_ip,
                              "timestamp": int(time.time() * 1000)}).encode()
        signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        request = urllib.request.Request(f"http://{address}:7878/bind", payload,
                                         {"Content-Type": "application/json",
                                          "X-CheckHen-Signature": signature})
        with urllib.request.urlopen(request, timeout=5) as response:
            binding = json.load(response)
        if binding != {"ip": lease_ip, "mac": mac.lower()}:
            raise RuntimeError("The portal agent did not bind the DHCP IP and MAC")
        namespace("curl", "-4", "--noproxy", "*", "--max-time", "12", "-fsSI",
                  "https://example.com")
        print("PASS: DHCP lease, captive redirect, pre-sign-in block, signed IP/MAC bind, and uplink access")
    finally:
        if created_namespace:
            namespace("dhclient", "-r", "-pf",
                      "/tmp/checkhen-m2-dhclient.pid", CLIENT_IF, check=False)
        if started:
            run(sys.executable, str(ROOT / "network/laptop/classroom.py"), "stop", check=False)
        if created_namespace:
            run("ip", "netns", "delete", NAMESPACE, check=False)
        if created_veth:
            run("ip", "link", "delete", HOST_IF, check=False)
        if created_namespace:
            (RESOLV / "resolv.conf").unlink(missing_ok=True)
            if RESOLV.exists():
                RESOLV.rmdir()
        if config_path:
            config_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"M2 namespace check failed: {error}") from error
