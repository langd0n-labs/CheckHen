#!/usr/bin/env python3
"""Manage the host AP from the privileged, host-network Podman container."""
import ipaddress
import json
import os
from pathlib import Path
import pwd
import re
import shutil
import signal
import socket
import subprocess
import sys
import time

from settings import read_env


STATE = Path("/run/checkhen")
STATE_FILE = STATE / "state.json"
IFACE = re.compile(r"^[a-zA-Z0-9_.-]{1,15}$")
HOST = re.compile(r"^[a-z0-9.-]+$")
RESERVED = [ipaddress.IPv4Network("10.0.0.0/8"),
            ipaddress.IPv4Network("172.17.0.0/16"),
            ipaddress.IPv4Network("172.16.100.0/24")]
RESERVED.extend(ipaddress.IPv4Network(f"172.{second}.0.0/16")
                for second in range(18, 32))


def run(*args: str, input_text: str | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(args, input=input_text, text=True, check=True,
                          capture_output=True)


def validate(settings: dict[str, str]) -> tuple[ipaddress.IPv4Network, ipaddress.IPv4Address]:
    subnet = ipaddress.IPv4Network(settings.get("AP_SUBNET", "172.16.77.0/24"), strict=True)
    address = ipaddress.IPv4Address(settings.get("AP_ADDRESS", "172.16.77.1"))
    if subnet.prefixlen != 24 or address not in subnet.hosts():
        raise ValueError("AP_SUBNET must be a /24 and AP_ADDRESS must be a usable address in it")
    if any(subnet.overlaps(block) for block in RESERVED):
        raise ValueError("AP subnet overlaps a reserved campus, container, or VPN network")
    for name in ("AP_INTERFACE", "UPLINK_INTERFACE"):
        if not IFACE.fullmatch(settings.get(name, "")):
            raise ValueError(f"Set a valid {name} in .env")
        run("ip", "link", "show", "dev", settings[name])
    if settings["AP_INTERFACE"] == settings["UPLINK_INTERFACE"]:
        raise ValueError("The AP and uplink need different interfaces")
    if not HOST.fullmatch(settings.get("AP_HOSTNAME", "checkhen.rfkill.dev")):
        raise ValueError("Invalid AP_HOSTNAME")
    if settings.get("AP_TEST_MODE") != "1":
        if not 1 <= len(settings.get("AP_SSID", "")) <= 32:
            raise ValueError("Set AP_SSID (1-32 characters)")
        if not 8 <= len(settings.get("AP_PASSPHRASE", "")) <= 63:
            raise ValueError("Set AP_PASSPHRASE (8-63 characters)")
    if len(settings.get("PORTAL_CONTROL_SECRET", "")) < 32:
        raise ValueError("PORTAL_CONTROL_SECRET is missing")
    if settings.get("APP_BIND_ADDRESS", "127.0.0.1") != "127.0.0.1":
        raise ValueError("The app port must bind to loopback behind the TLS proxy")
    hostname = settings.get("AP_HOSTNAME", "checkhen.rfkill.dev")
    if settings.get("NEXTAUTH_URL") != f"https://{hostname}":
        raise ValueError("NEXTAUTH_URL must use the AP HTTPS hostname")
    programs = ["ip", "nft", "dnsmasq"]
    if settings.get("AP_TEST_MODE") != "1":
        programs.extend(["hostapd", "nmcli"])
    for program in programs:
        if not shutil.which(program):
            raise ValueError(f"Network image is missing {program}")
    return subnet, address


def conflicting_routes(subnet: ipaddress.IPv4Network) -> list[str]:
    routes = json.loads(run("ip", "-j", "-4", "route", "show", "table", "all").stdout)
    conflicts: list[str] = []
    for route in routes:
        destination = route.get("dst", "default")
        if destination == "default":
            continue
        other = ipaddress.IPv4Network(destination, strict=False)
        if subnet.overlaps(other):
            conflicts.append(f"{destination} on {route.get('dev', 'unknown interface')}")
    return conflicts


def domains(settings: dict[str, str]) -> list[str]:
    names = [name.strip().lower() for name in settings.get("PREAUTH_DOMAINS", "").split(",")]
    names = [name for name in names if name]
    if any(not HOST.fullmatch(name) for name in names):
        raise ValueError("PREAUTH_DOMAINS contains an invalid DNS name")
    return list(dict.fromkeys(names))


def write_configs(settings: dict[str, str], subnet: ipaddress.IPv4Network,
                  address: ipaddress.IPv4Address) -> None:
    ap = settings["AP_INTERFACE"]
    uplink = settings["UPLINK_INTERFACE"]
    ip = str(address)
    domain_names = domains(settings)
    discovery = settings.get("PREAUTH_DISCOVERY", "0") == "1"
    redirect = (
        f'    iifname "{ap}" ip saddr . ether saddr @authorized4 return\n'
        f'    iifname "{ap}" tcp dport 80 dnat to {ip}\n')
    open_rule = f'    iifname "{ap}" oifname "{uplink}" tcp dport {{ 80, 443 }} accept\n' if discovery else ""
    (STATE / "firewall.nft").write_text(f'''table ip checkhen {{
  set authorized4 {{ type ipv4_addr . ether_addr; }}
  set preauth4 {{ type ipv4_addr; flags timeout; timeout 5m; }}
  set private4 {{ type ipv4_addr; flags interval; elements = {{ 0.0.0.0/8, 10.0.0.0/8, 100.64.0.0/10, 127.0.0.0/8, 169.254.0.0/16, 172.16.0.0/12, 192.168.0.0/16, 224.0.0.0/4, 240.0.0.0/4 }}; }}
  chain input {{
    type filter hook input priority -5; policy accept;
    iifname "{ap}" udp dport 67 accept
    iifname "{ap}" ip daddr {ip} udp dport 53 accept
    iifname "{ap}" ip daddr {ip} tcp dport {{ 53, 80, 443 }} accept
    iifname "{ap}" drop
  }}
  chain forward {{
    type filter hook forward priority -5; policy accept;
    oifname "{ap}" ct state established,related accept
    iifname "{ap}" ip daddr @private4 drop
    iifname "{ap}" ip saddr . ether saddr @authorized4 oifname "{uplink}" accept
{open_rule}    iifname "{ap}" ip daddr @preauth4 oifname "{uplink}" tcp dport 443 accept
    iifname "{ap}" drop
  }}
  chain prerouting {{
    type nat hook prerouting priority dstnat; policy accept;
{redirect}  }}
  chain postrouting {{
    type nat hook postrouting priority srcnat; policy accept;
    oifname "{uplink}" ip saddr {subnet} masquerade
  }}
}}
table ip6 checkhen6 {{
  chain input {{ type filter hook input priority -5; policy accept; iifname "{ap}" drop; }}
  chain forward {{ type filter hook forward priority -5; policy accept; iifname "{ap}" drop; }}
}}
''')
    hostapd = f'''interface={ap}
driver=nl80211
ssid={settings["AP_SSID"]}
hw_mode={settings.get("AP_HW_MODE", "g")}
channel={settings.get("AP_CHANNEL", "6")}
country_code={settings.get("AP_COUNTRY_CODE", "US")}
wpa=2
wpa_key_mgmt=WPA-PSK
rsn_pairwise=CCMP
ap_isolate=1
wpa_passphrase={settings["AP_PASSPHRASE"]}
'''
    (STATE / "hostapd.conf").write_text(hostapd)
    hosts = [host for host in subnet.hosts() if host != address]
    ranges: list[tuple[ipaddress.IPv4Address, ipaddress.IPv4Address]] = []
    start = previous = hosts[0]
    for host_address in hosts[1:]:
        if int(host_address) != int(previous) + 1:
            ranges.append((start, previous))
            start = host_address
        previous = host_address
    ranges.append((start, previous))
    dns = [f"interface={ap}", "bind-interfaces", f"listen-address={ip}",
           f"dhcp-option=option:router,{ip}", f"dhcp-option=option:dns-server,{ip}",
           f"dhcp-leasefile={STATE / 'dnsmasq/leases'}", "no-resolv",
           "server=1.1.1.1", "server=9.9.9.9", "log-queries",
           f"log-facility={STATE / 'dnsmasq/query.log'}",
           f"address=/{settings.get('AP_HOSTNAME', 'checkhen.rfkill.dev')}/{ip}",
           f"local=/{settings.get('AP_HOSTNAME', 'checkhen.rfkill.dev')}/"]
    dns.extend(f"dhcp-range={first},{last},12h" for first, last in ranges)
    dns.extend(f"nftset=/{name}/4#ip#checkhen#preauth4" for name in domain_names)
    (STATE / "dnsmasq.conf").write_text("\n".join(dns) + "\n")


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state))
    STATE_FILE.chmod(0o600)


