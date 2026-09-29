struct Params {
  resolution: vec2f,
  time: f32,
  strength: f32,
  exposure: f32,
  contrast: f32,
  highlights: f32,
  shadows: f32,
  whites: f32,
  blacks: f32,
  temperature: f32,
  tint: f32,
  vibrance: f32,
  saturation: f32,
  texture_amt: f32,
  clarity: f32,
  dehaze: f32,
  vignette: f32,
  vignette_feather: f32,
  grain: f32,
  grain_size: f32,
  balance: f32,
  shadow_amount: f32,
  mid_amount: f32,
  high_amount: f32,
  global_amount: f32,
  shadow_color: vec3f,
  mid_color: vec3f,
  high_color: vec3f,
  global_color: vec3f,
  tone_curve_n: f32,
  tone_curve_0: vec4f,
  tone_curve_1: vec4f,
  tone_curve_2: vec4f,
  tone_curve_3: vec4f,
  red_curve_n: f32,
  red_curve_0: vec4f,
  red_curve_1: vec4f,
  red_curve_2: vec4f,
  red_curve_3: vec4f,
  green_curve_n: f32,
  green_curve_0: vec4f,
  green_curve_1: vec4f,
  green_curve_2: vec4f,
  green_curve_3: vec4f,
  blue_curve_n: f32,
  blue_curve_0: vec4f,
  blue_curve_1: vec4f,
  blue_curve_2: vec4f,
  blue_curve_3: vec4f,
  red_range_color: vec3f,
  red_range_window: vec3f,
  red_hue: f32,
  red_sat: f32,
  red_lum: f32,
  orange_range_color: vec3f,
  orange_range_window: vec3f,
  orange_hue: f32,
  orange_sat: f32,
  orange_lum: f32,
  yellow_range_color: vec3f,
  yellow_range_window: vec3f,
  yellow_hue: f32,
  yellow_sat: f32,
  yellow_lum: f32,
  green_range_color: vec3f,
  green_range_window: vec3f,
  green_hue: f32,
  green_sat: f32,
  green_lum: f32,
  aqua_range_color: vec3f,
  aqua_range_window: vec3f,
  aqua_hue: f32,
  aqua_sat: f32,
  aqua_lum: f32,
  blue_range_color: vec3f,
  blue_range_window: vec3f,
  blue_hue: f32,
  blue_sat: f32,
  blue_lum: f32,
  purple_range_color: vec3f,
  purple_range_window: vec3f,
  purple_hue: f32,
  purple_sat: f32,
  purple_lum: f32,
  magenta_range_color: vec3f,
  magenta_range_window: vec3f,
  magenta_hue: f32,
  magenta_sat: f32,
  magenta_lum: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var src: texture_2d<f32>;
@group(0) @binding(2) var samp: sampler;

fn srgbToLinear(c: f32) -> f32 {
  if (c <= 0.04045) { return c / 12.92; }
  return pow((c + 0.055) / 1.055, 2.4);
}

fn linearToSrgb(c: f32) -> f32 {
  if (c <= 0.0031308) { return c * 12.92; }
  return 1.055 * pow(max(c, 0.0), 1.0 / 2.4) - 0.055;
}

fn lumaOf(c: vec3f) -> f32 {
  return dot(c, vec3f(0.2126, 0.7152, 0.0722));
}

fn curveY(t: f32, count: f32, p0: vec4f, p1: vec4f, p2: vec4f, p3: vec4f) -> f32 {
  let n = i32(count + 0.5);
  if (n < 2) { return t; }
  var xs = array<f32, 8>(p0.x, p0.z, p1.x, p1.z, p2.x, p2.z, p3.x, p3.z);
  var ys = array<f32, 8>(p0.y, p0.w, p1.y, p1.w, p2.y, p2.w, p3.y, p3.w);
  if (t <= xs[0]) { return ys[0]; }
  let last = n - 1;
  if (t >= xs[last]) { return ys[last]; }
  var y = ys[0];
  var found = 0.0;
  for (var i = 0; i < 7; i = i + 1) {
    let i1 = i + 1;
    let inside = select(0.0, 1.0, i1 < n && found < 0.5 && t <= xs[i1]);
    let span = max(xs[i1] - xs[i], 1e-4);
    let u = clamp((t - xs[i]) / span, 0.0, 1.0);
    let seg = mix(ys[i], ys[i1], u);
    y = mix(y, seg, inside);
    found = max(found, inside);
  }
  return y;
}

fn applyCurves(c: vec3f) -> vec3f {
  let tone = vec3f(
    curveY(c.x, params.tone_curve_n, params.tone_curve_0, params.tone_curve_1, params.tone_curve_2, params.tone_curve_3),
    curveY(c.y, params.tone_curve_n, params.tone_curve_0, params.tone_curve_1, params.tone_curve_2, params.tone_curve_3),
    curveY(c.z, params.tone_curve_n, params.tone_curve_0, params.tone_curve_1, params.tone_curve_2, params.tone_curve_3),
  );
  return vec3f(
    curveY(tone.x, params.red_curve_n, params.red_curve_0, params.red_curve_1, params.red_curve_2, params.red_curve_3),
    curveY(tone.y, params.green_curve_n, params.green_curve_0, params.green_curve_1, params.green_curve_2, params.green_curve_3),
    curveY(tone.z, params.blue_curve_n, params.blue_curve_0, params.blue_curve_1, params.blue_curve_2, params.blue_curve_3),
  );
}

fn rgbToHsl(c: vec3f) -> vec3f {
  let mx = max(c.r, max(c.g, c.b));
  let mn = min(c.r, min(c.g, c.b));
  let l = (mx + mn) * 0.5;
  let d = mx - mn;
  if (d < 1e-5) { return vec3f(0.0, 0.0, l); }
  let s = select(d / (mx + mn), d / (2.0 - mx - mn), l > 0.5);
  var h = 0.0;
  if (mx == c.r) {
    h = (c.g - c.b) / d + select(6.0, 0.0, c.g >= c.b);
  } else if (mx == c.g) {
    h = (c.b - c.r) / d + 2.0;
  } else {
    h = (c.r - c.g) / d + 4.0;
  }
  return vec3f(h / 6.0, s, l);
}

fn hueToRgb(p: f32, q: f32, tIn: f32) -> f32 {
  var t = tIn;
  if (t < 0.0) { t = t + 1.0; }
  if (t > 1.0) { t = t - 1.0; }
  if (t < 1.0 / 6.0) { return p + (q - p) * 6.0 * t; }
  if (t < 0.5) { return q; }
  if (t < 2.0 / 3.0) { return p + (q - p) * (2.0 / 3.0 - t) * 6.0; }
  return p;
}

fn hslToRgb(hsl: vec3f) -> vec3f {
  let s = clamp(hsl.y, 0.0, 1.0);
  let l = clamp(hsl.z, 0.0, 1.0);
  if (s <= 1e-5) { return vec3f(l); }
  let q = select(l * (1.0 + s), l + s - l * s, l < 0.5);
  let p = 2.0 * l - q;
  return vec3f(
    hueToRgb(p, q, hsl.x + 1.0 / 3.0),
    hueToRgb(p, q, hsl.x),
    hueToRgb(p, q, hsl.x - 1.0 / 3.0),
  );
}

fn arcWeight(h: f32, start: f32, end: f32, soft: f32) -> f32 {
  let span = fract(end - start);
  if (span < 1e-4) { return 0.0; }
  let pos = fract(h - start);
  let s = max(soft, 0.001);
  let inside = pos <= span;
  let dist = select(-min(pos - span, 1.0 - pos), min(pos, span - pos), inside);
  return smoothstep(0.0, s, dist);
}

fn accumulateBand(hsl: vec3f, hueShift: f32, satAdd: f32, lumAdd: f32, window: vec3f) -> vec4f {
  let w = arcWeight(hsl.x, window.x, window.y, window.z);
  return vec4f(w * hueShift, w * satAdd, w * lumAdd, w);
}

fn applyBands(c: vec3f) -> vec3f {
  let adj = abs(params.red_hue) + abs(params.red_sat) + abs(params.red_lum)
    + abs(params.orange_hue) + abs(params.orange_sat) + abs(params.orange_lum)
    + abs(params.yellow_hue) + abs(params.yellow_sat) + abs(params.yellow_lum)
    + abs(params.green_hue) + abs(params.green_sat) + abs(params.green_lum)
    + abs(params.aqua_hue) + abs(params.aqua_sat) + abs(params.aqua_lum)
    + abs(params.blue_hue) + abs(params.blue_sat) + abs(params.blue_lum)
    + abs(params.purple_hue) + abs(params.purple_sat) + abs(params.purple_lum)
    + abs(params.magenta_hue) + abs(params.magenta_sat) + abs(params.magenta_lum);
  if (adj < 1e-4) { return c; }
  var hsl = rgbToHsl(clamp(c, vec3f(0.0), vec3f(1.0)));
  var acc = vec4f(0.0);
  acc = acc + accumulateBand(hsl, params.red_hue, params.red_sat, params.red_lum, params.red_range_window);
  acc = acc + accumulateBand(hsl, params.orange_hue, params.orange_sat, params.orange_lum, params.orange_range_window);
  acc = acc + accumulateBand(hsl, params.yellow_hue, params.yellow_sat, params.yellow_lum, params.yellow_range_window);
  acc = acc + accumulateBand(hsl, params.green_hue, params.green_sat, params.green_lum, params.green_range_window);
  acc = acc + accumulateBand(hsl, params.aqua_hue, params.aqua_sat, params.aqua_lum, params.aqua_range_window);
  acc = acc + accumulateBand(hsl, params.blue_hue, params.blue_sat, params.blue_lum, params.blue_range_window);
  acc = acc + accumulateBand(hsl, params.purple_hue, params.purple_sat, params.purple_lum, params.purple_range_window);
  acc = acc + accumulateBand(hsl, params.magenta_hue, params.magenta_sat, params.magenta_lum, params.magenta_range_window);
  let norm = 1.0 / max(acc.w, 1.0);
  hsl = vec3f(
    fract(hsl.x + acc.x * norm * (40.0 / 360.0) / 100.0),
    clamp(hsl.y * (1.0 + acc.y * norm / 100.0), 0.0, 1.0),
    clamp(hsl.z + acc.z * norm / 100.0 * 0.35, 0.0, 1.0),
  );
  return hslToRgb(hsl);
}

fn gradeChroma(color: vec3f) -> vec3f {
  let y = lumaOf(color);
  return color - vec3f(y);
}

fn applyGrade(c: vec3f) -> vec3f {
  let split = clamp(0.5 + params.balance / 100.0 * 0.35, 0.15, 0.85);
  let y = lumaOf(c);
  let shadowMask = 1.0 - smoothstep(split - 0.28, split + 0.02, y);
  let highMask = smoothstep(split - 0.02, split + 0.28, y);
  let midMask = clamp(1.0 - shadowMask - highMask, 0.0, 1.0);
  var color = c;
  color = color + gradeChroma(params.shadow_color) * shadowMask * params.shadow_amount * 1.35;
  color = color + gradeChroma(params.mid_color) * midMask * params.mid_amount * 1.35;
  color = color + gradeChroma(params.high_color) * highMask * params.high_amount * 1.35;
  color = color + gradeChroma(params.global_color) * params.global_amount * 1.15;
  return clamp(color, vec3f(0.0), vec3f(1.0));
}

fn hash21(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 = p3 + dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

fn sampleLuma(p: vec2f) -> f32 {
  let s = textureSampleLevel(src, samp, clamp(p, vec2f(0.0), vec2f(1.0)), 0.0);
  return lumaOf(clamp(s.rgb, vec3f(0.0), vec3f(1.0)));
}

@fragment fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  let srcColor = textureSampleLevel(src, samp, uv, 0.0);
  var color = clamp(srcColor.rgb, vec3f(0.0), vec3f(1.0));

  if (params.exposure != 0.0 || params.temperature != 0.0 || params.tint != 0.0) {
    var linear = vec3f(srgbToLinear(color.x), srgbToLinear(color.y), srgbToLinear(color.z));
    let temperature = params.temperature / 100.0;
    let tint = params.tint / 100.0;
    linear.x = linear.x * (1.0 + temperature * 0.32);
    linear.z = linear.z * (1.0 - temperature * 0.32);
    linear.y = linear.y * (1.0 + tint * 0.28);
    linear = linear * exp2(params.exposure);
    color = clamp(vec3f(linearToSrgb(linear.x), linearToSrgb(linear.y), linearToSrgb(linear.z)), vec3f(0.0), vec3f(1.0));
  }

  let contrast = 1.0 + params.contrast / 100.0;
  if (contrast != 1.0) {
    color = clamp((color - vec3f(0.5)) * contrast + vec3f(0.5), vec3f(0.0), vec3f(1.0));
  }

  let whites = params.whites / 100.0;
  let blacks = params.blacks / 100.0;
  if (whites != 0.0 || blacks != 0.0) {
    let blackPoint = -blacks * 0.28;
    let whitePoint = 1.0 - whites * 0.28;
    color = clamp((color - vec3f(blackPoint)) / vec3f(max(whitePoint - blackPoint, 1e-4)), vec3f(0.0), vec3f(1.0));
  }

  let highlights = params.highlights / 100.0;
  let shadows = params.shadows / 100.0;
  if (highlights != 0.0 || shadows != 0.0) {
    let y = lumaOf(color);
    let highlightMask = smoothstep(0.45, 1.0, y);
    let shadowMask = smoothstep(0.55, 0.0, y);
    color = clamp(color + vec3f(highlights * highlightMask * 0.72 + shadows * shadowMask * 0.72), vec3f(0.0), vec3f(1.0));
  }

  color = applyCurves(color);

  let dehaze = params.dehaze / 100.0;
  if (dehaze != 0.0) {
    color = (color - vec3f(0.5)) * (1.0 + dehaze * 0.55) + vec3f(0.5 - dehaze * 0.06);
    let y = lumaOf(clamp(color, vec3f(0.0), vec3f(1.0)));
    color = mix(vec3f(y), color, 1.0 + dehaze * 0.4);
    color = clamp(color, vec3f(0.0), vec3f(1.0));
  }

  let vibrance = params.vibrance / 100.0;
  let saturation = 1.0 + params.saturation / 100.0;
  if (vibrance != 0.0 || saturation != 1.0) {
    var y = lumaOf(color);
    let currentSat = max(color.x, max(color.y, color.z)) - min(color.x, min(color.y, color.z));
    let vib = vibrance * (1.0 - currentSat);
    color = clamp(mix(vec3f(y), color, 1.0 + vib), vec3f(0.0), vec3f(1.0));
    y = lumaOf(color);
    color = clamp(mix(vec3f(y), color, saturation), vec3f(0.0), vec3f(1.0));
  }

  color = applyBands(color);
  color = applyGrade(color);

  if (params.texture_amt != 0.0 || params.clarity != 0.0) {
    let px = 1.0 / max(params.resolution, vec2f(1.0));
    let centerY = lumaOf(srcColor.rgb);
    let clarityOff = px * 8.0;
    let textureOff = px * 2.0;
    let broad = centerY - (
      sampleLuma(uv + vec2f(0.0, -clarityOff.y)) + sampleLuma(uv + vec2f(0.0, clarityOff.y))
      + sampleLuma(uv + vec2f(clarityOff.x, 0.0)) + sampleLuma(uv + vec2f(-clarityOff.x, 0.0))
    ) * 0.25;
    let fine = centerY - (
      sampleLuma(uv + vec2f(0.0, -textureOff.y)) + sampleLuma(uv + vec2f(0.0, textureOff.y))
      + sampleLuma(uv + vec2f(textureOff.x, 0.0)) + sampleLuma(uv + vec2f(-textureOff.x, 0.0))
    ) * 0.25;
    let midMask = clamp(1.0 - abs(centerY - 0.5) * 2.0, 0.0, 1.0);
    color = color + vec3f(broad * params.clarity / 100.0 * 1.6 * midMask + fine * params.texture_amt / 100.0 * 1.35 * (0.45 + 0.55 * midMask));
    color = clamp(color, vec3f(0.0), vec3f(1.0));
  }

  let vignette = params.vignette / 100.0;
  if (vignette != 0.0) {
    let aspect = params.resolution.x / max(params.resolution.y, 1.0);
    let q = (uv - vec2f(0.5)) * vec2f(aspect, 1.0);
    let reach = length(vec2f(aspect, 1.0) * 0.5);
    let dist = length(q) / max(reach, 1e-4);
    let feather = clamp(params.vignette_feather / 100.0, 0.05, 0.95);
    let mask = smoothstep(1.0 - feather, 1.08, dist);
    if (vignette > 0.0) {
      color = color * (1.0 - mask * vignette * 0.92);
    } else {
      color = mix(color, vec3f(1.0), mask * (-vignette) * 0.75);
    }
    color = clamp(color, vec3f(0.0), vec3f(1.0));
  }

  let grain = params.grain / 100.0;
  if (grain > 0.0) {
    let grainSize = max(params.grain_size, 0.5);
    let n = hash21(floor(uv * params.resolution / grainSize));
    let y = lumaOf(color);
    let mid = clamp(1.0 - abs(y - 0.45) * 1.35, 0.15, 1.0);
    color = clamp(color + vec3f((n - 0.5) * grain * 0.22 * mid), vec3f(0.0), vec3f(1.0));
  }

  let graded = mix(srcColor.rgb, color, clamp(params.strength, 0.0, 1.0));
  return vec4f(graded, srcColor.a);
}
