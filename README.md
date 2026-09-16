# Shader Studio

A Figma-like canvas for applying WebGPU shaders to images and videos, then exporting the result. Drop media onto an infinite canvas, stack shaders on a frame, tune parameters live, and export a PNG/JPEG/WebP at native resolution or record the processed video.

Built with Next.js (App Router), React, Tailwind CSS, shadcn/ui and [vgpu](https://vgpu.sh) for WebGPU rendering. Everything runs client-side; there is no server component, so it deploys to Vercel as-is.

## Features

- Infinite canvas with pan (Space + drag, wheel, hand tool), zoom (⌘/Ctrl + wheel, pinch, shortcuts), zoom-to-fit and zoom-to-selection.
- Hold **Space** (or toggle the compare button) to see the original media on the canvas. Export still includes the shader stack. Space also pans, as before.
- Hide the UI with Shift+G or the eye button in the toolbar to look at the result alone; panning and zooming keep working, and a small pill brings the UI back.
- Frames: each imported image or video becomes a frame you can select, move, resize (aspect-locked corner handles), rename, reorder, hide and lock. The frame’s width and height are the working pixel resolution shaders run at (the media is sampled up or down into that grid); on-canvas zoom only changes how large that buffer looks. Import by dropping files on the canvas, pasting an image (⌘/Ctrl+V — screenshots and copied bitmaps included), or the Import button (⌘/Ctrl+I).
- Shader stack: each frame has an ordered list of shaders (up to 16). The first visible layer reads the media; each next layer reads the previous output. Nested under the frame in the layers panel, like Figma. Copy a stack as JSON with ⌘/Ctrl+C when a frame is selected (or the clipboard button on the frame / stack footer) and paste it onto another frame with ⌘/Ctrl+V. Per layer: mute, opacity, and an optional luma mask from another asset (invert / feather / contrast) — a depth map on a blur layer gives a depth-of-field look.
- Assets panel: imported media, drag an asset onto the canvas to make another frame from it.
- Inspector: frame geometry, media info, video playback controls (play/pause, loop, scrub), searchable shader combobox and typed parameter controls (float, int, vec2, bool, color, select, string).
- Shaders (WGSL, driven through vgpu effects). Multipass shaders (bloom, separable blur, anisotropic Kuwahara) run as ping-pong GPU passes.
  - **Painterly**: Kuwahara (8-sector), classic 4-quadrant Kuwahara, Papari (circular sectors + polynomial weights + inverse-variance blend), anisotropic Kuwahara (structure tensor), Tomita–Tsuji, symmetric nearest neighbour.
  - **Stylized**: Pixelate, Dot grid, Halftone, Lit surface, Brand overlay (survey marks, distance mesh with markers, circle chain, colour-mapped mosaic zones), Pixel sort (threshold / edges / random / waves interval masks; optional Blend mask; horizontal, vertical, HV and VH).
  - **ASCII**: brightness-to-glyph ramp with presets or a custom character set, source colour or ink, contrast, invert, coverage, edge emphasis.
  - **Blur**: Gaussian (separable), box, Dual Kawase, motion / directional.
  - **Color**: Hue, contrast, saturation, grayscale, color map (palette remaps with WeatherNext / thermal / sunset / ember / twilight / mono / custom ramps), tint, opacity.
  - **Atmosphere**: Grain (optional animated), vignette, bloom (extract → blur → composite).
  - **Original**: passthrough.
- Local persistence: imported files are stored in the browser (IndexedDB) together with the frames, viewport and selection, and restored on the next visit, so closing the tab does not lose progress. Autosave is debounced and flushed when the page is hidden; the header shows the save state, and the trash button in the toolbar clears the workspace (including the saved copy). Older single-shader workspaces are migrated to a one-layer stack.
- Export:
  - Images: PNG, JPEG or WebP, at 0.25×–8× of the frame resolution, rendered offscreen and read back from the GPU (independent of on-canvas zoom).
  - Videos: plays the clip once while recording the shader output with `MediaRecorder` (MP4/H.264 or WebM depending on the browser), with scale, frame rate, bitrate and optional source audio. Still-frame export is available for videos too.

## Getting started

```bash
pnpm install
pnpm dev
```

Open http://localhost:3000 in a WebGPU-capable browser (Chrome/Edge 113+, Safari 26+, Firefox with `dom.webgpu.enabled`).

Other scripts:

```bash
pnpm build      # production build
pnpm lint       # eslint
npx vgpu check lib/shaders/wgsl/kuwahara.wgsl --require-validation   # validate a shader against a WebGPU device
```

## Deploying to Vercel

Import the repository in Vercel; the Next.js preset is detected automatically and no environment variables are required.

## Adding a shader

1. Add a `.wgsl` file under `lib/shaders/wgsl/`. Every shader is a fragment-only vgpu effect with these bindings:

   ```wgsl
   struct Params {
     resolution: vec2f,   // destination texture size, set by the engine
     time: f32,           // seconds since start, set by the engine
     // ...your parameters
   }
   @group(0) @binding(0) var<uniform> params: Params;
   @group(0) @binding(1) var src: texture_2d<f32>;
   @group(0) @binding(2) var samp: sampler;

   @fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f { ... }
   ```

   `uv` is top-origin (0,0 = top-left), matching WebGPU textures, so sampling `src` at `uv` needs no flip.

   Optional extra textures, declared only when the pass needs them:

   - `orig` — the layer input (used by bloom composite and anisotropic Kuwahara).
   - `atlas` / `atlas_samp` — glyph atlas for the ASCII shader.

   Multipass shaders list `passes` in the registry. Pass 0 reads the layer input; each later pass reads the previous output. Constants such as a blur axis can be merged into `params` per pass.

2. Register it in `lib/shaders/registry.ts` (built-ins) or `lib/shaders/extra.ts` with a `params` schema and a `group`. Each entry maps 1:1 onto a `Params` field: `float` → `f32`, `int` → `i32`, `select` (dropdown of labelled options) → `i32`, `bool` → `u32` (0/1), `vec2` → `vec2f`, `color` → `vec3f`. `string` params stay on the CPU (ASCII character ramps).

   Animated shaders read `params.time` (seconds since the engine started). Keep them stateless in `time` — e.g. derive loops with `fract(time / period)` — so still exports and video capture render the same thing the preview shows.

3. Validate it: `npx vgpu check lib/shaders/wgsl/<name>.wgsl --require-validation`.

## Project layout

```
app/                    Next.js app router (layout, page, global styles)
components/studio/      Toolbar, canvas viewport, frame view, layers/assets panel, inspector, export dialog
components/ui/          shadcn/ui primitives
lib/gpu/engine.ts       vgpu engine: device, asset textures, ping-pong stacks, render loop, offscreen renders
lib/gpu/media.ts        Image/video decoding and the media registry
lib/gpu/export.ts       Image encoding and MediaRecorder-based video capture
lib/shaders/            WGSL sources, registry, extra shaders, layer helpers
lib/store.ts            Zustand store: assets, frames, shader layers, selection, viewport, tools
lib/persistence.ts      IndexedDB persistence: stored files + workspace snapshot, restore on boot, debounced autosave
```

## Notes

- The stack is rendered at the frame’s width × height (capped at 4096 px for preview) into ping-pong targets; the on-canvas blit still only covers the visible window. Heavy painterly filters on large frames can be expensive — lower the frame size or radius if the preview stutters.
- Frames whose shaders do not read `params.time` are redrawn only when their inputs or parameters change. Exports use the frame resolution times the chosen scale, up to the device's `maxTextureDimension2D`.
- Video export records in real time at the display refresh cadence, throttled to the chosen frame rate. Heavy shaders at large sizes may drop below the target rate on slow GPUs; lower the scale in that case.
- `next build` does not validate WGSL; use `npx vgpu check` (see above) before shipping shader changes.