def spawn(state: dict, name: str, args: list[str]) -> None:
    with (STATE / f"{name}.log").open("ab") as output:
        child = subprocess.Popen(args, stdout=output, stderr=subprocess.STDOUT)
    state["processes"][name] = child.pid
    save_state(state)
    time.sleep(0.3)
    if child.poll() is not None:
        raise RuntimeError(f"{name} failed to start; inspect {STATE / (name + '.log')}")


def start(config_path: Path | None = None) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("Start the network layer in a rootful container")
    if STATE_FILE.exists():
        raise RuntimeError("Class mode already started; stop it before restarting")
    settings = read_env(config_path)
    subnet, address = validate(settings)
    conflicts = conflicting_routes(subnet)
    if conflicts:
        raise RuntimeError("AP subnet overlaps an existing host route: " + ", ".join(conflicts))
    if subprocess.run(["nft", "list", "table", "ip", "checkhen"], capture_output=True).returncode == 0:
        raise RuntimeError("An unmanaged CheckHen nftables table already exists")
    if subprocess.run(["nft", "list", "table", "ip6", "checkhen6"], capture_output=True).returncode == 0:
        raise RuntimeError("An unmanaged CheckHen IPv6 nftables table already exists")
    STATE.mkdir(mode=0o711, exist_ok=True)
    os.chmod(STATE, 0o711)
    # A new class starts with an empty authorized set, even if the old lease persists.
    (STATE / "bindings.json").unlink(missing_ok=True)
    dns_user = pwd.getpwnam("dnsmasq")
    dns_dir = STATE / "dnsmasq"
    dns_dir.mkdir(mode=0o700, exist_ok=True)
    os.chown(dns_dir, dns_user.pw_uid, dns_user.pw_gid)
    os.chmod(dns_dir, 0o700)
    write_configs(settings, subnet, address)
    (STATE / "hostapd.conf").chmod(0o600)
    run("dnsmasq", "--test", f"--conf-file={STATE / 'dnsmasq.conf'}")
    run("nft", "-c", "-f", str(STATE / "firewall.nft"))
    test_mode = settings.get("AP_TEST_MODE") == "1"
    firewalld = shutil.which("firewall-cmd") is not None and subprocess.run(
        ["firewall-cmd", "--state"], capture_output=True).returncode == 0
    old_zone = subprocess.run(["firewall-cmd", "--get-zone-of-interface", settings["AP_INTERFACE"]],
                              text=True, capture_output=True).stdout.strip() if firewalld else ""
    if old_zone == "no zone":
        old_zone = ""
    state = {"ap": settings["AP_INTERFACE"], "address": str(address), "subnet": str(subnet),
             "managed": "test" if test_mode else run("nmcli", "-g", "GENERAL.NM-MANAGED", "device", "show",
                                                        settings["AP_INTERFACE"]).stdout.strip(),
             "link_up": "UP" in json.loads(run("ip", "-j", "link", "show", "dev",
                                                 settings["AP_INTERFACE"]).stdout)[0]["flags"],
             "forward": Path("/proc/sys/net/ipv4/ip_forward").read_text().strip(),
             "processes": {}, "pid_namespace": os.stat("/proc/self/ns/pid").st_ino,
             "firewall": False, "address_added": False,
             "firewalld": firewalld, "old_zone": old_zone, "zone_changed": False}
    save_state(state)
    try:
        if not test_mode:
            run("nmcli", "device", "set", state["ap"], "managed", "no")
        run("ip", "address", "add", f"{address}/{subnet.prefixlen}", "dev", state["ap"])
        state["address_added"] = True
        save_state(state)
        run("ip", "link", "set", state["ap"], "up")
        run("nft", "-f", str(STATE / "firewall.nft"))
        state["firewall"] = True
        save_state(state)
        if firewalld:
            run("firewall-cmd", "--zone=trusted", "--change-interface", state["ap"])
            state["zone_changed"] = True
            save_state(state)
        Path("/proc/sys/net/ipv4/ip_forward").write_text("1\n")
        spawn(state, "dnsmasq", ["dnsmasq", "--no-daemon", f"--conf-file={STATE / 'dnsmasq.conf'}"])
        seeded: set[str] = set()
        for name in domains(settings):
            for family, _, _, _, address_info in socket.getaddrinfo(name, 443, socket.AF_INET):
                if family == socket.AF_INET:
                    value = str(ipaddress.IPv4Address(address_info[0]))
                    if value not in seeded:
                        run("nft", "add", "element", "ip", "checkhen", "preauth4", "{", value, "}")
                        seeded.add(value)
        agent_args = [sys.executable, str(Path(__file__).with_name("agent.py"))]
        if config_path:
            agent_args.append(str(config_path))
        spawn(state, "agent", agent_args)
        if not test_mode:
            spawn(state, "hostapd", ["hostapd", str(STATE / "hostapd.conf")])
        print(f"Class mode started on {state['ap']} ({address}/{subnet.prefixlen})")
    except Exception:
        stop()
        raise


