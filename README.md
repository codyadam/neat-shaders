# Shader Studio

A Figma-like canvas for applying WebGPU shaders to images and videos, then exporting the result. Drop media onto an infinite canvas, pick a shader per frame, tune its parameters live, and export a PNG/JPEG/WebP at native resolution or record the processed video.

Built with Next.js (App Router), React, Tailwind CSS, shadcn/ui and [vgpu](https://vgpu.sh) for WebGPU rendering. Everything runs client-side; there is no server component, so it deploys to Vercel as-is.

## Features

- Infinite canvas with pan (Space + drag, wheel, hand tool), zoom (⌘/Ctrl + wheel, pinch, shortcuts), zoom-to-fit and zoom-to-selection.
- Hide the UI with ⌘\ / Ctrl+\ (same as Figma) or the eye button in the toolbar to look at the result alone; panning and zooming keep working, and a small pill brings the UI back.
- Frames: each imported image or video becomes a frame you can select, move, resize (aspect-locked corner handles), rename, reorder, hide and lock.
- Assets panel: imported media, drag an asset onto the canvas to make another frame from it.
- Inspector: frame geometry, media info, video playback controls (play/pause, loop, scrub), shader picker and typed parameter controls (float, int, vec2, bool, color).
- Shaders (WGSL, driven through vgpu effects):
  - **Kuwahara**: sector-based Kuwahara filter ported from the Godot `canvas_item` shader (`kernel_spread`, `radius`, `canvas_scale`, `edge_clamp`).
  - **Pixelate**: mosaic + posterize + optional tint, as an example of the parameter system.
  - **Dot grid**: halftone dot field that enters as a staggered wave (rows / columns / diagonal / radial / random order), then idles with a roaming highlight that swells nearby dots. Dot size can follow the source luminance, dots can take the source colour, and shape, pitch, padding, colours, loop and highlight timing are all tunable.
  - **Halftone**: fixed-grid dot halftone driven by luminance. Dot size follows darkness (or brightness when inverted), a luma threshold skips background cells, optional minimum dot, tint or quantised source colour (1–8 bits/channel), shapes, softness, background and source backdrop.
  - **Lit surface**: hashed rounded cells on a spacing grid that light up around a focus — brighter cells grow, pick a colour from a palette derived from the main colour and split chromatically along the radial direction, composited additively (or normally). The focus can sweep along a path (linear, diagonal, bounce, orbit, figure eight), sit still, or flood the whole field; optional ripples travel out from the focus as a crest with inverse glow and suppression.
  - **Original**: passthrough for A/B comparison.
- Local persistence: imported files are stored in the browser (IndexedDB) together with the frames, viewport and selection, and restored on the next visit, so closing the tab does not lose progress. Autosave is debounced and flushed when the page is hidden; the header shows the save state, and the trash button in the toolbar clears the workspace (including the saved copy).
- Export:
  - Images: PNG, JPEG or WebP, at 0.25×–8× of the source resolution, rendered offscreen and read back from the GPU (independent of on-canvas zoom).
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
     resolution: vec2f,   // source texture size, set by the engine
     time: f32,           // seconds since start, set by the engine
     // ...your parameters
   }
   @group(0) @binding(0) var<uniform> params: Params;
   @group(0) @binding(1) var src: texture_2d<f32>;
   @group(0) @binding(2) var samp: sampler;

   @fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f { ... }
   ```

   `uv` is top-origin (0,0 = top-left), matching WebGPU textures, so sampling `src` at `uv` needs no flip.

2. Register it in `lib/shaders/registry.ts` with a `params` schema. Each entry maps 1:1 onto a `Params` field: `float` → `f32`, `int` → `i32`, `select` (dropdown of labelled options) → `i32`, `bool` → `u32` (0/1), `vec2` → `vec2f`, `color` → `vec3f`. The inspector controls, defaults and uniform packing are generated from the schema.

   Animated shaders read `params.time` (seconds since the engine started). Keep them stateless in `time` — e.g. derive loops with `fract(time / period)` — so still exports and video capture render the same thing the preview shows.

3. Validate it: `npx vgpu check lib/shaders/wgsl/<name>.wgsl --require-validation`.

## Project layout

```
app/                    Next.js app router (layout, page, global styles)
components/studio/      Toolbar, canvas viewport, frame view, layers/assets panel, inspector, export dialog
components/ui/          shadcn/ui primitives
lib/gpu/engine.ts       vgpu engine: device, asset textures, per-frame surfaces/effects, render loop, offscreen renders
lib/gpu/media.ts        Image/video decoding and the media registry
lib/gpu/export.ts       Image encoding and MediaRecorder-based video capture
lib/shaders/            WGSL sources and the shader registry (parameter schema)
lib/store.ts            Zustand store: assets, frames, selection, viewport, tools
lib/persistence.ts      IndexedDB persistence: stored files + workspace snapshot, restore on boot, debounced autosave
```

## Notes

- Preview canvases are capped at 4096 px on their longest side regardless of zoom; exports use the source resolution times the chosen scale, up to the device's `maxTextureDimension2D`.
- Video export records in real time at the display refresh cadence, throttled to the chosen frame rate. Heavy shaders at large sizes may drop below the target rate on slow GPUs; lower the scale in that case.
- `next build` does not validate WGSL; use `npx vgpu check` (see above) before shipping shader changes.
