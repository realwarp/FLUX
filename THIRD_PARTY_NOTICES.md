# Third-party notices

FLUX is licensed under the MIT License (see the repository `package.json`). It
uses the third-party packages listed below. This inventory was generated from
the installed dependency tree (`bun.lock` / `node_modules`) on 2026-11-07 and is
provided for attribution. When FLUX is distributed, include the applicable
license texts and copyright notices from each package.

> Versions are those resolved by the local lockfile at the time of writing.
> Re-run the inventory after dependency updates.

---

## Direct runtime dependencies

| Package | Version | License | Purpose | Upstream |
|---|---|---|---|---|
| `@opentui/core` | 0.8.3 | MIT | Terminal renderer core | <https://github.com/anomalyco/opentui> |
| `@opentui/react` | 0.8.3 | MIT | React bindings for OpenTUI | <https://github.com/anomalyco/opentui> |
| `react` | 19.3.1 | MIT | UI runtime | <https://react.dev> |
| `zod` | 4.6.7 | MIT | Runtime schema validation | <https://zod.dev> |

### Platform-native renderer

| Package | Version | Declared license | Notes |
|---|---|---|---|
| `@opentui/core-win32-x64` | 0.8.3 | **MIT AND LGPL-2.1-or-later** | Windows x64 native renderer (`opentui.dll`). |

The platform package bundles third-party components and ships separate notice
files alongside the binary. Consult the following files in the installed package
(`node_modules/@opentui/core-win32-x64/` or the equivalent Bun store path):

- `LICENSE` (MIT)
- `LICENSE-FFMPEG` and `FFMPEG-SOURCE.md`
- `LICENSE-GHOSTTY`
- `LICENSE-LCMS2`
- `LICENSE-LIBWEBP`, `AUTHORS-LIBWEBP`, `PATENTS-LIBWEBP`
- `LICENSE-STB`
- `LICENSE-WUFFS`
- `LICENSE-ZLIB`

The declared `MIT AND LGPL-2.1-or-later` combination and those bundled notices
govern the native package. Do not assume the FLUX MIT license covers it. If you
redistribute FLUX with this platform package, preserve all of those files and
comply with the LGPL terms for the LGPL-covered components.

---

## Transitive runtime dependencies

These are pulled in by `@opentui/core`, `@opentui/react`, React or bundling.

| Package | Version | License | Upstream |
|---|---|---|---|
| `bun-ffi-structs` | 0.3.1 | MIT | <https://github.com/anomalyco/opentui> |
| `diff` | 9.0.0 | BSD-3-Clause | <https://github.com/kpdecker/jsdiff> |
| `marked` | 17.0.1 | MIT | <https://github.com/markedjs/marked> |
| `string-width` | 7.2.0 | MIT | <https://github.com/sindresorhus/string-width> |
| `strip-ansi` | 7.2.0 | MIT | <https://github.com/chalk/strip-ansi> |
| `ansi-regex` | 6.5.0 | MIT | <https://github.com/chalk/ansi-regex> |
| `emoji-regex` | 10.6.0 | MIT | <https://github.com/mathiasbynens/emoji-regex> |
| `get-east-asian-width` | 1.7.0 | MIT | <https://github.com/sindresorhus/get-east-asian-width> |
| `web-tree-sitter` | 0.25.10 | MIT | <https://github.com/tree-sitter/tree-sitter> |
| `react-reconciler` | 0.33.0 | MIT | <https://github.com/facebook/react> |
| `react-devtools-core` | 7.0.1 | MIT | <https://github.com/facebook/react> |
| `scheduler` | 0.27.0 | MIT | <https://github.com/facebook/react> |
| `ws` | 8.22.1 | MIT | <https://github.com/websockets/ws> |
| `ws` (nested) | 7.5.13 | MIT | <https://github.com/websockets/ws> |
| `shell-quote` | 1.12.0 | MIT | <https://github.com/ljharb/shell-quote> |

---

## Development-only dependencies

Not part of the runtime bundle.

| Package | Version | License | Upstream |
|---|---|---|---|
| `typescript` | 5.9.3 | Apache-2.0 | <https://www.typescriptlang.org> |
| `@types/bun` | 1.4.4 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| `@types/node` | 26.6.6 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| `@types/react` | 19.3.0 | MIT | <https://github.com/DefinitelyTyped/DefinitelyTyped> |
| `bun-types` | 1.4.4 | MIT | <https://github.com/oven-sh/bun> |
| `undici-types` | 8.9.0 | MIT | <https://github.com/nodejs/undici> |
| `csstype` | 3.2.3 | MIT | <https://github.com/frenic/csstype> |

---

## External tools (not bundled)

FLUX invokes these programs when present. They are installed and licensed
separately by the user; FLUX does not distribute them.

| Tool | Role | License |
|---|---|---|
| Bun | Runtime and test runner | MIT |
| Git | Repository detection and Git tools | GPL-2.0-only |
| ripgrep | Optional fast text search | MIT **or** Unlicense (dual) |
| PowerShell (`powershell.exe`) | Shell on Windows | Provided with Windows; Microsoft terms |
| `/bin/sh` | Shell on POSIX | Part of the host OS |
| SQLite (`bun:sqlite`) | Local persistence engine | Public domain |

Network endpoints you configure (Ollama, LM Studio, LiteLLM, hosted gateways,
etc.) are third-party services with their own terms. FLUX does not bundle or
endorse them.

---

## Standard license texts

### MIT License

```text
MIT License

Copyright (c) the respective package authors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Copyright notices observed in the installed packages include:

- OpenTUI: `Copyright (c) 2025 opentui`
- React / React Reconciler / Scheduler / React DevTools: `Copyright (c) Meta Platforms, Inc. and affiliates.`
- Zod: `Copyright (c) 2025 Colin McDonnell`

Other MIT packages carry their own copyright lines in their `LICENSE` files.

### BSD 3-Clause License (`diff`)

```text
BSD 3-Clause License

Copyright (c) 2009-2015, Kevin Decker <kpdecker@gmail.com>
All rights reserved.

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its
   contributors may be used to endorse or promote products derived from
   this software without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

### Apache License 2.0 (`typescript`)

The full text is available at <https://www.apache.org/licenses/LICENSE-2.0> and
in `node_modules/typescript/LICENSE.txt`.

### LGPL-2.1-or-later components

The Windows native renderer package declares `MIT AND LGPL-2.1-or-later` and
ships separate notices (see above). The LGPL text is available at
<https://www.gnu.org/licenses/old-licenses/lgpl-2.1.html>. Redistributors must
preserve the notices and satisfy the LGPL's relinking/source-offer requirements
for the LGPL-covered components.

---

## Maintaining this file

After changing dependencies:

1. Run `bun install`.
2. Re-list direct and transitive packages and their `license` fields.
3. Update the tables above.
4. If a package's license is not OSI-approved or is missing, resolve it before
   distributing FLUX.
