# Get started

fluent-mediabunny is not on npm. Build it from source with Node 24 and pnpm 12.14.0, install the tarball with `mediabunny@1.62.1`, then run one conversion, one thumbnail, and one embedded-picture read.

## Build from source

Node 24 is pinned in `.node-version` as 24.11.1. The package manager is pnpm 12.14.0.

```sh
git clone https://github.com/Yukiniro/fluent-mediabunny.git
cd fluent-mediabunny
pnpm install --frozen-lockfile
pnpm build
pnpm pack
```

`pnpm pack` writes `fluent-mediabunny-0.2.0.tgz` in the repository directory.

## Install the tarball

From your application directory, install that tarball and the peer dependency.

```sh
pnpm add /path/to/fluent-mediabunny-0.2.0.tgz mediabunny@1.62.1
```

Replace the tarball path with the file `pnpm pack` wrote. The application needs a browser bundler.

## Convert a clip

`file` is a browser `File` long enough to cover seconds 2 to 12.

```ts
import { media } from "fluent-mediabunny";

const result = await media(file)
  .format("webm")
  .trim({ start: 2, end: 12 })
  .resize({ width: 1280 })
  .run();

const previewUrl = URL.createObjectURL(result.blob);
```

Call `URL.revokeObjectURL(previewUrl)` when the preview is no longer on screen. [Convert a file](/guide/convert) covers formats, tracks, and file output.

## Extract one thumbnail

```ts
import { thumbnail } from "fluent-mediabunny";

const poster = await thumbnail(file, { time: 2, width: 640 });
if (poster) {
  const imageUrl = URL.createObjectURL(poster.blob);
}
```

`thumbnail` returns `null` when no frame covers that time. Revoke `imageUrl` when the image is gone. [Extract thumbnails](/guide/thumbnails) covers batches.

## Read an embedded picture

```ts
import { getEmbeddedPicture } from "fluent-mediabunny";

const picture = await getEmbeddedPicture(file);
if (picture) {
  const imageUrl = URL.createObjectURL(new Blob([picture]));
}
```

`null` means none of the embedded pictures is a JPEG, PNG, GIF, WebP, or BMP. Revoke `imageUrl` when the image is gone. [getEmbeddedPicture](/api/embedded-picture) covers selection and errors.
