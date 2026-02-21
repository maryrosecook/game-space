import { getBlueprintForThing } from './blueprints';
import { ParticleSystem } from './particles';
import { Blueprint, RuntimeGameState, Shape, Vector } from './types';

type ScreenSize = {
  width: number;
  height: number;
};

export type DrawShapeInput = {
  x: number;
  y: number;
  width: number;
  height: number;
  angle: number;
  color: string;
  camera: Vector;
  screen: ScreenSize;
};

export type GameRenderer = {
  resize: (screen: ScreenSize) => void;
  clear: (color: string) => void;
  drawRectangle: (input: DrawShapeInput) => void;
  drawTriangle: (input: DrawShapeInput) => void;
  drawCircle: (input: DrawShapeInput) => void;
};

export type RenderGameParams = {
  renderer: GameRenderer;
  gameState: RuntimeGameState;
  blueprintLookup: Map<string, Blueprint>;
  particleSystem?: ParticleSystem;
};

type Geometry = {
  buffer: WebGLBuffer;
  vertexCount: number;
  primitive: number;
};

type ProgramInfo = {
  program: WebGLProgram;
  positionLocation: number;
  translationLocation: WebGLUniformLocation;
  sizeLocation: WebGLUniformLocation;
  rotationLocation: WebGLUniformLocation;
  cameraLocation: WebGLUniformLocation;
  screenLocation: WebGLUniformLocation;
  colorLocation: WebGLUniformLocation;
};

const vertexShaderSource = `
attribute vec2 a_localPosition;
uniform vec2 u_translation;
uniform vec2 u_size;
uniform float u_rotation;
uniform vec2 u_camera;
uniform vec2 u_screen;

void main() {
  vec2 scaled = a_localPosition * u_size;

  float s = sin(u_rotation);
  float c = cos(u_rotation);
  vec2 rotated = vec2(
    scaled.x * c - scaled.y * s,
    scaled.x * s + scaled.y * c
  );

  vec2 world = u_translation + rotated;
  vec2 cameraSpace = world - u_camera;
  vec2 zeroToOne = cameraSpace / u_screen;
  vec2 clipSpace = vec2(zeroToOne.x * 2.0 - 1.0, 1.0 - zeroToOne.y * 2.0);

  gl_Position = vec4(clipSpace, 0.0, 1.0);
}
`;

const fragmentShaderSource = `
precision mediump float;
uniform vec4 u_color;

void main() {
  gl_FragColor = u_color;
}
`;

export function renderGame({
  renderer,
  gameState,
  blueprintLookup,
  particleSystem
}: RenderGameParams): void {
  renderer.resize(gameState.screen);
  renderer.clear(gameState.backgroundColor);

  const sortedThings = [...gameState.things].sort((left, right) => left.z - right.z);

  for (const thing of sortedThings) {
    const blueprint = getBlueprintForThing(thing, blueprintLookup);
    const shape = blueprint?.shape ?? thing.shape;
    const color = thing.color || blueprint?.color || '#9ca3af';
    const drawInput: DrawShapeInput = {
      x: thing.x,
      y: thing.y,
      width: thing.width,
      height: thing.height,
      angle: thing.angle,
      color,
      camera: gameState.camera,
      screen: gameState.screen
    };

    drawThingShape(renderer, shape, drawInput);
  }

  renderForegroundParticles(renderer, gameState, particleSystem);
}

export function createWebGlRenderer(
  gl: WebGLRenderingContext,
  circleSegments = 32
): GameRenderer {
  const programInfo = createProgram(gl);
  const rectangle = createGeometry(gl, createRectangleVertices(), gl.TRIANGLES);
  const triangle = createGeometry(gl, createTriangleVertices(), gl.TRIANGLES);
  const circle = createGeometry(gl, createCircleVertices(circleSegments), gl.TRIANGLE_FAN);

  gl.useProgram(programInfo.program);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  function clear(color: string): void {
    const [red, green, blue, alpha] = colorToRgba(color);
    gl.clearColor(red, green, blue, alpha);
    gl.clear(gl.COLOR_BUFFER_BIT);
  }

  function resize(screen: ScreenSize): void {
    void screen;
    gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  }

  function drawRectangle(input: DrawShapeInput): void {
    drawGeometry(gl, programInfo, rectangle, input);
  }

  function drawTriangle(input: DrawShapeInput): void {
    drawGeometry(gl, programInfo, triangle, input);
  }

  function drawCircle(input: DrawShapeInput): void {
    drawGeometry(gl, programInfo, circle, input);
  }

  return {
    resize,
    clear,
    drawRectangle,
    drawTriangle,
    drawCircle
  };
}

export function createRectangleVertices(): Float32Array {
  return new Float32Array([
    -0.5,
    -0.5,
    0.5,
    -0.5,
    0.5,
    0.5,
    -0.5,
    -0.5,
    0.5,
    0.5,
    -0.5,
    0.5
  ]);
}

export function createTriangleVertices(): Float32Array {
  return new Float32Array([0, -0.5, -0.5, 0.5, 0.5, 0.5]);
}

