# Kimi (Moonshot) in the AI-config form (#2138)

Driven against a real, disposable hadron-server stack built from main (includes #4176, `07d26c82`), signed in through the dev login as a synthetic org admin, not a stub.

- `kimi-light.png`, `kimi-dark.png`: the Add configuration form with Kimi (Moonshot) selected. The model is pre-filled with `kimi-k3` (editable). The endpoint field's placeholder and hint, and the datalist, come from the server: Moonshot (international) `https://api.moonshot.ai/v1` (default) and Moonshot (China) `https://api.moonshot.cn/v1`. The protocol control shows with Chat Completions as the default; there is no tool-calling toggle.
- Test on the unsaved config was refused with "Save this configuration first".
- Save with a synthetic key sent `provider: kimi` and the server accepted it. The saved row shows Kimi (Moonshot) and `kimi-k3`, and no key text appeared on the page. No provider was called.
