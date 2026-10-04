#!/usr/bin/env python3
"""Exercise DHCP, the shared proxy template, lease binding, and NAT."""
import hashlib
import hmac
import ipaddress
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

from settings import ROOT, read_env


NAMESPACE = "checkhen-m2"
SECOND_NAMESPACE = "checkhen-m2-second"
HOST_IF = "chbr0"
HOST_VETH = "chveth0"
SECOND_HOST_VETH = "chveth1"
CLIENT_IF = "chpeer0"
SECOND_CLIENT_IF = "chpeer1"
RESOLV = Path("/etc/netns") / NAMESPACE
SECOND_RESOLV = Path("/etc/netns") / SECOND_NAMESPACE
STATE = Path("/run/checkhen")


def run(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(args, text=True, capture_output=True, check=check)


def namespace(*args: str, check: bool = True, name: str = NAMESPACE) -> subprocess.CompletedProcess:
    return run("ip", "netns", "exec", name, *args, check=check)


def main() -> None:
    if os.geteuid() != 0:
        raise SystemExit("Run this namespace check with sudo")
    settings = read_env()
    if STATE.joinpath("state.json").exists():
        raise SystemExit("Stop class mode before running the namespace check")
    if run("ip", "link", "show", "dev", HOST_IF, check=False).returncode == 0:
        raise SystemExit("Test veth already exists; remove it before running this check")
    if any(name in run("ip", "netns", "list").stdout for name in (NAMESPACE, SECOND_NAMESPACE)):
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
    created_second_namespace = False
    created_veth = False
    created_bridge = False
    proxy = None
    try:
        run("ip", "netns", "add", NAMESPACE)
        created_namespace = True
        run("ip", "netns", "add", SECOND_NAMESPACE)
        created_second_namespace = True
        run("ip", "link", "add", HOST_IF, "type", "bridge")
        created_bridge = True
        run("ip", "link", "set", HOST_IF, "up")
        run("ip", "link", "add", HOST_VETH, "type", "veth", "peer", "name", CLIENT_IF)
        created_veth = True
        run("ip", "link", "set", CLIENT_IF, "netns", NAMESPACE)
        run("ip", "link", "set", HOST_VETH, "master", HOST_IF)
        run("ip", "link", "set", HOST_VETH, "up")
        run("ip", "link", "add", SECOND_HOST_VETH, "type", "veth", "peer", "name", SECOND_CLIENT_IF)
        run("ip", "link", "set", SECOND_CLIENT_IF, "netns", SECOND_NAMESPACE)
        run("ip", "link", "set", SECOND_HOST_VETH, "master", HOST_IF)
        run("ip", "link", "set", SECOND_HOST_VETH, "up")
        namespace("ip", "link", "set", "lo", "up")
        namespace("ip", "link", "set", CLIENT_IF, "up")
        namespace("ip", "link", "set", "lo", "up", name=SECOND_NAMESPACE)
        namespace("ip", "link", "set", SECOND_CLIENT_IF, "up", name=SECOND_NAMESPACE)
        run("ip", "-6", "address", "add", "fd77::1/64", "dev", HOST_IF)
        namespace("ip", "-6", "address", "add", "fd77::2/64", "dev", CLIENT_IF)
        RESOLV.mkdir(parents=True, exist_ok=True)
        (RESOLV / "resolv.conf").write_text(f"nameserver {address}\n")
        SECOND_RESOLV.mkdir(parents=True, exist_ok=True)
        (SECOND_RESOLV / "resolv.conf").write_text(f"nameserver {address}\n")
        with tempfile.NamedTemporaryFile(mode="w", prefix="checkhen-test-", suffix=".env",
                                         delete=False) as file:
            config_path = Path(file.name)
            os.chmod(config_path, 0o600)
            for key, value in settings.items():
                file.write(f"{key}={value}\n")
        run(sys.executable, str(ROOT / "network/laptop/classroom.py"), "start", str(config_path))
        started = True
        template = (ROOT / "network/proxy/default.conf.template").read_text()
        rendered = subprocess.run(["envsubst", "${AP_ADDRESS} ${AP_HOSTNAME}"],
                                  input=template, text=True, capture_output=True, check=True,
                                  env={**os.environ, "AP_ADDRESS": address,
                                       "AP_HOSTNAME": settings.get("AP_HOSTNAME", "checkhen.rfkill.dev")}).stdout
        server_config = Path("/tmp/checkhen-test-proxy-server.conf")
        main_config = Path("/tmp/checkhen-test-proxy.conf")
        server_config.write_text(rendered)
        main_config.write_text(f"pid /tmp/checkhen-test-nginx.pid; error_log /tmp/checkhen-test-nginx.log; "
                               f"events {{}} http {{ include {server_config}; }}\n")
        run("nginx", "-t", "-c", str(main_config))
        proxy = subprocess.Popen(["nginx", "-c", str(main_config), "-g", "daemon off;"],
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(20):
            try:
                with socket.create_connection((address, 80), timeout=1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Test proxy did not bind AP HTTP port")
        lease_file = "/tmp/checkhen-m2-dhclient.leases"
        pid_file = "/tmp/checkhen-m2-dhclient.pid"
        namespace("dhclient", "-4", "-1", "-v", "-lf", lease_file,
                  "-pf", pid_file, CLIENT_IF)
        namespace("dhclient", "-4", "-1", "-v", "-lf", "/tmp/checkhen-m2-second.leases",
                  "-pf", "/tmp/checkhen-m2-second.pid", SECOND_CLIENT_IF, name=SECOND_NAMESPACE)
        mac = json.loads(namespace("ip", "-j", "link", "show", "dev", CLIENT_IF).stdout)[0]["address"]
        addresses = json.loads(namespace("ip", "-j", "-4", "address", "show", "dev", CLIENT_IF).stdout)
        client_ips = [entry["local"] for entry in addresses[0].get("addr_info", [])]
        if len(client_ips) != 1 or ipaddress.IPv4Address(client_ips[0]) not in subnet:
            raise RuntimeError("DHCP did not configure the client address")
        lease_ip = client_ips[0]
        second_addresses = json.loads(namespace("ip", "-j", "-4", "address", "show", "dev",
                                               SECOND_CLIENT_IF, name=SECOND_NAMESPACE).stdout)
        second_ips = [entry["local"] for entry in second_addresses[0].get("addr_info", [])]
        if len(second_ips) != 1 or second_ips[0] == lease_ip or ipaddress.IPv4Address(second_ips[0]) not in subnet:
            raise RuntimeError("Second client did not receive a distinct AP lease")
        second_ip = second_ips[0]
        second_mac = json.loads(namespace("ip", "-j", "link", "show", "dev", SECOND_CLIENT_IF,
                                          name=SECOND_NAMESPACE).stdout)[0]["address"]
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
        for client in (NAMESPACE, SECOND_NAMESPACE):
            agent_access = namespace("curl", "-4", "--noproxy", "*", "--max-time", "2", "-sS",
                                     f"http://{address}:7878/bind", name=client, check=False)
            if agent_access.returncode == 0:
                raise RuntimeError("An AP client reached the portal agent")
        ipv6 = namespace("ping", "-6", "-c", "1", "-W", "2", "fd77::1", check=False)
        if ipv6.returncode == 0:
            raise RuntimeError("An AP client reached the host over IPv6")
        for label, candidate_ip, timestamp, valid_signature in (
            ("forged signature", lease_ip, int(time.time() * 1000), False),
            ("expired timestamp", lease_ip, 1, True),
            ("missing lease", str(subnet[-2]), int(time.time() * 1000), True),
            ("outside subnet", "192.0.2.20", int(time.time() * 1000), True),
        ):
            invalid_payload = json.dumps({"courseId": "namespace-course", "classId": "namespace-session",
                                          "userId": "namespace-student", "ip": candidate_ip,
                                          "timestamp": timestamp}).encode()
            invalid_signature = hmac.new(secret.encode(), invalid_payload, hashlib.sha256).hexdigest()
            invalid_request = urllib.request.Request(f"http://{address}:7878/bind", invalid_payload,
                                                     {"X-CheckHen-Signature": invalid_signature if valid_signature else "wrong"})
            try:
                urllib.request.urlopen(invalid_request, timeout=5).close()
            except urllib.error.HTTPError as error:
                if error.code != 403:
                    raise RuntimeError(f"{label} returned {error.code}, expected 403") from error
                error.close()
            else:
                raise RuntimeError(f"The agent accepted {label}")
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
        second_payload = json.dumps({"courseId": "namespace-course", "classId": "namespace-session",
                                     "userId": "namespace-student-2", "ip": second_ip,
                                     "timestamp": int(time.time() * 1000)}).encode()
        second_signature = hmac.new(secret.encode(), second_payload, hashlib.sha256).hexdigest()
        second_request = urllib.request.Request(f"http://{address}:7878/bind", second_payload,
                                                {"X-CheckHen-Signature": second_signature})
        with urllib.request.urlopen(second_request, timeout=5) as response:
            second_binding = json.load(response)
        if second_binding != {"ip": second_ip, "mac": second_mac.lower()}:
            raise RuntimeError("Second client binding did not match its lease")
        namespace("curl", "-4", "--noproxy", "*", "--max-time", "12", "-fsSI",
                  "https://example.com")
        namespace("curl", "-4", "--noproxy", "*", "--max-time", "12", "-fsSI",
                  "https://example.com", name=SECOND_NAMESPACE)
        run(sys.executable, str(ROOT / "network/laptop/classroom.py"), "stop")
        started = False
        run(sys.executable, str(ROOT / "network/laptop/classroom.py"), "start", str(config_path))
        started = True
        restarted = namespace("curl", "-4", "--noproxy", "*", "--max-time", "4", "-fsSI",
                              "https://example.com", check=False)
        if restarted.returncode == 0:
            raise RuntimeError("A stale binding survived the second class cycle")
        payload = json.dumps({"courseId": "namespace-course", "classId": "namespace-session",
                              "userId": "namespace-student", "ip": lease_ip,
                              "timestamp": int(time.time() * 1000)}).encode()
        signature = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
        request = urllib.request.Request(f"http://{address}:7878/bind", payload,
                                         {"X-CheckHen-Signature": signature})
        with urllib.request.urlopen(request, timeout=5) as response:
            binding = json.load(response)
        if binding != {"ip": lease_ip, "mac": mac.lower()}:
            raise RuntimeError("Rebinding after restart did not match the lease")
        namespace("curl", "-4", "--noproxy", "*", "--max-time", "12", "-fsSI",
                  "https://example.com")
        print("PASS: two DHCP clients, agent isolation, IPv6 block, signed binds, uplink, and second class cycle")
    finally:
        if proxy:
            proxy.terminate()
            try:
                proxy.wait(timeout=5)
            except subprocess.TimeoutExpired:
                proxy.kill()
                proxy.wait(timeout=5)
        for name in ("/tmp/checkhen-test-proxy.conf", "/tmp/checkhen-test-proxy-server.conf"):
            Path(name).unlink(missing_ok=True)
        if created_namespace:
            namespace("dhclient", "-r", "-pf",
                      "/tmp/checkhen-m2-dhclient.pid", CLIENT_IF, check=False)
        if created_second_namespace:
            namespace("dhclient", "-r", "-pf", "/tmp/checkhen-m2-second.pid",
                      SECOND_CLIENT_IF, name=SECOND_NAMESPACE, check=False)
        if started:
            run(sys.executable, str(ROOT / "network/laptop/classroom.py"), "stop", check=False)
        if created_namespace:
            run("ip", "netns", "delete", NAMESPACE, check=False)
        if created_second_namespace:
            run("ip", "netns", "delete", SECOND_NAMESPACE, check=False)
        if created_veth:
            run("ip", "link", "delete", HOST_VETH, check=False)
            run("ip", "link", "delete", SECOND_HOST_VETH, check=False)
        if created_bridge:
            run("ip", "link", "delete", HOST_IF, check=False)
        if created_namespace:
            (RESOLV / "resolv.conf").unlink(missing_ok=True)
            if RESOLV.exists():
                RESOLV.rmdir()
        if created_second_namespace:
            (SECOND_RESOLV / "resolv.conf").unlink(missing_ok=True)
            if SECOND_RESOLV.exists():
                SECOND_RESOLV.rmdir()
        if config_path:
            config_path.unlink(missing_ok=True)


if __name__ == "__main__":
    try:
        main()
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"M2 namespace check failed: {error}") from error