export function createCircleVertices(segments: number): Float32Array {
  const safeSegments = Math.max(3, Math.floor(segments));
  const vertices = new Float32Array((safeSegments + 2) * 2);
  vertices[0] = 0;
  vertices[1] = 0;

  for (let index = 0; index <= safeSegments; index += 1) {
    const angle = (index / safeSegments) * Math.PI * 2;
    const base = (index + 1) * 2;
    vertices[base] = Math.cos(angle) * 0.5;
    vertices[base + 1] = Math.sin(angle) * 0.5;
  }

  return vertices;
}

function drawThingShape(renderer: GameRenderer, shape: Shape, input: DrawShapeInput): void {
  if (shape === 'triangle') {
    renderer.drawTriangle(input);
    return;
  }
  if (shape === 'circle') {
    renderer.drawCircle(input);
    return;
  }
  renderer.drawRectangle(input);
}

function renderForegroundParticles(
  renderer: GameRenderer,
  gameState: RuntimeGameState,
  particleSystem?: ParticleSystem
): void {
  // Particles draw after things so gameplay actors remain behind VFX.
  particleSystem?.render((particle) => {
    renderer.drawRectangle({
      x: particle.x,
      y: particle.y,
      width: particle.size,
      height: particle.size,
      angle: 0,
      color: particle.color,
      camera: gameState.camera,
      screen: gameState.screen
    });
  });
}

function createProgram(gl: WebGLRenderingContext): ProgramInfo {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentShaderSource);

  const program = gl.createProgram();
  if (!program) {
    throw new Error('Unable to allocate render program');
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const infoLog = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Render program link failed: ${infoLog ?? 'unknown error'}`);
  }

  const positionLocation = gl.getAttribLocation(program, 'a_localPosition');
  const translationLocation = gl.getUniformLocation(program, 'u_translation');
  const sizeLocation = gl.getUniformLocation(program, 'u_size');
  const rotationLocation = gl.getUniformLocation(program, 'u_rotation');
  const cameraLocation = gl.getUniformLocation(program, 'u_camera');
  const screenLocation = gl.getUniformLocation(program, 'u_screen');
  const colorLocation = gl.getUniformLocation(program, 'u_color');

  if (
    positionLocation < 0 ||
    !translationLocation ||
    !sizeLocation ||
    !rotationLocation ||
    !cameraLocation ||
    !screenLocation ||
    !colorLocation
  ) {
    throw new Error('Render program location lookup failed');
  }

  return {
    program,
    positionLocation,
    translationLocation,
    sizeLocation,
    rotationLocation,
    cameraLocation,
    screenLocation,
    colorLocation
  };
}

function createShader(gl: WebGLRenderingContext, shaderType: number, source: string): WebGLShader {
  const shader = gl.createShader(shaderType);
  if (!shader) {
    throw new Error('Unable to allocate render shader');
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const infoLog = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Render shader compilation failed: ${infoLog ?? 'unknown error'}`);
  }

  return shader;
}

function createGeometry(gl: WebGLRenderingContext, vertices: Float32Array, primitive: number): Geometry {
  const buffer = gl.createBuffer();
  if (!buffer) {
    throw new Error('Unable to allocate geometry buffer');
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

  return {
    buffer,
    vertexCount: vertices.length / 2,
    primitive
  };
}

function drawGeometry(
  gl: WebGLRenderingContext,
  programInfo: ProgramInfo,
  geometry: Geometry,
  input: DrawShapeInput
): void {
  gl.useProgram(programInfo.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, geometry.buffer);
  gl.enableVertexAttribArray(programInfo.positionLocation);
  gl.vertexAttribPointer(programInfo.positionLocation, 2, gl.FLOAT, false, 0, 0);

  const centerX = input.x + input.width / 2;
  const centerY = input.y + input.height / 2;
  const [red, green, blue, alpha] = colorToRgba(input.color);

  gl.uniform2f(programInfo.translationLocation, centerX, centerY);
  gl.uniform2f(programInfo.sizeLocation, input.width, input.height);
  gl.uniform1f(programInfo.rotationLocation, (input.angle * Math.PI) / 180);
  gl.uniform2f(programInfo.cameraLocation, input.camera.x, input.camera.y);
  gl.uniform2f(
    programInfo.screenLocation,
    Math.max(1, input.screen.width),
    Math.max(1, input.screen.height)
  );
  gl.uniform4f(programInfo.colorLocation, red, green, blue, alpha);

  gl.drawArrays(geometry.primitive, 0, geometry.vertexCount);
}

function colorToRgba(color: string): [number, number, number, number] {
  const normalized = color.trim().toLowerCase();

  if (/^#[0-9a-f]{6}$/.test(normalized)) {
    return [
      hexToUnit(normalized.slice(1, 3)),
      hexToUnit(normalized.slice(3, 5)),
      hexToUnit(normalized.slice(5, 7)),
      1
    ];
  }

  if (/^#[0-9a-f]{3}$/.test(normalized)) {
    return [
      hexToUnit(`${normalized[1]}${normalized[1]}`),
      hexToUnit(`${normalized[2]}${normalized[2]}`),
      hexToUnit(`${normalized[3]}${normalized[3]}`),
      1
    ];
  }

  return [0.5, 0.5, 0.5, 1];
}

function hexToUnit(value: string): number {
  return parseInt(value, 16) / 255;
}
