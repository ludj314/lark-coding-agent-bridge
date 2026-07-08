# Callback Choice Cards Design

## Goal

Let agents ask small fixed-choice questions with real interactive CardKit buttons without changing `lark-cli`. The bridge signs callback tokens in the main process, sends the card, forwards the click back to the active agent run, and updates the original card to show the selected choice with buttons disabled/replaced.

## Chosen Approach

Use a bridge-owned local IPC socket plus a bridge CLI client:

```bash
lark-channel-bridge card send \
  --chat-id <oc_xxx> \
  --scope <scope> \
  --title "选一个方案" \
  --choice do:开工做 \
  --choice later:先记着 \
  --choice skip:不做
```

The CLI connects to the running bridge profile's local socket. The bridge main process owns the active run registry and callback signing key, so it signs tokens and sends the card directly through the existing channel instance.

## Behavior

- The helper only works while a run is active for the requested scope.
- Each button gets `__bridge_cb: true`, a signed `bridge_token`, `choice`, `label`, and optional `action` payload fields.
- The button operator must match the original run actor/open_id, using the existing callback token checks.
- On successful click validation and queue forwarding, the bridge updates the original card to a terminal display showing the selected label and removes clickable buttons.
- Repeated clicks are blocked by the existing nonce replay protection; rejected clicks do not update the card.
- If the IPC server is unavailable, the CLI exits non-zero with a clear JSON error so the agent can fall back to text.

## Non-goals

- Do not modify `lark-cli`.
- Do not auto-convert all textual A/B options into buttons; agents must explicitly call the bridge helper.
- Do not support arbitrary forms in this iteration; only small button choices.

## Testing

- Unit test card construction: signed button values include `__bridge_cb` and `bridge_token`.
- Unit test IPC request handling with a fake active run and fake channel.
- Dispatcher test: valid callback forwards to pending queue and updates original card to selected state; replay/invalid callback does not update.
- CLI registration test: `card send` command is registered and serializes choices.
