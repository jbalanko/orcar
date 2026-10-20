#!/usr/bin/env python3
"""
pbfind -- find Pixelblaze controllers on the local network, fast.

Usage:
    pbfind              list every Pixelblaze found (usually in under a second)
    pbfind -o           ...and open the first one in the browser
    pbfind -q           print bare IPs only (for scripts: open "http://$(pbfind -q)")
    pbfind --sweep      also run the TCP sweep, even if UDP found something
    pbfind --no-sweep   UDP only: never fall back to the sweep
    pbfind -t 2         listen for 2 s instead of 1.2 s

How it works (stdlib only, Python 3.8+, macOS and Linux):

  1. Probe + listen (UDP port 1889). Pixelblaze uses UDP 1889 for discovery
     and time sync: standalone boards and sync leaders broadcast a beacon about
     once a second, and every Pixelblaze -- sync followers included -- answers a
     beacon with a unicast "timeSync" packet within a few ms. pbfind sends one
     beacon out of every network interface (to that subnet's broadcast
     address), then listens. Anything that answers or beacons is a Pixelblaze.
     Harmless: devices only adjust their clocks on timeSync, never on beacons.
     Side effect: a probed board may list this computer as a sync peer for
     about a minute.

  2. TCP sweep fallback (only if step 1 found nothing, or with --sweep).
     Some networks block client-to-client broadcast (guest networks,
     "AP/client isolation", some mesh routers). pbfind then tries a TCP connect
     to ports 80 and 81 on every host of each local /24 -- a Pixelblaze serves
     its web UI on 80 and its websocket on 81. Nothing is sent; each connection
     is closed the moment it opens. Takes about 1-3 s.

No websocket is ever opened, so pbfind can't tie up a board's connection slots.

Troubleshooting:
  - "port 1889 is in use": Firestorm or another pbfind is running. pbfind
    still shares the port where the OS allows it; otherwise it goes straight
    to the sweep.
  - Finds nothing but the board works in a browser: on macOS, check System
    Settings > Privacy & Security > Local Network for your terminal app, and
    allow incoming connections for Python if the firewall asks.
  - Better than finding it every time: reserve the board's address in your
    router's DHCP settings (its hostname starts with "ESP_" or "Espressif").

Run it from anywhere with an alias. Add this line to ~/.zshrc (macOS) or
~/.bashrc (Linux), with the path to wherever your copy of the Orcar repository
is (the folder name doesn't matter), then open a new terminal:
    alias pbfind='python3 ~/path/to/orcar-repository/tools/pbfind.py'
Without the alias, run it from the repository: python3 tools/pbfind.py
See "Finding the boards on the network" in the repository's README.md.
"""

import argparse
import ipaddress
import re
import socket
import struct
import subprocess
import sys
import time
import webbrowser
from concurrent.futures import ThreadPoolExecutor

PORT = 1889
BEACON, TIMESYNC, FOLLOWER_BEACON = 42, 43, 45
VIA = {BEACON: "beacon", TIMESYNC: "probe reply", FOLLOWER_BEACON: "follower beacon"}


def interfaces():
    """[(ip, netmask)] for every non-loopback IPv4 interface, via ifconfig or ip."""
    out = []
    try:  # macOS / BSD (and Linux with net-tools)
        text = subprocess.run(["ifconfig"], capture_output=True, text=True, timeout=3).stdout
        for m in re.finditer(r"inet (?:addr:)?(\d+\.\d+\.\d+\.\d+)\s+(?:netmask|Mask:)\s*(0x[0-9a-fA-F]{8}|\d+\.\d+\.\d+\.\d+)", text):
            ip, mask = m.group(1), m.group(2)
            if mask.startswith("0x"):
                mask = socket.inet_ntoa(struct.pack(">I", int(mask, 16)))
            out.append((ip, mask))
    except (OSError, subprocess.SubprocessError):
        pass
    if not out:
        try:  # modern Linux
            text = subprocess.run(["ip", "-4", "-o", "addr"], capture_output=True, text=True, timeout=3).stdout
            for m in re.finditer(r"inet (\d+\.\d+\.\d+\.\d+)/(\d+)", text):
                net = ipaddress.ip_network(f"{m.group(1)}/{m.group(2)}", strict=False)
                out.append((m.group(1), str(net.netmask)))
        except (OSError, subprocess.SubprocessError):
            pass
    if not out:  # last resort: the default-route address, assumed /24
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(("10.255.255.255", 1))
            out.append((s.getsockname()[0], "255.255.255.0"))
            s.close()
        except OSError:
            pass
    seen, result = set(), []
    for ip, mask in out:
        a = ipaddress.ip_address(ip)
        if a.is_loopback or a.is_link_local or ip in seen:
            continue
        seen.add(ip)
        result.append((ip, mask))
    return result


