# Upload Cairo font ZIP

1. Open the repository and switch to the branch `fix/self-host-cairo-font`.
2. Open the `font-upload` folder.
3. Choose **Add file → Upload files**, then upload one ZIP containing the Cairo `.woff2` files.
4. Commit the upload directly to `fix/self-host-cairo-font`.
5. Open the **Actions** tab and watch **Import Cairo WOFF2 font files**.

The workflow accepts one ZIP up to 25 MB, extracts only files with a valid WOFF2 signature, and places them in `assets/fonts/cairo/`. It removes the temporary ZIP after a successful import. It does not edit `index.html`, `main`, or the live website.

Important: this repository is public. Do not upload private files or credentials. Only upload font files you are entitled to publish.
