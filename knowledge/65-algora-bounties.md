# Algora and GitHub Bounty Worker

Algora is a GitHub-integrated USD bounty platform. It is not a USDT-to-server-wallet rail. Public product copy and the open-source implementation use Stripe Connect payouts to eligible bank accounts. The bounty template says payment is received 2-5 days after reward, while current pricing copy says payouts typically take 2-7 days. A merged pull request is not payment; only verified settled payout evidence counts as revenue.

Algora's published Terms of Service prohibit robots, spiders or other automatic processes from accessing or monitoring the Algora service without prior written consent. Therefore OSA must not scrape algora.io. Discovery uses GitHub's supported API and the official `algora-pbc[bot]` issue comments. GitHub issue state is authoritative because Algora board pages can retain stale entries after an issue closes.

The contribution flow is: verify an open GitHub issue and current bot-authored bounty template, understand repository contribution rules, implement a distinct solution, add tests and a short demo video when required, then open a pull request containing `/claim #ISSUE_NUMBER`. Algora indicates 100% of the reward goes to the contributor, subject to payout eligibility and reward approval.

The discovery worker fails closed. It rejects closed/stale/crowded/low-value issues, inactive or low-reputation repositories, unsupported languages, and sensitive scopes involving credentials, authentication, payments, wallets, exploits or KYC. OSA Brain advice is untrusted advisory analysis and cannot override deterministic eligibility rules. The worker does not execute repository code, submit comments or pull requests, connect Stripe, accept terms, complete KYC, or move money.

Full automated contribution needs additional verified gates: a GitHub credential authorized for forks and pull requests, a payout-eligible Algora developer account with Stripe onboarding completed by the owner, a sandboxed code agent strong enough to produce patches, repository tests passing in isolation, a compliant demo artifact, and rate/reputation limits. Never use an expired `gh` session or the OSA deploy key for third-party repositories.
