// Classic 4-quadrant Kuwahara filter (overlapping boxes, min-variance mean).

struct Params {
  resolution: vec2f,
  time: f32,
  radius: i32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

const MAX_R: i32 = 8;

fn luminance(rgb: vec3f) -> f32 {
  return dot(rgb, vec3f(0.299, 0.587, 0.114));
}

fn region(uv: vec2f, texel: vec2f, x0: i32, y0: i32, x1: i32, y1: i32) -> vec4f {
  var count = 0.0;
  var sum_rgb = vec3f(0.0);
  var sum_l = 0.0;
  var sum_l2 = 0.0;
  for (var y = y0; y <= y1; y++) {
    for (var x = x0; x <= x1; x++) {
      let c = textureSampleLevel(src, samp, uv + vec2f(f32(x), f32(y)) * texel, 0.0);
      let l = luminance(c.rgb);
      sum_rgb += c.rgb;
      sum_l += l;
      sum_l2 += l * l;
      count += 1.0;
    }
  }
  let mean = sum_rgb / max(count, 1.0);
  let m = sum_l / max(count, 1.0);
  let v = sum_l2 / max(count, 1.0) - m * m;
  return vec4f(mean, v);
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / params.resolution;
  let r = clamp(params.radius, 1, MAX_R);
  let center = textureSampleLevel(src, samp, uv, 0.0);

  let nw = region(uv, texel, -r, -r, 0, 0);
  let ne = region(uv, texel, 0, -r, r, 0);
  let sw = region(uv, texel, -r, 0, 0, r);
  let se = region(uv, texel, 0, 0, r, r);

  var best = nw;
  if (ne.a < best.a) { best = ne; }
  if (sw.a < best.a) { best = sw; }
  if (se.a < best.a) { best = se; }

  return vec4f(best.rgb, center.a);
}
