// Structure tensor from a Sobel gradient of luminance. Output: (Jxx, Jyy, Jxy, 1).

struct Params {
  resolution: vec2f,
  time: f32,
  radius: i32,
  eccentricity: f32,
  sharpness: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn luma(uv: vec2f) -> f32 {
  let c = textureSampleLevel(src, samp, uv, 0.0).rgb;
  return dot(c, vec3f(0.299, 0.587, 0.114));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let texel = 1.0 / params.resolution;
  let tl = luma(uv + vec2f(-1.0, -1.0) * texel);
  let tc = luma(uv + vec2f( 0.0, -1.0) * texel);
  let tr = luma(uv + vec2f( 1.0, -1.0) * texel);
  let ml = luma(uv + vec2f(-1.0,  0.0) * texel);
  let mr = luma(uv + vec2f( 1.0,  0.0) * texel);
  let bl = luma(uv + vec2f(-1.0,  1.0) * texel);
  let bc = luma(uv + vec2f( 0.0,  1.0) * texel);
  let br = luma(uv + vec2f( 1.0,  1.0) * texel);

  let sx = -tl + tr - 2.0 * ml + 2.0 * mr - bl + br;
  let sy = -tl - 2.0 * tc - tr + bl + 2.0 * bc + br;
  return vec4f(sx * sx, sy * sy, sx * sy, 1.0);
}