def udp_discover(ifaces, listen_s):
    """Probe each interface and listen on UDP 1889. Returns {ip: how_found}."""
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    if hasattr(socket, "SO_REUSEPORT"):
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEPORT, 1)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_BROADCAST, 1)
    try:
        s.bind(("", PORT))
    except OSError as e:
        print(f"pbfind: can't listen on UDP {PORT} ({e.strerror}); is Firestorm running? "
              f"Skipping to the TCP sweep.", file=sys.stderr)
        return None

    own = {ip for ip, _ in ifaces}
    sent = set()  # our own probes, which loop back to us
    now = int(time.time() * 1000) & 0xFFFFFFFF
    for ip, mask in ifaces:
        bcast = str(ipaddress.ip_network(f"{ip}/{mask}", strict=False).broadcast_address)
        sender = struct.unpack("<I", socket.inet_aton(ip))[0]
        packet = struct.pack("<III", BEACON, sender, now)
        sent.add(packet)
        for dest in (bcast, "255.255.255.255"):
            try:
                s.sendto(packet, (dest, PORT))
            except OSError:
                pass

    found = {}
    deadline = time.monotonic() + listen_s
    while True:
        left = deadline - time.monotonic()
        if left <= 0:
            break
        s.settimeout(left)
        try:
            data, (src, _) = s.recvfrom(1024)
        except socket.timeout:
            break
        except OSError:
            continue
        if src in own or data in sent or len(data) < 12:
            continue
        kind = struct.unpack_from("<I", data)[0]
        if kind in VIA and src not in found:
            found[src] = VIA[kind]
    s.close()
    return found


def port_open(ip, port, timeout):
    c = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    c.settimeout(timeout)
    try:
        return c.connect_ex((ip, port)) == 0
    except OSError:
        return False
    finally:
        c.close()


def tcp_sweep(ifaces, timeout=0.6):
    """Connect to 81 then 80 on every host of each local /24. Returns {ip: how_found}."""
    own = {ip for ip, _ in ifaces}
    hosts = []
    for ip, mask in ifaces:
        net = ipaddress.ip_network(f"{ip}/{mask}", strict=False)
        if net.prefixlen < 24:  # never blind-scan more than a /24
            net = ipaddress.ip_network(f"{ip}/24", strict=False)
        hosts += [str(h) for h in net.hosts() if str(h) not in own]

    def check(h):
        if port_open(h, 81, timeout) and port_open(h, 80, timeout):
            return h
        return None

    with ThreadPoolExecutor(max_workers=128) as pool:
        return {h: "TCP sweep" for h in pool.map(check, hosts) if h}


def main():
    ap = argparse.ArgumentParser(prog="pbfind", description="Find Pixelblaze controllers on the local network.")
    ap.add_argument("-o", "--open", action="store_true", help="open the first one found in the browser")
    ap.add_argument("-q", "--quiet", action="store_true", help="print bare IPs only")
    ap.add_argument("-t", "--time", type=float, default=1.2, help="seconds to listen for UDP replies (default 1.2)")
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--sweep", action="store_true", help="always run the TCP sweep too")
    g.add_argument("--no-sweep", action="store_true", help="never run the TCP sweep")
    args = ap.parse_args()

    ifaces = interfaces()
    if not ifaces:
        print("pbfind: no network interfaces with an IPv4 address.", file=sys.stderr)
        return 2

    started = time.monotonic()
    found = udp_discover(ifaces, args.time) or {}
    if args.sweep or (not found and not args.no_sweep):
        if not args.quiet and not found:
            print("No UDP replies; sweeping the local subnet...", file=sys.stderr)
        for ip, how in tcp_sweep(ifaces).items():
            found.setdefault(ip, how)
    elapsed = time.monotonic() - started

    if not found:
        if not args.quiet:
            nets = ", ".join(f"{ip}/{mask}" for ip, mask in ifaces)
            print(f"No Pixelblaze found ({elapsed:.1f} s; searched {nets}).", file=sys.stderr)
        return 1

    ips = sorted(found, key=lambda a: ipaddress.ip_address(a))
    if args.quiet:
        print("\n".join(ips))
    else:
        for ip in ips:
            print(f"http://{ip:<16}  ({found[ip]})")
        print(f"{len(ips)} found in {elapsed:.1f} s", file=sys.stderr)
    if args.open:
        webbrowser.open(f"http://{ips[0]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
