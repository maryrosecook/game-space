import {
  advanceCircleInBounds,
  type CircleState,
  type GameHooks,
  type GameLoopConfig,
  type TouchBinding,
  type TouchPoint
} from './runtime';

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

type GLSetup = {
  gl: WebGLRenderingContext;
  programInfo: ProgramInfo;
  circleVertexCount: number;
};

export type StarterScene = 'playing' | 'paused';

export type StarterAction = 'togglePause' | 'nudgeLeft' | 'nudgeRight' | 'nudgeUp' | 'nudgeDown';

export type StarterConfig = {
  loop: GameLoopConfig;
  randomSeed: number;
  circleSegments: number;
  circleRadius: number;
  circleSpeed: number;
  nudgeImpulse: number;
  clearColor: [number, number, number, number];
  inputBindings: Record<StarterAction, TouchBinding>;
  preloadTextAssets: readonly string[];
};

function hasTouchInZone(
  touches: readonly TouchPoint[],
  matchesZone: (touch: TouchPoint) => boolean
): boolean {
  for (const touch of touches) {
    if (matchesZone(touch)) {
      return true;
    }
  }
  return false;
}

const touchDeadZone = 0.25;

export const starterConfig: StarterConfig = {
  loop: {
    fixedStepSeconds: 1 / 120,
    maxFrameDeltaSeconds: 0.05,
    maxFixedStepsPerFrame: 8
  },
  randomSeed: 20260220,
  circleSegments: 48,
  circleRadius: 0.12,
  circleSpeed: 0.78,
  nudgeImpulse: 0.16,
  clearColor: [0.03, 0.06, 0.12, 1],
  inputBindings: {
    togglePause: {
      pressed: (tapCount) => tapCount > 0
    },
    nudgeLeft: {
      down: (touches) => hasTouchInZone(touches, (touch) => touch.normalizedX < -touchDeadZone)
    },
    nudgeRight: {
      down: (touches) => hasTouchInZone(touches, (touch) => touch.normalizedX > touchDeadZone)
    },
    nudgeUp: {
      down: (touches) => hasTouchInZone(touches, (touch) => touch.normalizedY < -touchDeadZone)
    },
    nudgeDown: {
      down: (touches) => hasTouchInZone(touches, (touch) => touch.normalizedY > touchDeadZone)
    }
  },
  preloadTextAssets: []
};

export type StarterGameState = {
  circle: CircleState;
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

export function createCircleVertices(segments: number): Float32Array {
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

function setupGL(gl: WebGLRenderingContext, circleSegments: number): GLSetup {
  const programInfo = createProgram(gl);
  const vertices = createCircleVertices(circleSegments);
  const vertexBuffer = gl.createBuffer();
  if (!vertexBuffer) {
    throw new Error('Unable to allocate buffer');
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
  gl.useProgram(programInfo.program);
  gl.enableVertexAttribArray(programInfo.positionLocation);
  gl.vertexAttribPointer(programInfo.positionLocation, 2, gl.FLOAT, false, 0, 0);

  return {
    gl,
    programInfo,
    circleVertexCount: vertices.length / 2
  };
}

export function updateStarterCircle(
  circle: CircleState,
  deltaSeconds: number,
  viewportScale: number
): CircleState {
  const horizontalRadius = circle.radius * viewportScale;
  return advanceCircleInBounds(
    circle,
    deltaSeconds,
    { minX: -1, maxX: 1, minY: -1, maxY: 1 },
    { radiusX: horizontalRadius, radiusY: circle.radius }
  );
}

export function createStarterGame(config: StarterConfig): GameHooks<StarterGameState, StarterScene, StarterAction> {
  let glSetup: GLSetup | null = null;

  return {
    loop: config.loop,
    init: (context) => {
      glSetup = setupGL(context.gl, config.circleSegments);
      void context.assets.preloadText(config.preloadTextAssets);

      return {
        circle: {
          x: 0,
          y: 0,
          velocityX: config.circleSpeed * context.random.nextSign(),
          velocityY: config.circleSpeed * context.random.nextSign(),
          radius: config.circleRadius
        }
      };
    },
    update: (state, context) => {
      if (context.stepIndex === 0 && context.input.wasPressed('togglePause')) {
        context.setScene(context.scene === 'playing' ? 'paused' : 'playing');
      }

      if (context.scene === 'paused') {
        return state;
      }

      const adjustedCircle: CircleState = {
        ...state.circle,
        velocityX:
          state.circle.velocityX +
          (context.input.isDown('nudgeRight') ? config.nudgeImpulse : 0) -
          (context.input.isDown('nudgeLeft') ? config.nudgeImpulse : 0),
        velocityY:
          state.circle.velocityY +
          (context.input.isDown('nudgeUp') ? config.nudgeImpulse : 0) -
          (context.input.isDown('nudgeDown') ? config.nudgeImpulse : 0)
      };

      return {
        circle: updateStarterCircle(adjustedCircle, context.deltaSeconds, context.frame.viewportScale)
      };
    },
    render: (state, context) => {
      if (!glSetup) {
        throw new Error('Starter game render called before init');
      }

      const { gl, programInfo, circleVertexCount } = glSetup;
      const clearColorMultiplier = context.scene === 'paused' ? 0.55 : 1;
      gl.clearColor(
        config.clearColor[0] * clearColorMultiplier,
        config.clearColor[1] * clearColorMultiplier,
        config.clearColor[2] * clearColorMultiplier,
        config.clearColor[3]
      );
      gl.clear(gl.COLOR_BUFFER_BIT);

      gl.uniform2f(programInfo.centerLocation, state.circle.x, state.circle.y);
      gl.uniform1f(programInfo.radiusLocation, state.circle.radius);
      gl.uniform1f(programInfo.viewportScaleLocation, context.frame.viewportScale);
      gl.drawArrays(gl.TRIANGLE_FAN, 0, circleVertexCount);
    },
    onResize: () => {
      if (!glSetup) {
        return;
      }
      glSetup.gl.viewport(0, 0, glSetup.gl.drawingBufferWidth, glSetup.gl.drawingBufferHeight);
    }
  };
}
