#!/usr/bin/env python3
"""Exercise DHCP, the shared proxy template, lease binding, and NAT."""
import hashlib
import hmac
from http.server import BaseHTTPRequestHandler, HTTPServer
import ipaddress
import json
import os
import signal
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.error
import urllib.request

from settings import ROOT, first_ip_json, ip_json_addresses, read_env


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


def set_accept_ra(interface: str, name: str) -> None:
    namespace("sh", "-c", f"printf 2 > /proc/sys/net/ipv6/conf/{interface}/accept_ra", name=name)


def client_ipv6_route(operation: str, name: str, interface: str, target: str, gateway: str) -> None:
    namespace("ip", "-6", "route", operation, f"{target}/128", "via", gateway, "dev", interface,
              name=name, check=operation != "delete")


def install_client_test_routes(target: str, private_target: str, gateway: str,
                               added: list[tuple[str, str, str]]) -> None:
    routes = ((NAMESPACE, CLIENT_IF, target), (SECOND_NAMESPACE, SECOND_CLIENT_IF, target),
              (SECOND_NAMESPACE, SECOND_CLIENT_IF, private_target))
    for name, interface, destination in routes:
        client_ipv6_route("replace", name, interface, destination, gateway)
        added.append((name, interface, destination))


def ipv6_counter_failure(label: str, name: str, curl: subprocess.CompletedProcess) -> RuntimeError:
    routes = namespace("ip", "-6", "route", name=name, check=False)
    addresses = namespace("ip", "-6", "address", name=name, check=False)
    counters = run("nft", "-a", "list", "chain", "ip6", "checkhen6", "forward", check=False)
    return RuntimeError(
        f"{label} in {name}\n"
        f"client IPv6 routes: {routes.stdout or routes.stderr}\n"
        f"client IPv6 addresses: {addresses.stdout or addresses.stderr}\n"
        f"curl exit {curl.returncode}: {curl.stderr}\n"
        f"ip6 forward counters: {counters.stdout or counters.stderr}")


def ipv6_forward_probe(target: str) -> str:
    # Port 80 is redirected to the local captive portal before the forward hook.
    return f"http://[{target}]:8080"


def signed_agent(address: str, secret: str, action: str, payload: dict) -> dict:
    raw = json.dumps({**payload, "timestamp": int(time.time() * 1000)}).encode()
    signature = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
    request = urllib.request.Request(f"http://{address}:7878/{action}", raw,
                                     {"Content-Type": "application/json", "X-CheckHen-Signature": signature})
    with urllib.request.urlopen(request, timeout=8) as response:
        return json.load(response)


def drop_count(family: str, table: str, set_name: str) -> int:
    rules = json.loads(run("nft", "-j", "list", "chain", family, table, "forward").stdout)["nftables"]
    for item in rules:
        rule = item.get("rule", {})
        if set_name in json.dumps(rule):
            for expression in rule.get("expr", []):
                if "counter" in expression:
                    return expression["counter"]["packets"]
    raise RuntimeError(f"Missing counter for {set_name}")


def ipv6_block_count() -> int:
    rules = json.loads(run("nft", "-j", "list", "chain", "ip6", "checkhen6", "forward").stdout)["nftables"]
    for item in rules:
        expressions = item.get("rule", {}).get("expr", [])
        if any("drop" in expression for expression in expressions) and not any(
                "private6" in json.dumps(expression) for expression in expressions):
            counters = [expression["counter"]["packets"] for expression in expressions if "counter" in expression]
            if counters:
                return counters[0]
    raise RuntimeError("Missing IPv6 forward block counter")


