# Macros

A small calorie and macro tracker for iPhone. It is a web app that you add to the Home Screen.

- Log food by weight (g) or volume (ml) from a saved-foods list, by barcode, or as a quick total.
- Barcode lookups use [Open Food Facts](https://world.openfoodfacts.org) (ODbL). Check the values against the label.
- One-tap presets for foods and meals you eat often, with Undo.
- Export your full history as a CSV file (Settings).
- Sync between devices through a private GitHub repository that you choose. There is no server, no account, and no tracking.

## Sync set-up

1. Make a private repository, for example `macro-tracker-data`.
2. Make a fine-grained personal access token with access to that repository only, and the permission **Contents: Read and write**.
3. On each device, open Settings (⚙). Enter `owner/repository` and the token.

The app syncs when it opens, after each change, and every minute while it is open. Each change makes one commit to `data.json`, so Git keeps every earlier version. If two devices change different things, the app keeps both changes. If two devices change the same entry, the later change wins, by the clocks of the devices. If the file in GitHub is damaged, the app does not change it and shows an error.

## Licences

The app code is MIT. `vendor/zxing.min.js` is [ZXing](https://github.com/zxing-js/library) (Apache-2.0, see `vendor/ZXING-LICENSE`).
