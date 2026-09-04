// Pixelate + optional posterize. Small example of a shader with int, float,
// bool and color parameters driven from the inspector.

struct Params {
  resolution: vec2f,
  time: f32,
  cell_size: f32,
  levels: i32,
  tint_enabled: u32,
  tint: vec3f,
  tint_strength: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let cell = max(params.cell_size, 1.0);
  let grid = params.resolution / cell;
  let snapped = (floor(uv * grid) + 0.5) / grid;
  var c = textureSampleLevel(src, samp, snapped, 0.0);

  let levels = f32(max(params.levels, 2));
  c = vec4f(floor(c.rgb * levels + 0.5) / levels, c.a);

  if (params.tint_enabled == 1u) {
    let lum = dot(c.rgb, vec3f(0.299, 0.587, 0.114));
    c = vec4f(mix(c.rgb, params.tint * lum, params.tint_strength), c.a);
  }
  return c;
}