def exam_drop_count(family: str, table: str) -> int:
    rules = json.loads(run("nft", "-j", "list", "chain", family, table, "exam_gate").stdout)["nftables"]
    for item in rules:
        expressions = item.get("rule", {}).get("expr", [])
        if any("drop" in expression for expression in expressions):
            return next(expression["counter"]["packets"] for expression in expressions if "counter" in expression)
    raise RuntimeError("Missing exam drop counter")


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
    settings["UPLINK_INTERFACE"] = first_ip_json(
        run("ip", "-j", "route", "get", "1.1.1.1").stdout, "IPv4 uplink route")["dev"]
    settings["AP_PASSPHRASE"] = "namespace-only"
    secret = settings["PORTAL_CONTROL_SECRET"]
    callback_records: list[dict] = []
    class ExamCallback(BaseHTTPRequestHandler):
        def do_POST(self) -> None:
            raw = self.rfile.read(int(self.headers.get("Content-Length", "0")))
            expected = hmac.new(secret.encode(), raw, hashlib.sha256).hexdigest()
            if self.path != "/exam-failed" or not hmac.compare_digest(
                    self.headers.get("X-CheckHen-Signature", ""), expected):
                self.send_error(403)
                return
            callback_records.append(json.loads(raw))
            self.send_response(200)
            self.end_headers()

        def log_message(self, _format: str, *_args) -> None:
            pass

    callback_server = HTTPServer(("127.0.0.1", 0), ExamCallback)
    callback_thread = threading.Thread(target=callback_server.serve_forever, daemon=True)
    callback_thread.start()
    settings["EXAM_CALLBACK_URL"] = f"http://127.0.0.1:{callback_server.server_port}/exam-failed"
    address = settings.get("AP_ADDRESS", "172.16.77.1")
    address6 = settings.get("AP_IPV6_ADDRESS", "fd9b:2f69:8c44::1")
    prefix6 = ipaddress.IPv6Network(settings.get("AP_IPV6_PREFIX", "fd9b:2f69:8c44::/64"))
    subnet = ipaddress.IPv4Network(settings.get("AP_SUBNET", "172.16.77.0/24"))
    config_path = None
    started = False
    created_namespace = False
    created_second_namespace = False
    created_veth = False
    created_bridge = False
    proxy = None
    restarted_agent = None
    test_ipv6_route_added = False
    private6_route_added = False
    client_routes_added: list[tuple[str, str, str]] = []
    test_ipv6_target = "2606:4700:4700::1111"
    private6_target = "fd00::1"
    uplink_ipv6 = run("ip", "-6", "route", "get", test_ipv6_target, check=False).returncode == 0
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
        run("bridge", "link", "set", "dev", HOST_VETH, "isolated", "on")
        run("ip", "link", "set", HOST_VETH, "up")
        run("ip", "link", "add", SECOND_HOST_VETH, "type", "veth", "peer", "name", SECOND_CLIENT_IF)
        run("ip", "link", "set", SECOND_CLIENT_IF, "netns", SECOND_NAMESPACE)
        run("ip", "link", "set", SECOND_HOST_VETH, "master", HOST_IF)
        run("bridge", "link", "set", "dev", SECOND_HOST_VETH, "isolated", "on")
        run("ip", "link", "set", SECOND_HOST_VETH, "up")
        namespace("ip", "link", "set", "lo", "up")
        namespace("ip", "link", "set", CLIENT_IF, "up")
        namespace("ip", "link", "set", "lo", "up", name=SECOND_NAMESPACE)
        namespace("ip", "link", "set", SECOND_CLIENT_IF, "up", name=SECOND_NAMESPACE)
        set_accept_ra(CLIENT_IF, NAMESPACE)
        set_accept_ra(SECOND_CLIENT_IF, SECOND_NAMESPACE)
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
        if Path("/proc/sys/net/ipv6/conf/all/forwarding").read_text().strip() != "1":
            raise RuntimeError("Class start did not enable IPv6 forwarding")
        if not uplink_ipv6:
            # A narrow route forces packets through the forward hook even when
            # the host has no IPv6 uplink. Clients get narrow routes after SLAAC.
            run("ip", "-6", "route", "add", f"{test_ipv6_target}/128", "dev", settings["UPLINK_INTERFACE"])
            test_ipv6_route_added = True
            run("ip", "-6", "route", "add", f"{private6_target}/128", "dev", settings["UPLINK_INTERFACE"])
            private6_route_added = True
        template = (ROOT / "network/proxy/default.conf.template").read_text()
        rendered = subprocess.run(["envsubst", "${AP_ADDRESS} ${AP_IPV6_ADDRESS} ${AP_HOSTNAME}"],
                                  input=template, text=True, capture_output=True, check=True,
                                  env={**os.environ, "AP_ADDRESS": address, "AP_IPV6_ADDRESS": address6,
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
        mac = first_ip_json(namespace("ip", "-j", "link", "show", "dev", CLIENT_IF).stdout,
                            f"client link {CLIENT_IF}")["address"]
        addresses = ip_json_addresses(namespace("ip", "-j", "-4", "address", "show", "dev", CLIENT_IF).stdout)
        client_ips = [entry["local"] for entry in addresses]
        if len(client_ips) != 1 or ipaddress.IPv4Address(client_ips[0]) not in subnet:
            raise RuntimeError("DHCP did not configure the client address")
        lease_ip = client_ips[0]
        second_addresses = ip_json_addresses(namespace("ip", "-j", "-4", "address", "show", "dev",
                                                       SECOND_CLIENT_IF, name=SECOND_NAMESPACE).stdout)
        second_ips = [entry["local"] for entry in second_addresses]
        if len(second_ips) != 1 or second_ips[0] == lease_ip or ipaddress.IPv4Address(second_ips[0]) not in subnet:
            raise RuntimeError("Second client did not receive a distinct AP lease")
        second_ip = second_ips[0]
        second_mac = first_ip_json(namespace("ip", "-j", "link", "show", "dev", SECOND_CLIENT_IF,
                                             name=SECOND_NAMESPACE).stdout,
                                   f"client link {SECOND_CLIENT_IF}")["address"]
        def slaac(name: str, interface: str) -> str:
            for _ in range(40):
                info = ip_json_addresses(namespace("ip", "-j", "-6", "address", "show", "dev", interface,
                                                    name=name).stdout)
                addresses6 = [entry["local"] for entry in info
                              if ipaddress.IPv6Address(entry["local"]) in prefix6]
                if addresses6:
                    return addresses6[0]
                time.sleep(0.5)
            raise RuntimeError(f"SLAAC did not configure {name}")
        first_ip6 = slaac(NAMESPACE, CLIENT_IF)
        second_ip6 = slaac(SECOND_NAMESPACE, SECOND_CLIENT_IF)
        if test_ipv6_route_added:
            install_client_test_routes(test_ipv6_target, private6_target, address6, client_routes_added)
        for family, peer in (("-4", second_ip), ("-6", second_ip6)):
            direct = namespace("ping", family, "-c", "1", "-W", "2", peer, check=False)
            if direct.returncode == 0:
                raise RuntimeError("Bridge client isolation failed for " + family)
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
        redirect6 = namespace("curl", "-6", "--noproxy", "*", "--max-time", "8", "-ksS",
                              "-o", "/dev/null", "-w", "%{http_code}",
                              f"http://[{test_ipv6_target}]", check=False)
        if redirect6.returncode != 0 or redirect6.stdout != "302":
            raise RuntimeError(f"An unauthenticated IPv6 HTTP request did not reach the captive portal: "
                               f"curl exit {redirect6.returncode}, status {redirect6.stdout}, error {redirect6.stderr}")
        blocked = namespace("curl", "-4", "--noproxy", "*", "--max-time", "4", "-fsSI",
                            "https://example.com", check=False)
        if blocked.returncode == 0:
            raise RuntimeError("An unauthenticated client reached the Internet")
        for client in (NAMESPACE, SECOND_NAMESPACE):
            agent_access = namespace("curl", "-4", "--noproxy", "*", "--max-time", "2", "-sS",
                                     f"http://{address}:7878/bind", name=client, check=False)
            if agent_access.returncode == 0:
                raise RuntimeError("An AP client reached the portal agent")
        ipv6 = namespace("ping", "-6", "-c", "1", "-W", "2", address6, check=False)
        if ipv6.returncode == 0:
            raise RuntimeError("An AP client reached the host over IPv6")
        for name in (NAMESPACE, SECOND_NAMESPACE):
            before6 = ipv6_block_count()
            blocked6 = namespace("curl", "-6", "--noproxy", "*", "--max-time", "3", "-fsSI",
                                 ipv6_forward_probe(test_ipv6_target), name=name, check=False)
            if blocked6.returncode == 0 or ipv6_block_count() <= before6:
                raise ipv6_counter_failure("The IPv6 forward block did not stop the unbound client", name, blocked6)
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
        namespace("curl", "-4", "--noproxy", "*", "--max-time", "12", "-fsSI",
                  "https://example.com")
        for family, name in (("-4", SECOND_NAMESPACE), ("-6", SECOND_NAMESPACE)):
            before6 = ipv6_block_count() if family == "-6" else None
            blocked_second = namespace("curl", family, "--noproxy", "*", "--max-time", "3", "-fsSI",
                                       ipv6_forward_probe(test_ipv6_target) if family == "-6" else
                                       "https://example.com", name=name, check=False)
            if blocked_second.returncode == 0:
                raise RuntimeError("The unbound client gained uplink while another client was bound")
            if before6 is not None and ipv6_block_count() <= before6:
                raise ipv6_counter_failure("The IPv6 forward block did not stop the unbound client", name, blocked_second)
        private_before = drop_count("ip", "checkhen", "private4")
        private = namespace("curl", "-4", "--noproxy", "*", "--max-time", "3", "-fsSI",
                            "http://192.168.1.1:8080", check=False)
        if private.returncode == 0 or drop_count("ip", "checkhen", "private4") <= private_before:
            raise RuntimeError("An authorized client bypassed the private IPv4 block")
        namespace("ip", "link", "set", CLIENT_IF, "down")
        time.sleep(1)
        namespace("ip", "link", "set", CLIENT_IF, "up")
        namespace("ip", "-4", "route", "replace", "default", "via", address, "dev", CLIENT_IF)
        namespace("curl", "-4", "--noproxy", "*", "--max-time", "12", "-fsSI",
                  "https://example.com")
        namespace("ip", "-4", "address", "flush", "dev", SECOND_CLIENT_IF, name=SECOND_NAMESPACE)
        namespace("ip", "-4", "route", "flush", "dev", SECOND_CLIENT_IF, name=SECOND_NAMESPACE)
        second_payload = json.dumps({"courseId": "namespace-course", "classId": "namespace-session",
                                     "userId": "namespace-student-2", "ip": second_ip6,
                                     "timestamp": int(time.time() * 1000)}).encode()
        second_signature = hmac.new(secret.encode(), second_payload, hashlib.sha256).hexdigest()
        second_request = urllib.request.Request(f"http://{address}:7878/bind", second_payload,
                                                {"X-CheckHen-Signature": second_signature})
        with urllib.request.urlopen(second_request, timeout=5) as response:
            second_binding = json.load(response)
        if second_binding != {"ip": second_ip6, "mac": second_mac.lower()}:
            raise RuntimeError("IPv6-only client binding did not match its neighbor MAC")
        if second_mac.lower() not in run("nft", "list", "set", "ip6", "checkhen6", "authorized6").stdout:
            raise RuntimeError("The IPv6-only client's MAC was not authorized")
        authorized6_before = drop_count("ip6", "checkhen6", "authorized6")
        accepted6 = namespace("curl", "-6", "--noproxy", "*", "--max-time", "3", "-fsSI",
                              ipv6_forward_probe(test_ipv6_target), name=SECOND_NAMESPACE, check=False)
        if drop_count("ip6", "checkhen6", "authorized6") <= authorized6_before:
            raise ipv6_counter_failure("The IPv6 forward accept rule did not match the bound client",
                                       SECOND_NAMESPACE, accepted6)
        original_agent = json.loads((STATE / "state.json").read_text())["processes"]["agent"]
        os.kill(original_agent, signal.SIGTERM)
        time.sleep(1)
        bindings_path = STATE / "bindings.json"
        saved_bindings = json.loads(bindings_path.read_text())
        saved_bindings["172.16.77.250"] = {"mac": "02:00:00:00:00:99", "userId": "stale",
                                             "courseId": "namespace-course", "classId": "namespace-session"}
        bindings_path.write_text(json.dumps(saved_bindings))
        restarted_agent = subprocess.Popen([sys.executable, str(ROOT / "network/laptop/agent.py"),
                                            str(config_path)], stdout=subprocess.DEVNULL,
                                           stderr=subprocess.DEVNULL)
        for _ in range(30):
            if restarted_agent.poll() is not None:
                raise RuntimeError("Portal agent failed to restart")
            try:
                with socket.create_connection((address, 7878), timeout=1):
                    break
            except OSError:
                time.sleep(0.1)
        else:
            raise RuntimeError("Restarted portal agent did not listen")
        if "172.16.77.250" in json.loads(bindings_path.read_text()):
            raise RuntimeError("Agent restart retained a stale binding")
        authorized4 = run("nft", "list", "set", "ip", "checkhen", "authorized4").stdout
        if lease_ip not in authorized4 or "172.16.77.250" in authorized4:
            raise RuntimeError("Agent restart did not reconcile the IPv4 nft set")
        if ip_json_addresses(namespace("ip", "-j", "-4", "address", "show", "dev", SECOND_CLIENT_IF,
                                       name=SECOND_NAMESPACE).stdout):
            raise RuntimeError("IPv6-only client still has an IPv4 address")
        private6_before = drop_count("ip6", "checkhen6", "private6")
        private6 = namespace("curl", "-6", "--noproxy", "*", "--max-time", "3", "-fsSI",
                             ipv6_forward_probe(private6_target), name=SECOND_NAMESPACE, check=False)
        if private6.returncode == 0 or drop_count("ip6", "checkhen6", "private6") <= private6_before:
            raise ipv6_counter_failure("An authorized client bypassed the private IPv6 block",
                                       SECOND_NAMESPACE, private6)
        if uplink_ipv6:
            namespace("curl", "-6", "--noproxy", "*", "--max-time", "12", "-fsSI",
                      "https://example.com", name=SECOND_NAMESPACE)
        if test_ipv6_route_added:
            for name, interface, target in client_routes_added:
                if target == test_ipv6_target:
                    client_ipv6_route("delete", name, interface, target, address6)
            run("ip", "-6", "route", "delete", f"{test_ipv6_target}/128", "dev", settings["UPLINK_INTERFACE"])
            test_ipv6_route_added = False
            namespace("curl", "--noproxy", "*", "--max-time", "12", "-fsSI",
                      "https://example.com")
            run("ip", "-6", "route", "add", f"{test_ipv6_target}/128", "dev", settings["UPLINK_INTERFACE"])
            test_ipv6_route_added = True
            for name, interface, target in client_routes_added:
                if target == test_ipv6_target:
                    client_ipv6_route("replace", name, interface, target, address6)
        exam_scope = {"courseId": "namespace-course", "classId": "namespace-session"}
        signed_agent(address, secret, "exam-start", {**exam_scope, "examId": "namespace-exam",
            "domains": ["example.com"], "thresholdSeconds": 30,
            "clients": [{"userId": "namespace-student", "mac": mac.lower()},
                        {"userId": "namespace-student-2", "mac": second_mac.lower()}]})
        server = namespace("curl", "-4", "--noproxy", "*", "--max-time", "3", "-sS",
                           "-o", "/dev/null", f"http://{address}", check=False)
        if server.returncode != 0:
            raise RuntimeError("Exam client could not reach the CheckHen server")
        exam_portal = namespace("getent", "ahostsv4", settings.get("AP_HOSTNAME", "checkhen.rfkill.dev"),
                                check=False)
        if exam_portal.returncode != 0 or address not in exam_portal.stdout:
            raise RuntimeError("Exam DNS did not preserve the CheckHen hostname")
        # The client resolves through the AP's dnsmasq, which adds each answer to the
        # exam set; the gate then admits exactly the addresses clients were given.
        resolved = namespace("getent", "ahostsv4", "example.com", check=False)
        if resolved.returncode != 0:
            raise RuntimeError("Exam DNS did not resolve the allowlisted domain")
        allowed_ip = resolved.stdout.split()[0]
        if allowed_ip not in run("nft", "list", "set", "ip", "checkhen", "exam4").stdout:
            raise RuntimeError("dnsmasq did not add the allowlisted answer to the exam set")
        allowed = namespace("curl", "-4", "--noproxy", "*", "--max-time", "8", "-fsSI",
                            "--resolve", f"example.com:443:{allowed_ip}", "https://example.com", check=False)
        if allowed.returncode != 0:
            raise RuntimeError(f"Exam client could not reach an allowlisted IPv4 endpoint: {allowed.stderr}")
        allowed_by_name = namespace("curl", "-4", "--noproxy", "*", "--max-time", "8", "-fsSI",
                                    "https://example.com", check=False)
        if allowed_by_name.returncode != 0:
            raise RuntimeError(f"Exam client could not reach the allowlisted domain through filtered DNS: "
                               f"{allowed_by_name.stderr}")
        if uplink_ipv6:
            allowed6 = namespace("curl", "-6", "--noproxy", "*", "--max-time", "8", "-fsSI",
                                 "https://example.com", name=SECOND_NAMESPACE, check=False)
            if allowed6.returncode != 0:
                raise RuntimeError(f"IPv6-only exam client could not reach the allowlisted domain: {allowed6.stderr}")
        exam6_before = exam_drop_count("ip6", "checkhen6")
        blocked6 = namespace("curl", "-6", "--noproxy", "*", "--max-time", "3", "-fsSI",
                             ipv6_forward_probe(test_ipv6_target), name=SECOND_NAMESPACE, check=False)
        if blocked6.returncode == 0 or exam_drop_count("ip6", "checkhen6") <= exam6_before:
            raise ipv6_counter_failure("Exam policy did not block an unlisted IPv6 address",
                                       SECOND_NAMESPACE, blocked6)
        for label, target in (("nonallowlisted IP", "9.9.9.9"),
                              ("public DoH resolver", "1.1.1.1"), ("Google range", "8.8.8.8")):
            blocked_exam = namespace("curl", "-4", "--noproxy", "*", "--connect-timeout", "2",
                                     "--max-time", "3", "-kfsSI", f"https://{target}", check=False)
            if blocked_exam.returncode == 0:
                raise RuntimeError(f"Exam client reached {label}")
        # A real domain off the allowlist, so the check fails only because of the filter.
        if namespace("getent", "ahostsv4", "example.org", check=False).returncode == 0:
            raise RuntimeError("Exam DNS resolved a nonallowlisted domain")
        signed_agent(address, secret, "exam-heartbeat", {**exam_scope, "userId": "namespace-student-2",
                                                         "ip": second_ip6})
        signed_agent(address, secret, "exam-heartbeat", {**exam_scope, "userId": "namespace-student",
                                                         "ip": lease_ip})
        heartbeat_at = time.monotonic()
        time.sleep(max(0, 29 - (time.monotonic() - heartbeat_at)))
        before_limit = signed_agent(address, secret, "exam-status", exam_scope)
        student_before = next(item for item in before_limit["clients"] if item["userId"] == "namespace-student")
        if student_before["failed"]:
            raise RuntimeError("Exam disconnected client failed before 30 seconds")
        time.sleep(max(0, 31 - (time.monotonic() - heartbeat_at)))
        after_limit = signed_agent(address, secret, "exam-status", exam_scope)
        student_after = next(item for item in after_limit["clients"] if item["userId"] == "namespace-student")
        if not student_after["failed"]:
            raise RuntimeError("Exam disconnected client did not fail after 30 seconds")
        signed_agent(address, secret, "exam-stop", exam_scope)
        if not any(record.get("userId") == "namespace-student" and
                   record.get("examId") == "namespace-exam" for record in callback_records):
            raise RuntimeError("Exam agent did not report the automatic fail to its signed callback")
        # After the exam: the DNS filter is empty and an address off the allowlist is
        # reachable again (it was blocked during the exam).
        if (STATE / "exam-servers").read_text().strip():
            raise RuntimeError("Exam DNS filter remained after exam-stop")
        if namespace("getent", "ahostsv4", "example.org", check=False).returncode != 0:
            raise RuntimeError("A domain off the allowlist did not resolve after exam-stop")
        reopened = namespace("curl", "-4", "--noproxy", "*", "--connect-timeout", "3", "--max-time", "5",
                             "-ksS", "-o", "/dev/null", "https://9.9.9.9", check=False)
        if reopened.returncode != 0:
            raise RuntimeError(f"An address off the allowlist stayed blocked after exam-stop: {reopened.stderr}")
        revoke_payload = json.dumps({"courseId": "namespace-course", "classId": "namespace-session",
                                     "userId": "namespace-student", "ip": lease_ip,
                                     "timestamp": int(time.time() * 1000)}).encode()
        revoke_signature = hmac.new(secret.encode(), revoke_payload, hashlib.sha256).hexdigest()
        with urllib.request.urlopen(urllib.request.Request(f"http://{address}:7878/revoke", revoke_payload,
                {"X-CheckHen-Signature": revoke_signature}), timeout=5) as response:
            if response.status != 200:
                raise RuntimeError("Agent revoke failed")
        revoked = namespace("curl", "-4", "--noproxy", "*", "--max-time", "4", "-fsSI",
                            "https://example.com", check=False)
        if revoked.returncode == 0:
            raise RuntimeError("A revoked client retained IPv4 uplink")
        if mac.lower() in run("nft", "list", "set", "ip6", "checkhen6", "authorized6").stdout:
            raise RuntimeError("A revoked client retained IPv6 authorization")
        blocked6_before = ipv6_block_count()
        revoked6 = namespace("curl", "-6", "--noproxy", "*", "--max-time", "3", "-fsSI",
                             ipv6_forward_probe(test_ipv6_target), check=False)
        if ipv6_block_count() <= blocked6_before:
            raise ipv6_counter_failure("The IPv6 forward block did not stop the revoked client",
                                       NAMESPACE, revoked6)
        restarted_agent.terminate()
        restarted_agent.wait(timeout=5)
        restarted_agent = None
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
        print("PASS: class-mode dual-stack and IPv6-only isolation, revoke, link flap, and second cycle; "
              "exam allowlist, DNS and DoH blocks, Google block, IPv6 block, and 29/31-second fail threshold")
    finally:
        callback_server.shutdown()
        callback_server.server_close()
        callback_thread.join(timeout=3)
        for name, interface, target in reversed(client_routes_added):
            client_ipv6_route("delete", name, interface, target, address6)
        if test_ipv6_route_added:
            run("ip", "-6", "route", "delete", f"{test_ipv6_target}/128", "dev", settings["UPLINK_INTERFACE"],
                check=False)
        if private6_route_added:
            run("ip", "-6", "route", "delete", f"{private6_target}/128", "dev", settings["UPLINK_INTERFACE"],
                check=False)
        if restarted_agent and restarted_agent.poll() is None:
            restarted_agent.terminate()
            try:
                restarted_agent.wait(timeout=5)
            except subprocess.TimeoutExpired:
                restarted_agent.kill()
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
        raise SystemExit(f"CheckHen namespace check failed: {error}") from error
