// ASCII / character mosaic. Glyphs live in `atlas` (white on black), indexed by luma.

struct Params {
  resolution: vec2f,
  time: f32,
  cell_size: f32,
  contrast: f32,
  invert: u32,
  color_mode: i32,
  ink: vec3f,
  background: vec3f,
  coverage: f32,
  original_opacity: f32,
  edge: f32,
  atlas_cols: i32,
  atlas_rows: i32,
  char_count: i32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;
@group(0) @binding(3) var atlas: texture_2d<f32>;
@group(0) @binding(4) var atlas_samp: sampler;

fn luma(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

fn sample_cell(origin: vec2f, cell: vec2f) -> vec3f {
  var acc = vec3f(0.0);
  acc += textureSampleLevel(src, samp, origin + cell * vec2f(0.3, 0.3), 0.0).rgb;
  acc += textureSampleLevel(src, samp, origin + cell * vec2f(0.7, 0.3), 0.0).rgb;
  acc += textureSampleLevel(src, samp, origin + cell * vec2f(0.3, 0.7), 0.0).rgb;
  acc += textureSampleLevel(src, samp, origin + cell * vec2f(0.7, 0.7), 0.0).rgb;
  return acc * 0.25;
}

fn sobel(uv: vec2f) -> f32 {
  let texel = 1.0 / params.resolution;
  let tl = luma(textureSampleLevel(src, samp, uv + vec2f(-1.0, -1.0) * texel, 0.0).rgb);
  let tc = luma(textureSampleLevel(src, samp, uv + vec2f( 0.0, -1.0) * texel, 0.0).rgb);
  let tr = luma(textureSampleLevel(src, samp, uv + vec2f( 1.0, -1.0) * texel, 0.0).rgb);
  let ml = luma(textureSampleLevel(src, samp, uv + vec2f(-1.0,  0.0) * texel, 0.0).rgb);
  let mr = luma(textureSampleLevel(src, samp, uv + vec2f( 1.0,  0.0) * texel, 0.0).rgb);
  let bl = luma(textureSampleLevel(src, samp, uv + vec2f(-1.0,  1.0) * texel, 0.0).rgb);
  let bc = luma(textureSampleLevel(src, samp, uv + vec2f( 0.0,  1.0) * texel, 0.0).rgb);
  let br = luma(textureSampleLevel(src, samp, uv + vec2f( 1.0,  1.0) * texel, 0.0).rgb);
  let sx = -tl + tr - 2.0 * ml + 2.0 * mr - bl + br;
  let sy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return clamp(length(vec2f(sx, sy)), 0.0, 1.0);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let cell_px = max(params.cell_size, 2.0);
  let grid = params.resolution / cell_px;
  let cell_i = floor(uv * grid);
  let origin = cell_i / grid;
  let cell = 1.0 / grid;
  let local = fract(uv * grid);

  let avg = sample_cell(origin, cell);
  var l = luma(avg);
  l = clamp((l - 0.5) * params.contrast + 0.5, 0.0, 1.0);
  if (params.edge > 0.001) {
    l = clamp(l + sobel(origin + cell * 0.5) * params.edge, 0.0, 1.0);
  }
  if (params.invert == 1u) {
    l = 1.0 - l;
  }

  let source = textureSampleLevel(src, samp, uv, 0.0);
  let under = mix(params.background, source.rgb, clamp(params.original_opacity, 0.0, 1.0));

  if (l > params.coverage) {
    return vec4f(under, 1.0);
  }

  let n = max(params.char_count, 1);
  let idx = clamp(i32(floor(l * f32(n - 1) + 0.5)), 0, n - 1);
  let cols = max(params.atlas_cols, 1);
  let rows = max(params.atlas_rows, 1);
  let col = idx % cols;
  let row = idx / cols;
  let atlas_uv = (vec2f(f32(col), f32(row)) + local) / vec2f(f32(cols), f32(rows));
  let glyph = textureSampleLevel(atlas, atlas_samp, atlas_uv, 0.0).r;

  var ink = params.ink;
  if (params.color_mode == 1) {
    ink = avg;
  }
  let rgb = mix(under, ink, glyph);
  return vec4f(rgb, 1.0);
}