def stop() -> None:
    if os.geteuid() != 0:
        raise RuntimeError("Stop the network layer in a rootful container")
    if not STATE_FILE.exists():
        print("Class mode is not running")
        return
    state = json.loads(STATE_FILE.read_text())
    errors: list[str] = []
    def restore(label: str, *command: str) -> None:
        try:
            run(*command)
        except (OSError, subprocess.CalledProcessError):
            errors.append(label)
    same_pid_namespace = state.get("pid_namespace") == os.stat("/proc/self/ns/pid").st_ino
    for name in ("hostapd", "agent", "dnsmasq"):
        if not same_pid_namespace:
            break
        pid = state["processes"].get(name)
        if not pid:
            continue
        command_line = Path(f"/proc/{pid}/cmdline")
        if command_line.exists() and (name.encode() in command_line.read_bytes()):
            try:
                os.kill(pid, signal.SIGTERM)
            except ProcessLookupError:
                pass
    time.sleep(1)
    for name, pid in state["processes"].items():
        if not same_pid_namespace:
            break
        command_line = Path(f"/proc/{pid}/cmdline")
        if command_line.exists() and name.encode() in command_line.read_bytes():
            try:
                os.kill(pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
    if state.get("firewall"):
        restore("nftables", "nft", "delete", "table", "ip", "checkhen")
        restore("IPv6 nftables", "nft", "delete", "table", "ip6", "checkhen6")
    if state.get("zone_changed"):
        restore("firewalld trusted zone", "firewall-cmd", "--zone=trusted", "--remove-interface", state["ap"])
        if state.get("old_zone"):
            restore("original firewalld zone", "firewall-cmd", f"--zone={state['old_zone']}",
                    "--add-interface", state["ap"])
    if state.get("address_added"):
        restore("AP address", "ip", "address", "delete",
                f"{state['address']}/{ipaddress.IPv4Network(state['subnet']).prefixlen}", "dev", state["ap"])
    try:
        Path("/proc/sys/net/ipv4/ip_forward").write_text(state["forward"] + "\n")
    except OSError:
        errors.append("IP forwarding")
    if not state.get("link_up"):
        restore("AP link", "ip", "link", "set", state["ap"], "down")
    if state.get("managed", "").lower() in {"yes", "true"}:
        restore("NetworkManager", "nmcli", "device", "set", state["ap"], "managed", "yes")
    if errors:
        raise RuntimeError("Could not restore: " + ", ".join(errors) + "; retry stop")
    STATE_FILE.unlink()
    print("Class mode stopped; the saved host network settings were restored")


def serve(config_path: Path | None = None) -> None:
    stopping = False

    def request_stop(_number: int, _frame: object) -> None:
        nonlocal stopping
        stopping = True

    signal.signal(signal.SIGTERM, request_stop)
    signal.signal(signal.SIGINT, request_stop)
    start(config_path)
    try:
        while not stopping:
            for name, pid in json.loads(STATE_FILE.read_text())["processes"].items():
                if not Path(f"/proc/{pid}").exists():
                    raise RuntimeError(f"{name} exited; stopping class mode")
            time.sleep(1)
    finally:
        stop()


def main() -> None:
    if len(sys.argv) not in {2, 3} or sys.argv[1] not in {"start", "stop", "check", "serve"}:
        raise SystemExit("Usage: classroom.py start|stop|check|serve [config-file]")
    config_path = Path(sys.argv[2]) if len(sys.argv) == 3 else None
    try:
        if sys.argv[1] == "start":
            start(config_path)
        elif sys.argv[1] == "serve":
            serve(config_path)
        elif sys.argv[1] == "stop":
            stop()
        else:
            subnet, address = validate(read_env(config_path))
            conflicts = conflicting_routes(subnet)
            if conflicts:
                raise RuntimeError("AP subnet overlaps an existing host route: " + ", ".join(conflicts))
            print(f"AP {address}/{subnet.prefixlen}; no conflicting host routes")
    except (OSError, ValueError, RuntimeError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"CheckHen network: {error}") from error


if __name__ == "__main__":
    main()
