#!/usr/bin/env python3
import argparse
import base64
import hashlib
import hmac
import os
import struct
import time

from demo_env import load_demo_env


def totp(secret, timestamp):
    secret = secret.upper().replace(" ", "")
    key = base64.b32decode(secret + "=" * ((-len(secret)) % 8))
    digest = hmac.new(key, struct.pack(">Q", timestamp // 30), hashlib.sha1).digest()
    offset = digest[-1] & 15
    code = struct.unpack(">I", digest[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{code % 1000000:06d}"


if __name__ == "__main__":
    load_demo_env()
    parser = argparse.ArgumentParser(description="Daniel's demo TOTP, six digits, 30 seconds")
    parser.add_argument("--secret", default=os.environ["BETSEE_TOTP_SECRET"])
    parser.add_argument("--at", type=int, default=None)
    args = parser.parse_args()
    print(totp(args.secret, int(time.time()) if args.at is None else args.at))
