# OSA Autonomous Bounty Hunter

Production-oriented Ubuntu daemon for discovering Algora/GitHub bounties, preparing AI-generated candidate patches in isolated workspaces, running allow-listed tests inside Bubblewrap, and keeping any external claim or financial action behind a separate human/control-plane gate.

## Security model

- GitHub/Algora discovery and candidate patch preparation are autonomous.
- Candidate preparation works with OpenAI or the OSA AI router (including Gemini); it is not coupled to one provider key.
- `AUTO_ATTEMPT=false` is the default. A tested candidate is prepared first and the external `/attempt` remains human-gated. Explicitly enabling it additionally requires authenticated GitHub access.
- Repository test commands are allow-listed and run with network disabled in Bubblewrap.
- Financial transactions are **never** signed or broadcast by this service. It may create a short-lived proposal, but approval/execution belongs to the centralized Supabase control path and systemd forces broadcast off.
- If native POL falls below the emergency floor, the engine refuses the swap because a swap cannot bootstrap its own gas.
- `.env` is not committed. Production secrets live in `/etc/osa-bounty-hunter.env` mode `0600`.

## Install

```bash
cd /opt/osa/gitops/OSA
git pull --ff-only origin main
sudo bash ops/install-bounty-hunter.sh
sudoedit /etc/osa-bounty-hunter.env
sudo systemctl restart osa-bounty-hunter.service
sudo systemctl status osa-bounty-hunter.service --no-pager
sudo journalctl -u osa-bounty-hunter.service -f
```

## Required production secrets

Set these in `/etc/osa-bounty-hunter.env` only:

- `GITHUB_TOKEN`: optional while `AUTO_ATTEMPT=false`; required with Issues write permission only for explicitly enabled `/attempt` comments.
- `OPENAI_API_KEY`: optional when the OSA AI router/Gemini is configured; either path can score and prepare candidates.
- `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID`: optional but recommended.
- `PRIVATE_KEY`: optional signer; leave blank for monitor/proposal-only mode. Never paste a seed phrase.
- `WALLET_ADDRESS`: signer wallet address; if `PRIVATE_KEY` is present the program verifies they match.
- `COLD_WALLET_ADDRESS`: destination for approved USDT sweep proposals.
- `POLYGON_RPC`: production Polygon RPC endpoint.

## Commands

```bash
# One discovery + finance-proposal cycle
sudo -u osa-bounty env -i \
  PATH=/opt/osa-bounty-hunter/.venv/bin:/usr/bin:/bin \
  /opt/osa-bounty-hunter/.venv/bin/python /opt/osa-bounty-hunter/bounty_hunter.py once

# Safe configuration and balance diagnostic (no signing)
sudo systemctl restart osa-bounty-hunter.service
sudo journalctl -u osa-bounty-hunter.service -n 100 --no-pager

# Disable
sudo systemctl disable --now osa-bounty-hunter.service
```

Note: the direct `sudo -u ... once` example intentionally starts with an empty environment and is primarily for code-path smoke testing. For a real one-shot run with the production environment, use `systemctl restart` or a root shell that securely imports `/etc/osa-bounty-hunter.env` without echoing it.
