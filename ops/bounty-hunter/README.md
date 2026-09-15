# OSA Autonomous Bounty Hunter

Production-oriented Ubuntu 22.04 daemon for discovering Algora/GitHub bounties, posting verified `/attempt` comments, preparing AI-generated candidate patches in isolated workspaces, running allow-listed tests inside Bubblewrap, and maintaining an approval-gated Polygon financial pipeline.

## Security model

- GitHub/Algora discovery and candidate patch preparation are autonomous.
- The daemon only auto-posts `/attempt` when the issue is verified as an Algora workflow and passes deterministic secret/prompt-injection guards.
- Repository test commands are allow-listed and run with network disabled in Bubblewrap.
- Financial transactions are **never** signed or broadcast merely because a threshold is met. The daemon creates a short-lived proposal and Telegram notification. A local `approve <proposal-id>` marker is required before signing/broadcasting.
- A gas-refill approval explicitly authorizes the bounded sequence: ERC-20 approval if needed, Uniswap V3 USDT→WPOL swap, then unwrap only the newly received WPOL to native POL.
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

- `GITHUB_TOKEN`: fine-grained token with read access to public repo metadata/content and **Issues: write** for `/attempt` comments.
- `OPENAI_API_KEY`: for scoring and candidate patch generation.
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

# Explicitly approve one fresh financial proposal
sudo -u osa-bounty /opt/osa-bounty-hunter/.venv/bin/python \
  /opt/osa-bounty-hunter/bounty_hunter.py approve <proposal-id>

# Process an approved financial proposal immediately
sudo systemctl restart osa-bounty-hunter.service

# Disable
sudo systemctl disable --now osa-bounty-hunter.service
```

Note: the direct `sudo -u ... once` example intentionally starts with an empty environment and is primarily for code-path smoke testing. For a real one-shot run with the production environment, use `systemctl restart` or a root shell that securely imports `/etc/osa-bounty-hunter.env` without echoing it.
