// Symmetric nearest-neighbour: for each opposite pair, keep the sample closer to the centre colour.

struct Params {
  resolution: vec2f,
  time: f32,
  radius: i32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const MAX_R: i32 = 8;

fn dist2(a: vec3f, b: vec3f) -> f32 {
  let d = a - b;
  return dot(d, d);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / params.resolution;
  let r = clamp(params.radius, 1, MAX_R);
  let center = textureSampleLevel(src, samp, uv, 0.0);

  var acc = center.rgb;
  var n = 1.0;

  for (var dy = -MAX_R; dy <= MAX_R; dy++) {
    for (var dx = -MAX_R; dx <= MAX_R; dx++) {
      if (dx == 0 && dy == 0) { continue; }
      if (dy < 0 || (dy == 0 && dx <= 0)) { continue; }
      if (max(abs(dx), abs(dy)) > r) { continue; }

      let a = textureSampleLevel(src, samp, uv + vec2f(f32(dx), f32(dy)) * texel, 0.0).rgb;
      let b = textureSampleLevel(src, samp, uv - vec2f(f32(dx), f32(dy)) * texel, 0.0).rgb;
      if (dist2(a, center.rgb) <= dist2(b, center.rgb)) {
        acc += a;
      } else {
        acc += b;
      }
      n += 1.0;
    }
  }

  return vec4f(acc / n, center.a);
}
