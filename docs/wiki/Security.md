# Security

## Is this safe?

It runs a shell, so the question is a fair one. The short version:

- The server binds `127.0.0.1` only, never `0.0.0.0`.
- Every launch mints a random 192-bit token, held in memory and printed once.
  Without it the socket returns 403.
- That token matters more than it looks: **localhost WebSockets aren't
  protected by CORS**, so without it any page you happened to visit could open
  a socket to your shell. Loopback is not an access boundary — every process
  and every user on the machine can reach that port.
- Everything else the server hands out is gated on the same token: your shell
  history for the stats page (counted server-side, only the aggregate sent),
  the list of installed fonts, and the configuration it's running with.

Longer version, including what it deliberately does *not* protect against, in
[What the token doesn't cover](#what-the-token-doesnt-cover) below.

## What the token doesn't cover

Everything above about the token, plus what it doesn't cover:

- The token lives in the URL, which is the leakiest place for a secret —
  browser history, anything that logs URLs, and a shell history if you `open`
  it from a terminal. Redirecting the server's stdout to a file stores a live
  one.
- It defends against *other web pages*. It does not defend against code already
  running as your user, and nothing in this design could.
- Since the session persists, a leaked token doesn't get a fresh shell — it
  reattaches to yours, with your cwd and your running jobs.
- The comparison is `===`, not constant-time. Against a 192-bit random token
  over loopback that isn't a practical attack, but it is a free habit and
  `crypto.timingSafeEqual` would be the right call in anything shared.
- `ws://`, not `wss://`. Irrelevant on loopback; it matters the moment you
  tunnel it, which is why the [FAQ](FAQ.md) says `ssh -L` rather than binding
  `0.0.0.0`.

Found something worse? Open an issue, or mail the address on the GitHub
profile if you'd rather not do it in public.
