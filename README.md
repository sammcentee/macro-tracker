# Macros

A small calorie and macro tracker for iPhone. It is a web app that you add to the Home Screen.

- Log food by weight from a saved-foods list, by barcode, or as a quick total.
- Barcode lookups use [Open Food Facts](https://world.openfoodfacts.org) (ODbL). Check the values against the label.
- Your data stays on the phone. After each change, the app saves a copy to a private GitHub repository that you choose.
- There is no server, no account, and no tracking.

## Backup set-up

1. Make a private repository, for example `macro-tracker-data`.
2. Make a fine-grained personal access token with access to that repository only, and the permission **Contents: Read and write**.
3. In the app, open Settings (⚙). Enter `owner/repository` and the token.

Each change makes one commit to `data.json`, so Git keeps every earlier version.

## Licences

The app code is MIT. `vendor/zxing.min.js` is [ZXing](https://github.com/zxing-js/library) (Apache-2.0, see `vendor/ZXING-LICENSE`).
