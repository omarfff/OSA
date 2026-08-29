# OSA Browser Runtime
OSA uses a persistent Chrome profile per site and verified post-conditions before login/account state is treated as real.
- Profiles preserve normal browser session state.
- Saved state is encrypted at rest.
- Navigation is restricted by the site registry.
- Verification, identity, security and binding-consent screens are explicit gates.
- A click or form submission is never proof of authentication.
- Each site starts with authentication evidence unconfigured until verified runtime evidence is captured.
- Runtime evidence overrides model inference.
