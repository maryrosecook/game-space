const vertexShaderSource = `
attribute vec2 a_position;
uniform vec2 u_center;
uniform float u_radius;
uniform float u_viewportScale;

void main() {
  vec2 localPosition = a_position * u_radius;
  vec2 worldPosition = vec2(localPosition.x * u_viewportScale, localPosition.y) + u_center;
  gl_Position = vec4(worldPosition, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision mediump float;

void main() {
  gl_FragColor = vec4(0.16, 0.86, 0.64, 1.0);
}
`;

type ProgramInfo = {
  program: WebGLProgram;
  positionLocation: number;
  centerLocation: WebGLUniformLocation;
  radiusLocation: WebGLUniformLocation;
  viewportScaleLocation: WebGLUniformLocation;
};

function createShader(gl: WebGLRenderingContext, shaderType: number, source: string): WebGLShader {
  const shader = gl.createShader(shaderType);
  if (!shader) {
    throw new Error('Unable to allocate shader');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }

  const infoLog = gl.getShaderInfoLog(shader);
  gl.deleteShader(shader);
  throw new Error(`Shader compilation failed: ${infoLog ?? 'unknown error'}`);
}

function createProgram(gl: WebGLRenderingContext): ProgramInfo {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  const program = gl.createProgram();
  if (!program) {
    throw new Error('Unable to allocate program');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const infoLog = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${infoLog ?? 'unknown error'}`);
  }

  const positionLocation = gl.getAttribLocation(program, 'a_position');
  const centerLocation = gl.getUniformLocation(program, 'u_center');
  const radiusLocation = gl.getUniformLocation(program, 'u_radius');
  const viewportScaleLocation = gl.getUniformLocation(program, 'u_viewportScale');

  if (positionLocation < 0 || !centerLocation || !radiusLocation || !viewportScaleLocation) {
    throw new Error('Program location lookup failed');
  }

  return {
    program,
    positionLocation,
    centerLocation,
    radiusLocation,
    viewportScaleLocation
  };
}

function createCircleVertices(segments: number): Float32Array {
  const points = new Float32Array((segments + 2) * 2);
  points[0] = 0;
  points[1] = 0;

  for (let index = 0; index <= segments; index += 1) {
    const angle = (index / segments) * Math.PI * 2;
    const base = (index + 1) * 2;
    points[base] = Math.cos(angle);
    points[base + 1] = Math.sin(angle);
  }

  return points;
}

function resizeCanvasToViewport(canvas: HTMLCanvasElement, gl: WebGLRenderingContext): void {
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
}

export function startGame(canvas: HTMLCanvasElement): void {
  const gl = canvas.getContext('webgl');
  if (!gl) {
    throw new Error('WebGL is unavailable in this browser');
  }

  const { program, positionLocation, centerLocation, radiusLocation, viewportScaleLocation } = createProgram(gl);
  const vertices = createCircleVertices(48);
  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) {
    throw new Error('Unable to allocate buffer');
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  gl.useProgram(program);
  gl.enableVertexAttribArray(positionLocation);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  let x = 0;
  let y = 0;
  let velocityX = 0.62;
  let velocityY = 0.78;
  const radius = 0.12;
  let previousTimestamp: number | null = null;

  function animate(timestamp: number): void {
    if (previousTimestamp === null) {
      previousTimestamp = timestamp;
    }

    const deltaSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.05);
    previousTimestamp = timestamp;

    resizeCanvasToViewport(canvas, gl);
    const viewportScale = canvas.height / Math.max(canvas.width, 1);
    const horizontalRadius = radius * viewportScale;

    x += velocityX * deltaSeconds;
    y += velocityY * deltaSeconds;

    if (x >= 1 - horizontalRadius) {
      x = 1 - horizontalRadius;
      velocityX *= -1;
    }
    if (x <= -1 + horizontalRadius) {
      x = -1 + horizontalRadius;
      velocityX *= -1;
    }
    if (y >= 1 - radius) {
      y = 1 - radius;
      velocityY *= -1;
    }
    if (y <= -1 + radius) {
      y = -1 + radius;
      velocityY *= -1;
    }

    gl.clearColor(0.03, 0.06, 0.12, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.uniform2f(centerLocation, x, y);
    gl.uniform1f(radiusLocation, radius);
    gl.uniform1f(viewportScaleLocation, viewportScale);

    gl.drawArrays(gl.TRIANGLE_FAN, 0, vertices.length / 2);
    window.requestAnimationFrame(animate);
  }

  window.addEventListener('resize', () => {
    resizeCanvasToViewport(canvas, gl);
  });

  resizeCanvasToViewport(canvas, gl);
  window.requestAnimationFrame(animate);
}
